//! Build diff summary strings from task worktree changes.

use std::path::Path;

use crate::workflow::domain::Task;
use crate::workflow::ports::{FileChangeType, FileDiff, GitService, TaskDiff};

/// Build a diff summary string from a task's uncommitted worktree changes.
pub(crate) fn execute(git: &dyn GitService, task: &Task) -> String {
    let Some(worktree_path) = &task.worktree_path else {
        return String::from("No worktree");
    };

    match git.diff_uncommitted(Path::new(worktree_path)) {
        Ok(diff) => format_diff_summary(&diff),
        Err(e) => {
            crate::orkestra_debug!("commit", "Failed to get diff for commit message: {e}");
            String::from("Diff unavailable")
        }
    }
}

/// Build a diff summary string from a task's committed changes (all commits on branch).
///
/// Used for squash commit message generation, where we need to summarize all committed
/// changes on the branch, not just uncommitted changes.
pub(crate) fn execute_for_committed(git: &dyn GitService, task: &Task) -> String {
    let Some(worktree_path) = &task.worktree_path else {
        return String::from("No worktree");
    };
    let Some(branch_name) = &task.branch_name else {
        return String::from("No branch");
    };

    match git.diff_against_base(Path::new(worktree_path), branch_name, &task.base_branch, 3) {
        Ok(diff) => format_diff_summary(&diff),
        Err(e) => {
            crate::orkestra_debug!(
                "commit",
                "Failed to get committed diff for commit message: {e}"
            );
            String::from("Diff unavailable")
        }
    }
}

/// Build a metadata-only file list from a task's committed changes.
///
/// Returns path, change type, and line counts — no diff content.
/// Used for PR generation where the agent discovers diffs via tools.
pub(crate) fn execute_file_metadata(git: &dyn GitService, task: &Task) -> String {
    let Some(worktree_path) = &task.worktree_path else {
        return String::from("No worktree");
    };
    let Some(branch_name) = &task.branch_name else {
        return String::from("No branch");
    };
    // context_lines=0 since we don't need diff content
    match git.diff_against_base(Path::new(worktree_path), branch_name, &task.base_branch, 0) {
        Ok(diff) => format_file_metadata(&diff),
        Err(e) => {
            crate::orkestra_debug!("commit", "Failed to get file metadata: {e}");
            String::from("File list unavailable")
        }
    }
}

// -- Helpers --

/// Format a `TaskDiff` into a human-readable summary.
///
/// Includes unified diff content for files where it is available, up to a ~8000-character
/// budget. Most-changed files are prioritized; files that exceed the budget get stats only.
fn format_diff_summary(diff: &TaskDiff) -> String {
    use std::fmt::Write;
    const DIFF_BUDGET: usize = 8000;

    if diff.files.is_empty() {
        return "No file changes detected".to_string();
    }

    // Sort by most changes first (prioritize including diffs for the most-changed files)
    let mut files_by_change: Vec<_> = diff.files.iter().collect();
    files_by_change.sort_by(|a, b| (b.additions + b.deletions).cmp(&(a.additions + a.deletions)));

    let mut used = 0usize;
    let mut include_diff: Vec<(&FileDiff, bool)> = Vec::new();
    for file in &files_by_change {
        if let Some(content) = file.diff_content.as_ref().filter(|d| !d.is_empty()) {
            let len = content.len();
            if used + len <= DIFF_BUDGET {
                used += len;
                include_diff.push((file, true));
            } else {
                include_diff.push((file, false));
            }
        } else {
            include_diff.push((file, false));
        }
    }

    // Re-sort back to original order (by path) for stable output
    include_diff.sort_by(|a, b| a.0.path.cmp(&b.0.path));

    let mut summary = String::new();
    for (file, show_diff) in &include_diff {
        let change = match file.change_type {
            FileChangeType::Added => "added",
            FileChangeType::Modified => "modified",
            FileChangeType::Deleted => "deleted",
            FileChangeType::Renamed => "renamed",
        };
        let _ = writeln!(
            summary,
            "- {} ({}, +{} -{})",
            file.path, change, file.additions, file.deletions
        );
        if *show_diff {
            if let Some(content) = &file.diff_content {
                let _ = writeln!(summary, "```diff\n{content}```");
            }
        }
    }
    summary
}

/// Format a `TaskDiff` into a metadata-only file list (no diff content).
fn format_file_metadata(diff: &TaskDiff) -> String {
    use std::fmt::Write;

    if diff.files.is_empty() {
        return "No file changes detected".to_string();
    }
    let mut summary = String::new();
    for file in &diff.files {
        let change = match file.change_type {
            FileChangeType::Added => "added",
            FileChangeType::Modified => "modified",
            FileChangeType::Deleted => "deleted",
            FileChangeType::Renamed => "renamed",
        };
        let _ = writeln!(
            summary,
            "- {} ({}, +{} -{})",
            file.path, change, file.additions, file.deletions
        );
    }
    summary
}

// ============================================================================
// Tests
// ============================================================================

#[cfg(test)]
mod tests {
    use super::*;

    fn make_file(
        path: &str,
        additions: usize,
        deletions: usize,
        diff_content: Option<&str>,
    ) -> FileDiff {
        FileDiff {
            path: path.to_string(),
            change_type: FileChangeType::Modified,
            old_path: None,
            additions,
            deletions,
            is_binary: false,
            diff_content: diff_content.map(std::string::ToString::to_string),
            total_new_lines: None,
        }
    }

    fn make_diff(files: Vec<FileDiff>) -> TaskDiff {
        TaskDiff { files }
    }

