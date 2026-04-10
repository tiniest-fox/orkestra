//! Tauri commands for git diff operations.

use std::sync::Arc;

use orkestra_core::workflow::ports::{CommitInfo, FileChangeType, FileDiff};
use orkestra_networking::diff as shared_diff;
use serde::Serialize;
use serde_json::Value;
use tauri::State;

use crate::diff_cache::DiffCacheState;
use crate::error::TauriError;
use crate::highlight::SyntaxHighlighter;
use crate::project_registry::ProjectRegistry;

// =============================================================================
// Response Types
// =============================================================================

/// Type of diff line (add/delete/context).
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum LineType {
    Add,
    Delete,
    Context,
}

/// A single highlighted line in a diff hunk.
#[derive(Debug, Clone, Serialize)]
pub struct HighlightedLine {
    /// Type of line (add/delete/context).
    pub line_type: LineType,
    /// Raw text content (for copy/paste).
    pub content: String,
    /// Pre-highlighted HTML with CSS classes.
    pub html: String,
    /// Line number in old file (None for added lines).
    pub old_line_number: Option<u32>,
    /// Line number in new file (None for deleted lines).
    pub new_line_number: Option<u32>,
}

/// A parsed hunk from a unified diff.
#[derive(Debug, Clone, Serialize)]
pub struct HighlightedHunk {
    /// Starting line in old file.
    pub old_start: u32,
    /// Number of lines in old file.
    pub old_count: u32,
    /// Starting line in new file.
    pub new_start: u32,
    /// Number of lines in new file.
    pub new_count: u32,
    /// Lines in this hunk (with highlighting).
    pub lines: Vec<HighlightedLine>,
}

/// File diff with highlighted hunks.
#[derive(Debug, Clone, Serialize)]
pub struct HighlightedFileDiff {
    /// File path (new path if renamed).
    pub path: String,
    /// Type of change.
    pub change_type: FileChangeType,
    /// Original path (only for renames).
    pub old_path: Option<String>,
    /// Number of lines added.
    pub additions: usize,
    /// Number of lines deleted.
    pub deletions: usize,
    /// Whether the file is binary.
    pub is_binary: bool,
    /// Parsed and highlighted hunks.
    pub hunks: Vec<HighlightedHunk>,
    /// Total lines in the new version of the file (None for deleted/binary).
    pub total_new_lines: Option<u32>,
}

/// Complete task diff with highlighting.
#[derive(Debug, Serialize)]
pub struct HighlightedTaskDiff {
    /// Files with highlighted diffs.
    pub files: Vec<HighlightedFileDiff>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub diff_sha: Option<String>,
}

/// Syntax CSS for light and dark themes.
#[derive(Debug, Serialize)]
pub struct SyntaxCss {
    /// CSS for light theme.
    pub light: String,
    /// CSS for dark theme.
    pub dark: String,
}

// =============================================================================
// Tauri Commands
// =============================================================================

