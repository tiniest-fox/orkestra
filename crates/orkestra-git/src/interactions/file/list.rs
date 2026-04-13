//! List all git-tracked files in the repository.

use std::path::Path;
use std::process::Command;

use crate::types::GitError;

/// List all git-tracked files in the repository at `repo_path`.
pub fn execute(repo_path: &Path) -> Result<Vec<String>, GitError> {
    let output = Command::new("git")
        .args(["ls-files"])
        .current_dir(repo_path)
        .output()
        .map_err(|e| GitError::IoError(format!("Failed to list files: {e}")))?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        return Err(GitError::Other(format!("Failed to list files: {stderr}")));
    }

    let files: Vec<String> = String::from_utf8_lossy(&output.stdout)
        .lines()
        .filter(|s| !s.is_empty())
        .map(String::from)
        .collect();

    Ok(files)
}
