//! Diff response types shared between diff handlers and the diff cache.

use orkestra_core::workflow::ports::{FileChangeType, FileDiff};
use serde::Serialize;

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
    pub old_start: u32,
    pub old_count: u32,
    pub new_start: u32,
    pub new_count: u32,
    pub lines: Vec<HighlightedLine>,
}

/// File diff with highlighted hunks.
#[derive(Debug, Clone, Serialize)]
pub struct HighlightedFileDiff {
    /// File path (new path if renamed).
    pub path: String,
    pub change_type: FileChangeType,
    /// Original path (only for renames).
    pub old_path: Option<String>,
    pub additions: usize,
    pub deletions: usize,
    pub is_binary: bool,
    pub hunks: Vec<HighlightedHunk>,
    pub total_new_lines: Option<u32>,
}

/// Complete task diff with highlighting.
#[derive(Debug, Serialize)]
pub struct HighlightedTaskDiff {
    pub files: Vec<HighlightedFileDiff>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub diff_sha: Option<String>,
}

/// Syntax CSS for light and dark themes.
#[derive(Debug, Serialize)]
pub struct SyntaxCss {
    pub light: String,
    pub dark: String,
}

// ============================================================================
// Hash and cache-key utilities
// ============================================================================

/// Build a cache key from a HEAD SHA and `context_lines`.
///
/// When `context_lines` is the default (3), returns the bare SHA.
/// Otherwise appends `:<context_lines>` to differentiate cache entries.
pub fn cache_key_for_sha(head_sha: &str, context_lines: u32) -> String {
    if context_lines == 3 {
        head_sha.to_string()
    } else {
        format!("{head_sha}:{context_lines}")
    }
}