/// Get the diff for a task with syntax highlighting.
///
/// Uses a two-tier cache to avoid redundant git subprocesses and re-highlighting:
///
/// - Tier 1: If HEAD SHA matches and worktree is clean, return cached result immediately.
/// - Tier 2: Run git diff, but only re-highlight files whose content hash changed.
///
/// Accepts an optional `last_sha` ETag parameter. When `last_sha` matches the current
/// diff fingerprint, returns `{ "unchanged": true, "diff_sha": "..." }` immediately.
/// Full diff responses include a `diff_sha` field for use as `last_sha` on the next poll.
#[allow(clippy::too_many_lines)]
#[tauri::command]
pub async fn workflow_get_task_diff(
    task_id: String,
    context_lines: Option<u32>,
    last_sha: Option<String>,
    registry: tauri::State<'_, ProjectRegistry>,
    window: tauri::Window,
    highlighter: tauri::State<'_, SyntaxHighlighter>,
    diff_cache: tauri::State<'_, DiffCacheState>,
) -> Result<Value, TauriError> {
    let context_lines = context_lines.unwrap_or(3);
    registry.with_project(window.label(), |state| {
        let (task, git) = {
            let api = state.api()?;
            let git = api
                .git_service()
                .ok_or_else(|| {
                    orkestra_core::workflow::ports::WorkflowError::GitError(
                        "No git service configured".into(),
                    )
                })?
                .clone();
            let task = api.get_task(&task_id)?;
            (task, git)
        }; // mutex released — git operations run off the lock

        let worktree_path = std::path::Path::new(task.worktree_path.as_ref().ok_or(
            orkestra_core::workflow::ports::WorkflowError::GitError("Task has no worktree".into()),
        )?);
        let branch_name = task.branch_name.as_ref().ok_or(
            orkestra_core::workflow::ports::WorkflowError::GitError("Task has no branch".into()),
        )?;

        // Tier 1: SHA check — skip git subprocess if clean + unchanged.
        // Use ok() so a transient git2 error doesn't block the diff.
        if let Ok(wt_state) = git.get_worktree_state(worktree_path) {
            if !wt_state.is_dirty {
                let cache_sha = if context_lines == 3 {
                    wt_state.head_sha.clone()
                } else {
                    format!("{}:{}", wt_state.head_sha, context_lines)
                };
                // ETag short-circuit: unchanged since last poll.
                if last_sha.as_deref() == Some(&cache_sha) {
                    return Ok(serde_json::json!({ "unchanged": true, "diff_sha": cache_sha }));
                }
                if let Some(files) =
                    diff_cache.get_all_if_clean(window.label(), &task_id, &cache_sha)
                {
                    return Ok(serde_json::to_value(HighlightedTaskDiff {
                        files,
                        diff_sha: Some(cache_sha),
                    })
                    .unwrap_or(Value::Null));
                }

                // Tier 1 miss — run git diff subprocess.
                let raw_diff = git
                    .diff_against_base(worktree_path, branch_name, &task.base_branch, context_lines)
                    .map_err(|e| {
                        orkestra_core::workflow::ports::WorkflowError::GitError(e.to_string())
                    })?;

                // Tier 2: per-file content hash — only re-highlight changed files.
                let file_hashes: Vec<(String, u64)> = raw_diff
                    .files
                    .iter()
                    .map(|f| (f.path.clone(), file_content_hash(f)))
                    .collect();
                let diff_sha = combined_diff_sha(&file_hashes, context_lines);

                // ETag short-circuit for clean Tier 1 miss.
                if last_sha.as_deref() == Some(&diff_sha) {
                    return Ok(serde_json::json!({ "unchanged": true, "diff_sha": diff_sha }));
                }

                let mut cached_files =
                    diff_cache.get_files_by_hash(window.label(), &task_id, &file_hashes);

                let mut to_store: Vec<(String, u64, HighlightedFileDiff)> = Vec::new();
                let files: Vec<HighlightedFileDiff> = raw_diff
                    .files
                    .into_iter()
                    .zip(file_hashes.iter())
                    .map(|(file, (path, hash))| {
                        if let Some(Some(cached)) = cached_files.remove(path) {
                            to_store.push((path.clone(), *hash, cached.clone()));
                            cached
                        } else {
                            let result = highlight_file_diff(file, &highlighter);
                            to_store.push((path.clone(), *hash, result.clone()));
                            result
                        }
                    })
                    .collect();

                diff_cache.store(window.label(), &task_id, &cache_sha, to_store);
                return Ok(serde_json::to_value(HighlightedTaskDiff {
                    files,
                    diff_sha: Some(diff_sha),
                })
                .unwrap_or(Value::Null));
            }

            // Worktree is dirty — run git diff subprocess without Tier 1 caching.
            let raw_diff = git
                .diff_against_base(worktree_path, branch_name, &task.base_branch, context_lines)
                .map_err(|e| {
                    orkestra_core::workflow::ports::WorkflowError::GitError(e.to_string())
                })?;

            // Tier 2: per-file content hash — only re-highlight changed files.
            let file_hashes: Vec<(String, u64)> = raw_diff
                .files
                .iter()
                .map(|f| (f.path.clone(), file_content_hash(f)))
                .collect();
            let diff_sha = combined_diff_sha(&file_hashes, context_lines);

            // ETag short-circuit for dirty worktrees.
            if last_sha.as_deref() == Some(&diff_sha) {
                return Ok(serde_json::json!({ "unchanged": true, "diff_sha": diff_sha }));
            }

            let mut cached_files =
                diff_cache.get_files_by_hash(window.label(), &task_id, &file_hashes);

            let mut to_store: Vec<(String, u64, HighlightedFileDiff)> = Vec::new();
            let files: Vec<HighlightedFileDiff> = raw_diff
                .files
                .into_iter()
                .zip(file_hashes.iter())
                .map(|(file, (path, hash))| {
                    if let Some(Some(cached)) = cached_files.remove(path) {
                        to_store.push((path.clone(), *hash, cached.clone()));
                        cached
                    } else {
                        let result = highlight_file_diff(file, &highlighter);
                        to_store.push((path.clone(), *hash, result.clone()));
                        result
                    }
                })
                .collect();

            // Store with dirty-state SHA (no Tier 1 key) for Tier 2 re-use only.
            diff_cache.store(window.label(), &task_id, &wt_state.head_sha, to_store);
            return Ok(serde_json::to_value(HighlightedTaskDiff {
                files,
                diff_sha: Some(diff_sha),
            })
            .unwrap_or(Value::Null));
        }

        // get_worktree_state failed — fall back to direct diff with no caching.
        let raw_diff = git
            .diff_against_base(worktree_path, branch_name, &task.base_branch, context_lines)
            .map_err(|e| orkestra_core::workflow::ports::WorkflowError::GitError(e.to_string()))?;

        let files = raw_diff
            .files
            .into_iter()
            .map(|file| highlight_file_diff(file, &highlighter))
            .collect();

        Ok(serde_json::to_value(HighlightedTaskDiff {
            files,
            diff_sha: None,
        })
        .unwrap_or(Value::Null))
    })
}

