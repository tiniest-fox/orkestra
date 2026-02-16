//! Pull changes from origin.

use std::path::Path;
use std::process::Command;

use crate::types::GitError;

/// Pull changes from origin into the current branch (fast-forward only).
pub fn execute(repo_path: &Path) -> Result<(), GitError> {
    let branch = crate::interactions::branch::current::execute(repo_path)?;

    if branch == "HEAD" {
        return Err(GitError::Other(
            "Cannot pull: in detached HEAD state".to_string(),
        ));
    }

    let output = Command::new("git")
        .args(["pull", "--ff-only", "origin", &branch])
        .current_dir(repo_path)
        .output()
        .map_err(|e| GitError::Other(format!("Failed to run git pull: {e}")))?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);

        if stderr.contains("non-fast-forward") || stderr.contains("Not possible to fast-forward") {
            return Err(GitError::Other(format!(
                "Cannot pull: local branch has diverged from origin/{branch}"
            )));
        }

        return Err(GitError::Other(format!("git pull failed: {stderr}")));
    }

    Ok(())
}
