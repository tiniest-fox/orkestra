//! Read file content at HEAD.

use std::path::Path;
use std::process::Command;

use crate::types::GitError;

/// Read the content of a file at HEAD in a worktree.
///
/// Returns None if the file doesn't exist at HEAD.
pub fn execute(worktree_path: &Path, file_path: &str) -> Result<Option<String>, GitError> {
    let output = Command::new("git")
        .args(["show", &format!("HEAD:{file_path}")])
        .current_dir(worktree_path)
        .output()
        .map_err(|e| GitError::IoError(format!("Failed to read file at HEAD: {e}")))?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        if stderr.contains("does not exist") || stderr.contains("exists on disk, but not in") {
            return Ok(None);
        }
        return Err(GitError::IoError(format!("git show failed: {stderr}")));
    }

    Ok(Some(String::from_utf8_lossy(&output.stdout).to_string()))
}