/// Combine per-file content hashes into a single diff fingerprint.
fn combined_diff_sha(file_hashes: &[(String, u64)], context_lines: u32) -> String {
    use std::collections::hash_map::DefaultHasher;
    use std::hash::{Hash, Hasher};
    let mut h = DefaultHasher::new();
    for (path, hash) in file_hashes {
        path.hash(&mut h);
        hash.hash(&mut h);
    }
    context_lines.hash(&mut h);
    format!("{:x}", h.finish())
}

/// Stable content hash for a file diff entry.
///
/// Covers all fields that appear in the cached `HighlightedFileDiff` output so
/// that a cache hit is only returned when the rendered result would be identical.
fn file_content_hash(file: &FileDiff) -> u64 {
    use std::collections::hash_map::DefaultHasher;
    use std::hash::{Hash, Hasher};
    let mut h = DefaultHasher::new();
    file.path.hash(&mut h);
    file.old_path.hash(&mut h);
    file.change_type.hash(&mut h);
    file.is_binary.hash(&mut h);
    file.diff_content.hash(&mut h);
    h.finish()
}

/// Get the content of a file at HEAD in a task's worktree, with syntax highlighting.
#[tauri::command]
pub async fn workflow_get_file_content(
    task_id: String,
    file_path: String,
    registry: tauri::State<'_, ProjectRegistry>,
    window: tauri::Window,
    highlighter: tauri::State<'_, SyntaxHighlighter>,
) -> Result<Option<Vec<HighlightedLine>>, TauriError> {
    registry.with_project(window.label(), |state| {
        let api = state.api()?;
        let content = api.get_file_content(&task_id, &file_path)?;

        let Some(content) = content else {
            return Ok(None);
        };

        // Extract file extension for syntax highlighting
        let extension = std::path::Path::new(&file_path)
            .extension()
            .and_then(|e| e.to_str())
            .unwrap_or("");

        // Highlight each line as context
        #[allow(clippy::cast_possible_truncation)]
        let lines: Vec<HighlightedLine> = content
            .lines()
            .enumerate()
            .map(|(i, line)| {
                let line_with_newline = format!("{line}\n");
                let html = highlighter.highlight_line(&line_with_newline, extension);
                HighlightedLine {
                    line_type: LineType::Context,
                    content: line.to_string(),
                    html,
                    old_line_number: Some((i + 1) as u32),
                    new_line_number: Some((i + 1) as u32),
                }
            })
            .collect();

        Ok(Some(lines))
    })
}

