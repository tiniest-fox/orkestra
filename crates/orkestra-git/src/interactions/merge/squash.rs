//! Squash commits since merge-base into a single commit.

use std::path::Path;
use std::process::Command;

use crate::types::GitError;

/// Squash all commits since merge-base with `target_branch` into a single commit.
///
/// Returns `Ok(true)` if commits were squashed, `Ok(false)` if there were
/// no commits to squash.
pub fn execute(worktree_path: &Path, target_branch: &str, message: &str) -> Result<bool, GitError> {
    // 1. Find merge-base
    let merge_base_output = Command::new("git")
        .args(["merge-base", "HEAD", target_branch])
        .current_dir(worktree_path)
        .output()
        .map_err(|e| GitError::Other(format!("Failed to find merge-base: {e}")))?;

    if !merge_base_output.status.success() {
        let stderr = String::from_utf8_lossy(&merge_base_output.stderr);
        return Err(GitError::BranchError(format!(
            "Failed to find merge-base with {target_branch}: {stderr}"
        )));
    }

    let merge_base = String::from_utf8_lossy(&merge_base_output.stdout)
        .trim()
        .to_string();

    // 2. Check if we're already at merge-base (no commits to squash)
    let head_output = Command::new("git")
        .args(["rev-parse", "HEAD"])
        .current_dir(worktree_path)
        .output()
        .map_err(|e| GitError::Other(format!("Failed to get HEAD: {e}")))?;

    let head = String::from_utf8_lossy(&head_output.stdout)
        .trim()
        .to_string();

    if head == merge_base {
        return Ok(false);
    }

    // 3. git reset --soft merge-base
    let reset_output = Command::new("git")
        .args(["reset", "--soft", &merge_base])
        .current_dir(worktree_path)
        .output()
        .map_err(|e| GitError::Other(format!("Failed to reset: {e}")))?;

    if !reset_output.status.success() {
        let stderr = String::from_utf8_lossy(&reset_output.stderr);
        return Err(GitError::Other(format!(
            "git reset --soft failed: {stderr}"
        )));
    }

    // 4. Create new commit with provided message
    let commit_output = Command::new("git")
        .args(["commit", "-m", message])
        .current_dir(worktree_path)
        .output()
        .map_err(|e| GitError::Other(format!("Failed to commit: {e}")))?;

    if !commit_output.status.success() {
        let stderr = String::from_utf8_lossy(&commit_output.stderr);
        return Err(GitError::Other(format!("Squash commit failed: {stderr}")));
    }

    Ok(true)
}
