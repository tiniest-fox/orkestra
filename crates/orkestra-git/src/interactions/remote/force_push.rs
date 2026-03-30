//! Force-push a branch to the remote using --force-with-lease.

use std::path::Path;
use std::process::Command;

use crate::types::GitError;

/// Force-push a branch to origin using --force-with-lease.
pub fn execute(repo_path: &Path, branch: &str) -> Result<(), GitError> {
    let output = Command::new("git")
        .args(["push", "--force-with-lease", "-u", "origin", branch])
        .current_dir(repo_path)
        .output()
        .map_err(|e| GitError::Other(format!("Failed to run git push: {e}")))?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        return Err(GitError::Other(format!("git force push failed: {stderr}")));
    }

    Ok(())
}
