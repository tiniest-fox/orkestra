//! Git diff commands for task changes.

use crate::{error::TauriError, highlight::SyntaxHighlighter, state::AppState};
use orkestra_core::workflow::{FileChangeType, FileDiff, TaskDiff};
use serde::Serialize;
use std::path::Path;
use tauri::State;

// =============================================================================
// Response Types
// =============================================================================

/// Type of line in a diff (add, delete, or context).
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum LineType {
    Add,
    Delete,
    Context,
}

/// A single highlighted line in a diff.
#[derive(Debug, Clone, Serialize)]
pub struct HighlightedLine {
    /// The line type (add/delete/context).
    pub line_type: LineType,
    /// Old line number (None for added lines).
    pub old_line_number: Option<usize>,
    /// New line number (None for deleted lines).
    pub new_line_number: Option<usize>,
    /// Pre-highlighted HTML content (with CSS classes).
    pub html: String,
}

/// A hunk of changes in a diff (continuous block with context).
#[derive(Debug, Clone, Serialize)]
pub struct HighlightedHunk {
    /// Old file line range (start, count).
    pub old_start: usize,
    pub old_count: usize,
    /// New file line range (start, count).
    pub new_start: usize,
    pub new_count: usize,
    /// Highlighted lines in this hunk.
    pub lines: Vec<HighlightedLine>,
}

/// A file's diff with syntax highlighting.
#[derive(Debug, Clone, Serialize)]
pub struct HighlightedFileDiff {
    /// File path.
    pub path: String,
    /// Change type (added/modified/deleted/renamed).
    pub change_type: FileChangeType,
    /// Old path if renamed.
    pub old_path: Option<String>,
    /// Line counts.
    pub additions: usize,
    pub deletions: usize,
    /// Whether the file is binary.
    pub is_binary: bool,
    /// Highlighted hunks (None for binary files).
    pub hunks: Option<Vec<HighlightedHunk>>,
}

/// Full task diff with highlighted files.
#[derive(Debug, Clone, Serialize)]
pub struct HighlightedTaskDiff {
    /// List of highlighted file diffs.
    pub files: Vec<HighlightedFileDiff>,
}

/// Syntax highlighting CSS for light and dark themes.
#[derive(Debug, Clone, Serialize)]
pub struct SyntaxCss {
    /// CSS for light theme.
    pub light: String,
    /// CSS for dark theme.
    pub dark: String,
}

// =============================================================================
// Diff Parsing and Highlighting
// =============================================================================

/// Parse unified diff content into highlighted hunks.
///
/// Parses hunk headers (`@@ -old_start,old_count +new_start,new_count @@`),
/// classifies lines by prefix (`+`/`-`/space), tracks line numbers, and
/// highlights each line using the syntax highlighter.
fn parse_and_highlight_hunks(
    diff_content: &str,
    extension: &str,
    highlighter: &SyntaxHighlighter,
) -> Vec<HighlightedHunk> {
    let mut hunks = Vec::new();
    let mut current_hunk: Option<HighlightedHunk> = None;
    let mut old_line_num = 0;
    let mut new_line_num = 0;

    for line in diff_content.lines() {
        // Hunk header: @@ -old_start,old_count +new_start,new_count @@
        if line.starts_with("@@") {
            // Save previous hunk
            if let Some(hunk) = current_hunk.take() {
                hunks.push(hunk);
            }

            // Parse hunk header
            if let Some(parsed) = parse_hunk_header(line) {
                old_line_num = parsed.0;
                new_line_num = parsed.2;
                current_hunk = Some(HighlightedHunk {
                    old_start: parsed.0,
                    old_count: parsed.1,
                    new_start: parsed.2,
                    new_count: parsed.3,
                    lines: Vec::new(),
                });
            }
        } else if let Some(ref mut hunk) = current_hunk {
            // Content line
            let (line_type, content) = if let Some(stripped) = line.strip_prefix('+') {
                (LineType::Add, stripped)
            } else if let Some(stripped) = line.strip_prefix('-') {
                (LineType::Delete, stripped)
            } else if let Some(stripped) = line.strip_prefix(' ') {
                (LineType::Context, stripped)
            } else {
                // Unknown prefix (shouldn't happen in valid diff)
                continue;
            };

            // Highlight the line (add newline for syntect)
            let html = highlighter.highlight_line(&format!("{content}\n"), extension);

            let highlighted_line = match line_type {
                LineType::Add => {
                    let line = HighlightedLine {
                        line_type,
                        old_line_number: None,
                        new_line_number: Some(new_line_num),
                        html,
                    };
                    new_line_num += 1;
                    line
                }
                LineType::Delete => {
                    let line = HighlightedLine {
                        line_type,
                        old_line_number: Some(old_line_num),
                        new_line_number: None,
                        html,
                    };
                    old_line_num += 1;
                    line
                }
                LineType::Context => {
                    let line = HighlightedLine {
                        line_type,
                        old_line_number: Some(old_line_num),
                        new_line_number: Some(new_line_num),
                        html,
                    };
                    old_line_num += 1;
                    new_line_num += 1;
                    line
                }
            };

            hunk.lines.push(highlighted_line);
        }
    }

    // Save last hunk
    if let Some(hunk) = current_hunk {
        hunks.push(hunk);
    }

    hunks
}

