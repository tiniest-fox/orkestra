//! Diff uncommitted changes in a worktree.

use std::path::Path;
use std::process::Command;

use crate::types::{GitError, TaskDiff};

/// Get the diff of uncommitted changes (staged + unstaged + untracked) relative to HEAD.
pub fn execute(worktree_path: &Path) -> Result<TaskDiff, GitError> {
    // Check for edge case: first commit on a branch (no HEAD yet)
    let head_check = Command::new("git")
        .args(["rev-parse", "HEAD"])
        .current_dir(worktree_path)
        .output()
        .map_err(|e| GitError::IoError(format!("Failed to check HEAD: {e}")))?;

    if !head_check.status.success() {
        return Ok(TaskDiff { files: vec![] });
    }

    super::collect::execute(
        worktree_path,
        &[
            "diff",
            "HEAD",
            "--unified=3",
            "--no-color",
            "--numstat",
            "--no-renames",
            "-p",
        ],
    )
}
