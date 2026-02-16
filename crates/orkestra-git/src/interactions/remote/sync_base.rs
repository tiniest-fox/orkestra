//! Sync a local branch with its remote tracking branch.

use std::path::Path;
use std::process::Command;

use crate::types::GitError;

/// Fetch from origin and fast-forward the local branch to match.
pub fn execute(repo_path: &Path, branch: &str) -> Result<(), GitError> {
    let output = Command::new("git")
        .args(["fetch", "origin", &format!("{branch}:{branch}")])
        .current_dir(repo_path)
        .output()
        .map_err(|e| GitError::Other(format!("Failed to run git fetch: {e}")))?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        if stderr.contains("Could not resolve host") || stderr.contains("unable to access") {
            return Err(GitError::Other(format!(
                "Network error syncing {branch}: {stderr}"
            )));
        }
        if stderr.contains("Authentication failed") || stderr.contains("Permission denied") {
            return Err(GitError::Other(format!(
                "Authentication error syncing {branch}: {stderr}"
            )));
        }
        if stderr.contains("non-fast-forward") || stderr.contains("rejected") {
            return Err(GitError::Other(format!(
                "Branch {branch} has diverged from origin (not fast-forwardable)"
            )));
        }
        return Err(GitError::Other(format!(
            "Failed to sync {branch} from origin: {stderr}"
        )));
    }

    Ok(())
}