/// Get the syntax CSS for light and dark themes.
#[tauri::command]
pub async fn workflow_get_syntax_css(
    highlighter: tauri::State<'_, SyntaxHighlighter>,
) -> Result<SyntaxCss, TauriError> {
    Ok(SyntaxCss {
        light: highlighter.light_css.clone(),
        dark: highlighter.dark_css.clone(),
    })
}

// =============================================================================
// Diff Parsing and Highlighting
// =============================================================================

/// Convert a raw `FileDiff` into a highlighted `FileDiff` with parsed hunks.
fn highlight_file_diff(file: FileDiff, highlighter: &SyntaxHighlighter) -> HighlightedFileDiff {
    let hunks = if let Some(ref content) = file.diff_content {
        if file.is_binary {
            vec![]
        } else {
            parse_and_highlight_diff(content, &file.path, highlighter)
        }
    } else {
        vec![]
    };

    HighlightedFileDiff {
        path: file.path,
        change_type: file.change_type,
        old_path: file.old_path,
        additions: file.additions,
        deletions: file.deletions,
        is_binary: file.is_binary,
        hunks,
        total_new_lines: file.total_new_lines,
    }
}

/// Parse unified diff content and highlight each line.
fn parse_and_highlight_diff(
    diff_content: &str,
    file_path: &str,
    highlighter: &SyntaxHighlighter,
) -> Vec<HighlightedHunk> {
    let extension = std::path::Path::new(file_path)
        .extension()
        .and_then(|e| e.to_str())
        .unwrap_or("");

    let mut hunks = Vec::new();
    let mut current_hunk: Option<HighlightedHunk> = None;
    let mut old_line = 0u32;
    let mut new_line = 0u32;

    for line in diff_content.lines() {
        // Hunk header: @@ -old_start,old_count +new_start,new_count @@
        if line.starts_with("@@") {
            // Save previous hunk
            if let Some(hunk) = current_hunk.take() {
                hunks.push(hunk);
            }

            // Parse hunk header
            if let Some((old_start, old_count, new_start, new_count)) = parse_hunk_header(line) {
                old_line = old_start;
                new_line = new_start;
                current_hunk = Some(HighlightedHunk {
                    old_start,
                    old_count,
                    new_start,
                    new_count,
                    lines: Vec::new(),
                });
            }
            continue;
        }

        // Skip diff metadata lines
        if line.starts_with("diff --git")
            || line.starts_with("index ")
            || line.starts_with("---")
            || line.starts_with("+++")
        {
            continue;
        }

        // Process hunk lines
        if let Some(ref mut hunk) = current_hunk {
            let (line_type, content, old_num, new_num) =
                if let Some(content) = line.strip_prefix('+') {
                    let num = new_line;
                    new_line += 1;
                    (LineType::Add, content, None, Some(num))
                } else if let Some(content) = line.strip_prefix('-') {
                    let num = old_line;
                    old_line += 1;
                    (LineType::Delete, content, Some(num), None)
                } else if let Some(content) = line.strip_prefix(' ') {
                    let old_num = old_line;
                    let new_num = new_line;
                    old_line += 1;
                    new_line += 1;
                    (LineType::Context, content, Some(old_num), Some(new_num))
                } else {
                    // Unknown line type, skip
                    continue;
                };

            let content_with_newline = format!("{content}\n");
            let html = highlighter.highlight_line(&content_with_newline, extension);

            hunk.lines.push(HighlightedLine {
                line_type,
                content: content.to_string(),
                html,
                old_line_number: old_num,
                new_line_number: new_num,
            });
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
/// Format: `@@ -old_start,old_count +new_start,new_count @@`
/// Returns (`old_start`, `old_count`, `new_start`, `new_count`).
fn parse_hunk_header(line: &str) -> Option<(u32, u32, u32, u32)> {
    // Extract the part between @@ and @@
    let parts: Vec<&str> = line.split("@@").collect();
    if parts.len() < 2 {
        return None;
    }

    let ranges = parts[1].trim();
    let mut parts = ranges.split_whitespace();

    // Parse old range: -old_start,old_count
    let old_range = parts.next()?.strip_prefix('-')?;
    let (old_start, old_count) = parse_range(old_range)?;

    // Parse new range: +new_start,new_count
    let new_range = parts.next()?.strip_prefix('+')?;
    let (new_start, new_count) = parse_range(new_range)?;

    Some((old_start, old_count, new_start, new_count))
}

/// Parse a range like "1,5" or just "1" (implies count=1).
fn parse_range(range: &str) -> Option<(u32, u32)> {
    if let Some((start, count)) = range.split_once(',') {
        let start = start.parse().ok()?;
        let count = count.parse().ok()?;
        Some((start, count))
    } else {
        let start = range.parse().ok()?;
        Some((start, 1))
    }
}

// =============================================================================
// Commit History Commands
// =============================================================================

/// Get commits on a task's branch since it diverged from the base branch.
///
/// Returns commits plus whether the worktree has uncommitted changes.
#[tauri::command]
pub fn workflow_get_branch_commits(
    registry: State<ProjectRegistry>,
    window: tauri::Window,
    task_id: String,
) -> Result<Value, TauriError> {
    let params = serde_json::json!({ "task_id": task_id });
    registry.with_project(window.label(), |state| {
        shared_diff::get_branch_commits(state.command_context(), &params).map_err(Into::into)
    })
}

/// Get the syntax-highlighted diff of uncommitted changes in a task's worktree.
#[tauri::command]
pub fn workflow_get_uncommitted_diff(
    registry: State<ProjectRegistry>,
    window: tauri::Window,
    task_id: String,
) -> Result<Value, TauriError> {
    let params = serde_json::json!({ "task_id": task_id });
    registry.with_project(window.label(), |state| {
        shared_diff::get_uncommitted_diff(state.command_context(), &params).map_err(Into::into)
    })
}

/// Get recent commit history for the main repository.
///
/// Returns the 20 most recent commits on the current branch.
#[tauri::command]
pub fn workflow_get_commit_log(
    registry: State<ProjectRegistry>,
    window: tauri::Window,
) -> Result<Vec<CommitInfo>, TauriError> {
    registry.with_project(window.label(), |state| {
        let git = {
            let api = state.api()?;
            let Some(git) = api.git_service() else {
                return Ok(vec![]);
            };
            Arc::clone(git)
        }; // mutex released here — git subprocess runs off the lock
        git.commit_log(20).map_err(|e| {
            orkestra_core::workflow::ports::WorkflowError::GitError(e.to_string()).into()
        })
    })
}

/// Get file change counts for a batch of commit hashes.
///
/// Returns a map from commit hash to the number of files changed.
/// Used for lazy-loading file counts after the commit list populates.
#[tauri::command]
pub fn workflow_get_batch_file_counts(
    registry: State<ProjectRegistry>,
    window: tauri::Window,
    hashes: Vec<String>,
) -> Result<std::collections::HashMap<String, usize>, TauriError> {
    registry.with_project(window.label(), |state| {
        let git = {
            let api = state.api()?;
            let Some(git) = api.git_service() else {
                return Ok(std::collections::HashMap::new());
            };
            Arc::clone(git)
        }; // mutex released here — git subprocess runs off the lock
        git.batch_file_counts(&hashes).map_err(|e| {
            orkestra_core::workflow::ports::WorkflowError::GitError(e.to_string()).into()
        })
    })
}

/// Get the syntax-highlighted diff for a specific commit.
#[tauri::command]
pub fn workflow_get_commit_diff(
    registry: State<ProjectRegistry>,
    window: tauri::Window,
    commit_hash: String,
    context_lines: Option<u32>,
    highlighter: State<SyntaxHighlighter>,
) -> Result<HighlightedTaskDiff, TauriError> {
    let context_lines = context_lines.unwrap_or(3);
    registry.with_project(window.label(), |state| {
        let git = {
            let api = state.api()?;
            let Some(git) = api.git_service() else {
                return Ok(HighlightedTaskDiff {
                    files: vec![],
                    diff_sha: None,
                });
            };
            Arc::clone(git)
        }; // mutex released here — git subprocess runs off the lock
        let task_diff = git
            .commit_diff(&commit_hash, context_lines)
            .map_err(|e| orkestra_core::workflow::ports::WorkflowError::GitError(e.to_string()))?;

        let files = task_diff
            .files
            .iter()
            .map(|f| highlight_file_diff(f.clone(), &highlighter))
            .collect();

        Ok(HighlightedTaskDiff {
            files,
            diff_sha: None,
        })
    })
}
