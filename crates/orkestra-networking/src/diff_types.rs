//! Diff response types shared between diff handlers and the diff cache.

use orkestra_core::workflow::ports::FileChangeType;
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
}

/// Syntax CSS for light and dark themes.
#[derive(Debug, Serialize)]
pub struct SyntaxCss {
    pub light: String,
    pub dark: String,
}
