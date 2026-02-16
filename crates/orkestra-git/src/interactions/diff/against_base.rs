//! Diff worktree against base branch.

use std::path::Path;

use crate::types::{GitError, TaskDiff};

/// Get the diff between a task branch and its base branch.
///
/// Uses `git diff --merge-base` to compute the diff, plus untracked files.
pub fn execute(
    worktree_path: &Path,
    _branch_name: &str,
    base_branch: &str,
) -> Result<TaskDiff, GitError> {
    super::collect::execute(
        worktree_path,
        &[
            "diff",
            "--merge-base",
            base_branch,
            "--unified=3",
            "--no-color",
            "--numstat",
            "--no-renames",
            "-p",
        ],
    )
}
