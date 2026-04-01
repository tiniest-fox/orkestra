//! Pull changes from origin using rebase.

use std::path::Path;
use std::process::Command;

use crate::types::GitError;

/// Pull changes from origin into the current branch using rebase.
///
/// If the rebase encounters conflicts, it is aborted to restore a clean working
/// tree and `GitError::MergeConflict` is returned.
pub fn execute(repo_path: &Path) -> Result<(), GitError> {
    let branch = crate::interactions::branch::current::execute(repo_path)?;

    if branch == "HEAD" {
        return Err(GitError::Other(
            "Cannot pull: in detached HEAD state".to_string(),
        ));
    }

    let output = Command::new("git")
        .args(["pull", "--rebase", "origin", &branch])
        .env("GIT_LFS_SKIP_SMUDGE", "1")
        .current_dir(repo_path)
        .output()
        .map_err(|e| GitError::Other(format!("Failed to run git pull: {e}")))?;

    if !output.status.success() {
        // Check for conflict files left by a failed rebase
        let conflict_output = Command::new("git")
            .args(["diff", "--name-only", "--diff-filter=U"])
            .env("GIT_LFS_SKIP_SMUDGE", "1")
            .current_dir(repo_path)
            .output()
            .map_err(|e| GitError::IoError(format!("Failed to check conflicts: {e}")))?;

        let conflict_files: Vec<String> = String::from_utf8_lossy(&conflict_output.stdout)
            .lines()
            .filter(|s| !s.is_empty())
            .map(String::from)
            .collect();

        // Abort the rebase to restore the working tree to a clean state
        let _ = Command::new("git")
            .args(["rebase", "--abort"])
            .env("GIT_LFS_SKIP_SMUDGE", "1")
            .current_dir(repo_path)
            .output();

        if !conflict_files.is_empty() {
            return Err(GitError::MergeConflict {
                branch,
                conflict_files,
            });
        }

        let stderr = String::from_utf8_lossy(&output.stderr);
        return Err(GitError::Other(format!(
            "git pull --rebase failed: {stderr}"
        )));
    }

    Ok(())
}