    #[test]
    fn all_files_fit_within_budget() {
        let diff = make_diff(vec![
            make_file("a.rs", 5, 2, Some("@@ -1 +1 @@\n+hello\n")),
            make_file("b.rs", 3, 1, Some("@@ -1 +1 @@\n+world\n")),
            make_file("c.rs", 1, 0, Some("@@ -1 +1 @@\n+!\n")),
        ]);
        let result = format_diff_summary(&diff);
        assert!(result.contains("```diff"), "expected diff fences in output");
        assert!(result.contains("a.rs"));
        assert!(result.contains("b.rs"));
        assert!(result.contains("c.rs"));
    }

    #[test]
    fn some_files_truncated() {
        // large=5000, medium=4000, small=100 — large+small fit (5100 <= 8000), medium does not
        let large_diff = "x".repeat(5000);
        let medium_diff = "y".repeat(4000);
        let small_diff = "z".repeat(100);

        // large has most changes (100+100=200), medium next (50+50=100), small least (1+1=2)
        let diff = make_diff(vec![
            make_file("large.rs", 100, 100, Some(&large_diff)),
            make_file("medium.rs", 50, 50, Some(&medium_diff)),
            make_file("small.rs", 1, 1, Some(&small_diff)),
        ]);
        let result = format_diff_summary(&diff);

        // large.rs should have diff (5000 <= 8000)
        // medium.rs should be stats-only (5000+4000=9000 > 8000)
        // small.rs should have diff (5000+100=5100 <= 8000, processed after large which has more changes)
        assert!(result.contains("large.rs"), "large.rs should be in output");
        assert!(
            result.contains("medium.rs"),
            "medium.rs should be in output"
        );
        assert!(result.contains("small.rs"), "small.rs should be in output");

        // Find medium.rs line — it should NOT have a diff fence immediately after
        let medium_pos = result.find("medium.rs").unwrap();
        let after_medium = &result[medium_pos..];
        let next_newline = after_medium.find('\n').unwrap();
        let after_medium_line = &after_medium[next_newline..];
        assert!(
            !after_medium_line.starts_with("\n```diff"),
            "medium.rs should be stats-only"
        );
    }

    #[test]
    fn all_files_exceed_budget() {
        let huge_diff = "x".repeat(9000);
        let diff = make_diff(vec![make_file("huge.rs", 200, 200, Some(&huge_diff))]);
        let result = format_diff_summary(&diff);
        assert!(result.contains("huge.rs"), "huge.rs should appear");
        assert!(
            !result.contains("```diff"),
            "no diff fence when over budget"
        );
    }

    #[test]
    fn no_diff_content() {
        let diff = make_diff(vec![
            make_file("a.rs", 10, 5, None),
            make_file("b.rs", 2, 0, None),
        ]);
        let result = format_diff_summary(&diff);
        assert!(result.contains("a.rs"));
        assert!(result.contains("b.rs"));
        assert!(!result.contains("```diff"));
    }

    #[test]
    fn empty_diff() {
        let diff = make_diff(vec![]);
        assert_eq!(format_diff_summary(&diff), "No file changes detected");
    }

    #[test]
    fn mixed_binary_and_text() {
        let text_diff = "@@ -1 +1 @@\n+hello\n";
        let binary_file = FileDiff {
            path: "image.png".to_string(),
            change_type: FileChangeType::Modified,
            old_path: None,
            additions: 0,
            deletions: 0,
            is_binary: true,
            diff_content: None,
            total_new_lines: None,
        };

        let diff = make_diff(vec![
            binary_file,
            make_file("text.rs", 5, 3, Some(text_diff)),
        ]);
        let result = format_diff_summary(&diff);
        assert!(result.contains("image.png"), "binary file should appear");
        assert!(result.contains("text.rs"), "text file should appear");
        // text file has diff content, should include it
        assert!(
            result.contains("```diff"),
            "text file diff should be included"
        );
    }

    // -- format_file_metadata tests --

    #[test]
    fn metadata_format() {
        let diff = make_diff(vec![
            make_file("src/main.rs", 10, 3, Some("@@ diff content @@")),
            make_file("src/lib.rs", 5, 0, None),
        ]);
        let result = format_file_metadata(&diff);
        assert!(result.contains("src/main.rs (modified, +10 -3)"));
        assert!(result.contains("src/lib.rs (modified, +5 -0)"));
        // No diff content should appear
        assert!(!result.contains("```diff"));
        assert!(!result.contains("diff content"));
    }

    #[test]
    fn empty_diff_returns_no_changes() {
        let diff = make_diff(vec![]);
        assert_eq!(format_file_metadata(&diff), "No file changes detected");
    }

    #[test]
    fn mixed_change_types() {
        let added = FileDiff {
            path: "new_file.rs".to_string(),
            change_type: FileChangeType::Added,
            old_path: None,
            additions: 20,
            deletions: 0,
            is_binary: false,
            diff_content: None,
            total_new_lines: None,
        };
        let deleted = FileDiff {
            path: "old_file.rs".to_string(),
            change_type: FileChangeType::Deleted,
            old_path: None,
            additions: 0,
            deletions: 15,
            is_binary: false,
            diff_content: None,
            total_new_lines: None,
        };
        let renamed = FileDiff {
            path: "renamed.rs".to_string(),
            change_type: FileChangeType::Renamed,
            old_path: Some("original.rs".to_string()),
            additions: 2,
            deletions: 2,
            is_binary: false,
            diff_content: None,
            total_new_lines: None,
        };
        let diff = make_diff(vec![added, deleted, renamed]);
        let result = format_file_metadata(&diff);
        assert!(result.contains("new_file.rs (added, +20 -0)"));
        assert!(result.contains("old_file.rs (deleted, +0 -15)"));
        assert!(result.contains("renamed.rs (renamed, +2 -2)"));
    }
}
