//! Build diff summary strings from task worktree changes.

use std::path::Path;

use crate::workflow::domain::Task;
use crate::workflow::ports::{FileChangeType, GitService, TaskDiff};

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

// -- Helpers --

/// Format a `TaskDiff` into a human-readable summary.
fn format_diff_summary(diff: &TaskDiff) -> String {
    use std::fmt::Write;

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
    if summary.is_empty() {
        "No file changes detected".to_string()
    } else {
        summary
    }
}
