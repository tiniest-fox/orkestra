//! Check for uncommitted work in a worktree.

use std::path::Path;
use std::process::Command;

use crate::types::GitError;

/// Check whether a worktree has uncommitted changes (staged or unstaged).
pub fn execute(worktree_path: &Path) -> Result<bool, GitError> {
    let output = Command::new("git")
        .args(["status", "--porcelain"])
        .current_dir(worktree_path)
        .output()
        .map_err(|e| GitError::IoError(format!("Failed to run git status: {e}")))?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        return Err(GitError::IoError(format!(
            "Failed to check pending changes in {}: {stderr}",
            worktree_path.display()
        )));
    }

    let status = String::from_utf8_lossy(&output.stdout);
    Ok(!status.trim().is_empty())
}
