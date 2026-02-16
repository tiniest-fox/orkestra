//! Rebase the current branch onto a target branch.

use std::path::Path;
use std::process::Command;

use crate::types::GitError;

/// Rebase the current branch in a worktree onto the target branch.
///
/// If conflicts occur, the rebase is aborted and `GitError::MergeConflict` is returned.
pub fn execute(worktree_path: &Path, target_branch: &str) -> Result<(), GitError> {
    // Get branch name for error reporting
    let branch_output = Command::new("git")
        .args(["rev-parse", "--abbrev-ref", "HEAD"])
        .current_dir(worktree_path)
        .output()
        .map_err(|e| GitError::IoError(format!("Failed to get branch name: {e}")))?;

    if !branch_output.status.success() {
        let stderr = String::from_utf8_lossy(&branch_output.stderr);
        return Err(GitError::IoError(format!(
            "Failed to get branch name in {}: {stderr}",
            worktree_path.display()
        )));
    }

    let branch_name = String::from_utf8_lossy(&branch_output.stdout)
        .trim()
        .to_string();

    let rebase_output = Command::new("git")
        .args(["rebase", target_branch])
        .current_dir(worktree_path)
        .output()
        .map_err(|e| GitError::MergeError(format!("Failed to run git rebase: {e}")))?;

    if !rebase_output.status.success() {
        // Check for conflict files
        let conflict_output = Command::new("git")
            .args(["diff", "--name-only", "--diff-filter=U"])
            .current_dir(worktree_path)
            .output()
            .map_err(|e| GitError::IoError(format!("Failed to check conflicts: {e}")))?;

        let conflict_files: Vec<String> = String::from_utf8_lossy(&conflict_output.stdout)
            .lines()
            .filter(|s| !s.is_empty())
            .map(String::from)
            .collect();

        // Abort the rebase to restore original state
        let _ = Command::new("git")
            .args(["rebase", "--abort"])
            .current_dir(worktree_path)
            .output();

        if !conflict_files.is_empty() {
            return Err(GitError::MergeConflict {
                branch: branch_name,
                conflict_files,
            });
        }

        let stderr = String::from_utf8_lossy(&rebase_output.stderr);
        return Err(GitError::MergeError(format!(
            "Failed to rebase onto {target_branch}: {stderr}"
        )));
    }

    Ok(())
}