/// Combine per-file content hashes into a single diff fingerprint.
pub fn combined_diff_sha(file_hashes: &[(String, u64)], context_lines: u32) -> String {
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

/// Content hash for a `FileDiff` entry, used for cache-key comparison within a single session.
///
/// `DefaultHasher` is not stable across Rust versions — never persist these values.
pub fn file_content_hash(file: &FileDiff) -> u64 {
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

// ============================================================================
// Diff parsing and highlighting
// ============================================================================

/// Highlight all lines of a plain file as context lines with 1-based line numbers.
///
/// `highlight_line` is a closure `|line, extension| -> html_string` so both the Tauri
/// and WebSocket highlighters can be used without a shared trait.
#[allow(clippy::cast_possible_truncation)]
pub fn highlight_file_content(
    content: &str,
    extension: &str,
    highlight_line: &dyn Fn(&str, &str) -> String,
) -> Vec<HighlightedLine> {
    content
        .lines()
        .enumerate()
        .map(|(i, line)| {
            let line_with_newline = format!("{line}\n");
            let html = highlight_line(&line_with_newline, extension);
            HighlightedLine {
                line_type: LineType::Context,
                content: line.to_string(),
                html,
                old_line_number: Some((i + 1) as u32),
                new_line_number: Some((i + 1) as u32),
            }
        })
        .collect()
}

/// Convert a raw `FileDiff` into a highlighted `HighlightedFileDiff` with parsed hunks.
///
/// `highlight_line` is a closure `|line, extension| -> html_string` so both the Tauri
/// and WebSocket highlighters can be used without a shared trait.
pub fn highlight_file_diff(
    file: FileDiff,
    highlight_line: &dyn Fn(&str, &str) -> String,
) -> HighlightedFileDiff {
    let hunks = match file.diff_content {
        Some(ref content) if !file.is_binary => {
            parse_and_highlight_diff(content, &file.path, highlight_line)
        }
        _ => vec![],
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
///
/// `highlight_line` is a closure `|line, extension| -> html_string`.
pub fn parse_and_highlight_diff(
    diff_content: &str,
    file_path: &str,
    highlight_line: &dyn Fn(&str, &str) -> String,
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
        if line.starts_with("@@") {
            if let Some(hunk) = current_hunk.take() {
                hunks.push(hunk);
            }
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

        if line.starts_with("diff --git")
            || line.starts_with("index ")
            || line.starts_with("---")
            || line.starts_with("+++")
        {
            continue;
        }

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
                    continue;
                };

            let content_with_newline = format!("{content}\n");
            let html = highlight_line(&content_with_newline, extension);

            hunk.lines.push(HighlightedLine {
                line_type,
                content: content.to_string(),
                html,
                old_line_number: old_num,
                new_line_number: new_num,
            });
        }
    }

    if let Some(hunk) = current_hunk {
        hunks.push(hunk);
    }

    hunks
}

/// Parse a hunk header line: `@@ -old_start,old_count +new_start,new_count @@`.
pub fn parse_hunk_header(line: &str) -> Option<(u32, u32, u32, u32)> {
    let parts: Vec<&str> = line.split("@@").collect();
    if parts.len() < 2 {
        return None;
    }
    let ranges = parts[1].trim();
    let mut iter = ranges.split_whitespace();
    let old_range = iter.next()?.strip_prefix('-')?;
    let (old_start, old_count) = parse_range(old_range)?;
    let new_range = iter.next()?.strip_prefix('+')?;
    let (new_start, new_count) = parse_range(new_range)?;
    Some((old_start, old_count, new_start, new_count))
}

/// Parse a range like `"1,5"` or `"1"` (count defaults to 1).
pub fn parse_range(range: &str) -> Option<(u32, u32)> {
    if let Some((start, count)) = range.split_once(',') {
        Some((start.parse().ok()?, count.parse().ok()?))
    } else {
        Some((range.parse().ok()?, 1))
    }
}

// ============================================================================
// Tests
// ============================================================================

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn cache_key_for_sha_default_context_returns_bare_sha() {
        assert_eq!(cache_key_for_sha("abc123", 3), "abc123");
    }

    #[test]
    fn cache_key_for_sha_non_default_context_appends_suffix() {
        assert_eq!(cache_key_for_sha("abc123", 10), "abc123:10");
    }

    #[test]
    fn combined_diff_sha_consistent() {
        let hashes = vec![("src/main.rs".to_string(), 12345u64)];
        let a = combined_diff_sha(&hashes, 3);
        let b = combined_diff_sha(&hashes, 3);
        assert_eq!(a, b, "same inputs should produce same fingerprint");
    }

    #[test]
    fn combined_diff_sha_changes_with_file_hash() {
        let hashes_a = vec![("src/main.rs".to_string(), 12345u64)];
        let hashes_b = vec![("src/main.rs".to_string(), 99999u64)];
        assert_ne!(
            combined_diff_sha(&hashes_a, 3),
            combined_diff_sha(&hashes_b, 3),
            "different file content should produce different fingerprint"
        );
    }

    #[test]
    fn combined_diff_sha_changes_with_context_lines() {
        let hashes = vec![("src/main.rs".to_string(), 12345u64)];
        assert_ne!(
            combined_diff_sha(&hashes, 3),
            combined_diff_sha(&hashes, 10),
            "different context_lines should produce different fingerprint"
        );
    }

    #[test]
    fn combined_diff_sha_sensitive_to_file_order() {
        let hashes_ab = vec![("a.rs".to_string(), 1u64), ("b.rs".to_string(), 2u64)];
        let hashes_ba = vec![("b.rs".to_string(), 2u64), ("a.rs".to_string(), 1u64)];
        // Order matters — files are hashed in iteration order.
        assert_ne!(
            combined_diff_sha(&hashes_ab, 3),
            combined_diff_sha(&hashes_ba, 3),
            "file order affects the fingerprint"
        );
    }

    #[test]
    fn parse_range_with_count() {
        assert_eq!(parse_range("10,5"), Some((10, 5)));
    }

    #[test]
    fn parse_range_single_line() {
        assert_eq!(parse_range("42"), Some((42, 1)));
    }

    #[test]
    fn parse_range_invalid() {
        assert_eq!(parse_range("abc"), None);
        assert_eq!(parse_range(""), None);
    }

    #[test]
    fn parse_hunk_header_standard() {
        let result = parse_hunk_header("@@ -1,3 +1,4 @@");
        assert_eq!(result, Some((1, 3, 1, 4)));
    }

    #[test]
    fn parse_hunk_header_single_line() {
        let result = parse_hunk_header("@@ -1 +1 @@");
        assert_eq!(result, Some((1, 1, 1, 1)));
    }

    #[test]
    fn parse_hunk_header_with_context() {
        let result = parse_hunk_header("@@ -10,5 +12,7 @@ fn main() {");
        assert_eq!(result, Some((10, 5, 12, 7)));
    }

    #[test]
    fn parse_hunk_header_invalid() {
        assert_eq!(parse_hunk_header("not a header"), None);
        assert_eq!(parse_hunk_header(""), None);
    }
}