/// Parse a hunk header line.
///
/// Example: "@@ -10,5 +12,7 @@" -> (10, 5, 12, 7)
/// Returns (`old_start`, `old_count`, `new_start`, `new_count`).
fn parse_hunk_header(line: &str) -> Option<(usize, usize, usize, usize)> {
    // Extract the part between @@ and @@
    let parts: Vec<&str> = line.split("@@").collect();
    if parts.len() < 2 {
        return None;
    }

    let header = parts[1].trim();
    let ranges: Vec<&str> = header.split_whitespace().collect();
    if ranges.len() < 2 {
        return None;
    }

    // Parse "-old_start,old_count"
    let old_range = ranges[0].strip_prefix('-')?;
    let (old_start, old_count) = parse_range(old_range)?;

    // Parse "+new_start,new_count"
    let new_range = ranges[1].strip_prefix('+')?;
    let (new_start, new_count) = parse_range(new_range)?;

    Some((old_start, old_count, new_start, new_count))
}

/// Parse a range like "10,5" or "10" into (start, count).
fn parse_range(range: &str) -> Option<(usize, usize)> {
    if let Some((start_str, count_str)) = range.split_once(',') {
        let start = start_str.parse().ok()?;
        let count = count_str.parse().ok()?;
        Some((start, count))
    } else {
        // Single line: "10" means (10, 1)
        let start = range.parse().ok()?;
        Some((start, 1))
    }
}

/// Extract file extension from path.
fn get_extension(path: &str) -> &str {
    Path::new(path)
        .extension()
        .and_then(|s| s.to_str())
        .unwrap_or("txt")
}

// =============================================================================
// Tauri Commands
// =============================================================================

/// Get the git diff for a task, with syntax highlighting.
#[tauri::command]
pub fn workflow_get_task_diff(
    state: State<AppState>,
    highlighter: State<SyntaxHighlighter>,
    task_id: String,
) -> Result<HighlightedTaskDiff, TauriError> {
    let api = state.api()?;
    let raw_diff: TaskDiff = api.get_task_diff(&task_id)?;

    // Transform each FileDiff into HighlightedFileDiff
    let files = raw_diff
        .files
        .into_iter()
        .map(|file_diff: FileDiff| {
            let hunks = if file_diff.is_binary || file_diff.diff_content.is_none() {
                None
            } else {
                let diff_content = file_diff.diff_content.as_ref().unwrap();
                let extension = get_extension(&file_diff.path);
                Some(parse_and_highlight_hunks(
                    diff_content,
                    extension,
                    &highlighter,
                ))
            };

            HighlightedFileDiff {
                path: file_diff.path,
                change_type: file_diff.change_type,
                old_path: file_diff.old_path,
                additions: file_diff.additions,
                deletions: file_diff.deletions,
                is_binary: file_diff.is_binary,
                hunks,
            }
        })
        .collect();

    Ok(HighlightedTaskDiff { files })
}

/// Get file content at HEAD with syntax highlighting.
///
/// Each line is returned as a context-type `HighlightedLine` with line numbers.
#[tauri::command]
pub fn workflow_get_file_content(
    state: State<AppState>,
    highlighter: State<SyntaxHighlighter>,
    task_id: String,
    file_path: String,
) -> Result<Option<Vec<HighlightedLine>>, TauriError> {
    let api = state.api()?;
    let content = api.get_file_content(&task_id, &file_path)?;

    match content {
        None => Ok(None),
        Some(text) => {
            let extension = get_extension(&file_path);
            let lines: Vec<HighlightedLine> = text
                .lines()
                .enumerate()
                .map(|(idx, line)| {
                    let line_num = idx + 1;
                    let html = highlighter.highlight_line(&format!("{line}\n"), extension);
                    HighlightedLine {
                        line_type: LineType::Context,
                        old_line_number: Some(line_num),
                        new_line_number: Some(line_num),
                        html,
                    }
                })
                .collect();
            Ok(Some(lines))
        }
    }
}

/// Get pre-generated syntax highlighting CSS for light and dark themes.
#[tauri::command]
pub fn workflow_get_syntax_css(highlighter: State<SyntaxHighlighter>) -> SyntaxCss {
    SyntaxCss {
        light: highlighter.light_css().to_string(),
        dark: highlighter.dark_css().to_string(),
    }
}
