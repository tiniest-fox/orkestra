//! Check if a branch is merged into a target.

use std::path::Path;
use std::process::Command;

use crate::types::GitError;

/// Check if `branch_name` is fully merged into `target_branch`.
///
/// Returns `true` if the branch doesn't exist (already cleaned up after merge).
pub fn execute(repo_path: &Path, branch_name: &str, target_branch: &str) -> Result<bool, GitError> {
    // Check if the branch still exists
    let verify_output = Command::new("git")
        .args([
            "rev-parse",
            "--verify",
            &format!("refs/heads/{branch_name}"),
        ])
        .current_dir(repo_path)
        .output()
        .map_err(|e| GitError::IoError(format!("Failed to check branch existence: {e}")))?;

    if !verify_output.status.success() {
        return Ok(true);
    }

    // Check if branch_name is an ancestor of target_branch
    let output = Command::new("git")
        .args(["merge-base", "--is-ancestor", branch_name, target_branch])
        .current_dir(repo_path)
        .output()
        .map_err(|e| GitError::IoError(format!("Failed to check merge-base: {e}")))?;

    Ok(output.status.success())
}
