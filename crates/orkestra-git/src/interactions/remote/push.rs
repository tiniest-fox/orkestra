//! Push a branch to the remote.

use std::path::Path;
use std::process::Command;

use crate::types::GitError;

/// Push a branch to origin.
pub fn execute(repo_path: &Path, branch: &str) -> Result<(), GitError> {
    let output = Command::new("git")
        .args(["push", "-u", "origin", branch])
        .current_dir(repo_path)
        .output()
        .map_err(|e| GitError::Other(format!("Failed to run git push: {e}")))?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        return Err(GitError::Other(format!("git push failed: {stderr}")));
    }

    Ok(())
}
