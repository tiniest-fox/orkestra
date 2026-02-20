//! Fetch from origin to update remote-tracking refs.

use std::path::Path;
use std::process::Command;

use crate::types::GitError;

/// Fetch from origin without merging.
pub fn execute(repo_path: &Path) -> Result<(), GitError> {
    let output = Command::new("git")
        .args(["fetch", "origin"])
        .current_dir(repo_path)
        .output()
        .map_err(|e| GitError::Other(format!("Failed to run git fetch: {e}")))?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        return Err(GitError::Other(format!("git fetch failed: {stderr}")));
    }

    Ok(())
}
