//! Commits scoped to a task branch (commits not on the base branch).

use std::path::Path;
use std::process::Command;

use crate::types::{CommitInfo, GitError};

/// Get commits on the branch since it diverged from `base_branch`.
///
/// Runs `git log base_branch..HEAD` in `worktree_path`, returning up to `limit`
/// commits that exist on the task branch but not on the base branch.
pub fn execute(
    worktree_path: &Path,
    base_branch: &str,
    limit: usize,
) -> Result<Vec<CommitInfo>, GitError> {
    let revision_range = format!("{base_branch}..HEAD");
    let output = Command::new("git")
        .args([
            "log",
            &format!("-{limit}"),
            super::log::LOG_FORMAT,
            &revision_range,
        ])
        .current_dir(worktree_path)
        .output()
        .map_err(|e| GitError::IoError(format!("Failed to run git log: {e}")))?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        return Err(GitError::IoError(format!("git log failed: {stderr}")));
    }

    let stdout = String::from_utf8_lossy(&output.stdout);
    Ok(super::log::parse_log_output(&stdout))
}
