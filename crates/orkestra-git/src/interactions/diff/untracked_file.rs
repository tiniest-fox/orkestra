//! Create a synthetic diff for an untracked file.

use std::fmt::Write;
use std::fs;
use std::path::Path;

use crate::types::{FileChangeType, FileDiff};

/// Create a [`FileDiff`] for an untracked file by reading its content.
pub fn execute(worktree_path: &Path, path: &str) -> Option<FileDiff> {
    let full_path = worktree_path.join(path);

    // Skip directories
    if full_path.is_dir() {
        return None;
    }

    // Check if it's a binary file (simple heuristic: check for null bytes)
    let content = fs::read(&full_path).ok()?;
    let is_binary = content.contains(&0);

    if is_binary {
        return Some(FileDiff {
            path: path.to_string(),
            change_type: FileChangeType::Added,
            old_path: None,
            additions: 0,
            deletions: 0,
            is_binary: true,
            diff_content: None,
        });
    }

    // Convert to string and create synthetic diff
    let text = String::from_utf8_lossy(&content);
    let lines: Vec<&str> = text.lines().collect();
    let line_count = lines.len();

    // Build synthetic unified diff content
    let mut diff_content = String::new();
    let _ = writeln!(diff_content, "diff --git a/{path} b/{path}");
    diff_content.push_str("new file mode 100644\n");
    diff_content.push_str("--- /dev/null\n");
    let _ = writeln!(diff_content, "+++ b/{path}");
    let _ = writeln!(diff_content, "@@ -0,0 +1,{line_count} @@");
    for line in &lines {
        diff_content.push('+');
        diff_content.push_str(line);
        diff_content.push('\n');
    }

    Some(FileDiff {
        path: path.to_string(),
        change_type: FileChangeType::Added,
        old_path: None,
        additions: line_count,
        deletions: 0,
        is_binary: false,
        diff_content: Some(diff_content),
    })
}
