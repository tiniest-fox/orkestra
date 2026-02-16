//! List non-task branches.

use std::path::Path;
use std::process::Command;

use crate::types::GitError;

/// List local branches, excluding task/* worktree branches.
pub fn execute(repo_path: &Path) -> Result<Vec<String>, GitError> {
    let output = Command::new("git")
        .args(["branch", "--format=%(refname:short)"])
        .current_dir(repo_path)
        .output()
        .map_err(|e| GitError::IoError(format!("Failed to list branches: {e}")))?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        return Err(GitError::BranchError(format!(
            "Failed to list branches: {stderr}"
        )));
    }

    let branches: Vec<String> = String::from_utf8_lossy(&output.stdout)
        .lines()
        .filter(|s| !s.is_empty())
        .filter(|s| !s.starts_with("task/"))
        .map(String::from)
        .collect();

    Ok(branches)
}
