//! Stage and commit pending changes in a worktree.

use std::path::Path;
use std::process::Command;

use crate::types::GitError;

/// Stage all changes and commit with the given message.
///
/// No-op if there are no changes to commit.
pub fn execute(worktree_path: &Path, message: &str) -> Result<(), GitError> {
    if !super::has_pending_changes::execute(worktree_path)? {
        return Ok(());
    }

    // Stage all changes
    let add_output = Command::new("git")
        .args(["add", "-A"])
        .current_dir(worktree_path)
        .output()
        .map_err(|e| GitError::IoError(format!("Failed to run git add: {e}")))?;

    if !add_output.status.success() {
        let stderr = String::from_utf8_lossy(&add_output.stderr);
        return Err(GitError::IoError(format!(
            "Failed to stage changes: {stderr}"
        )));
    }

    // Commit
    let commit_output = Command::new("git")
        .args(["commit", "-m", message])
        .current_dir(worktree_path)
        .output()
        .map_err(|e| GitError::IoError(format!("Failed to run git commit: {e}")))?;

    if !commit_output.status.success() {
        let stderr = String::from_utf8_lossy(&commit_output.stderr);
        if !stderr.contains("nothing to commit") {
            return Err(GitError::IoError(format!("Failed to commit: {stderr}")));
        }
    }

    Ok(())
}
