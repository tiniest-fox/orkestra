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

/// Stable content hash for a `FileDiff` entry.
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
}
