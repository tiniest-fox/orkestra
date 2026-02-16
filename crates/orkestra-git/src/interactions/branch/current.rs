//! Get current branch name.

use std::path::Path;
use std::process::Command;

use crate::types::GitError;

/// Get the currently checked-out branch name.
///
/// Returns "HEAD" if in detached HEAD state.
pub fn execute(repo_path: &Path) -> Result<String, GitError> {
    let output = Command::new("git")
        .args(["rev-parse", "--abbrev-ref", "HEAD"])
        .current_dir(repo_path)
        .output()
        .map_err(|e| GitError::IoError(format!("Failed to get current branch: {e}")))?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        return Err(GitError::BranchError(format!(
            "Failed to get current branch: {stderr}"
        )));
    }

    let branch = String::from_utf8_lossy(&output.stdout).trim().to_string();
    Ok(branch)
}
