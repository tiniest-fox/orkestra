//! Check sync status relative to remote.

use std::path::Path;
use std::process::Command;

use crate::types::{GitError, SyncStatus};

/// Get ahead/behind counts relative to origin for the current branch.
///
/// Returns None if in detached HEAD state or branch doesn't exist on origin.
pub fn execute(repo_path: &Path) -> Result<Option<SyncStatus>, GitError> {
    let branch = crate::interactions::branch::current::execute(repo_path)?;

    if branch == "HEAD" {
        return Ok(None);
    }

    // Check if origin/{branch} exists
    let verify_output = Command::new("git")
        .args(["rev-parse", "--verify", &format!("origin/{branch}")])
        .current_dir(repo_path)
        .output()
        .map_err(|e| GitError::IoError(format!("Failed to run git rev-parse: {e}")))?;

    if !verify_output.status.success() {
        return Ok(None);
    }

    // Get ahead/behind counts
    let output = Command::new("git")
        .args([
            "rev-list",
            "--count",
            "--left-right",
            &format!("origin/{branch}...{branch}"),
        ])
        .current_dir(repo_path)
        .output()
        .map_err(|e| GitError::IoError(format!("Failed to run git rev-list: {e}")))?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        return Err(GitError::Other(format!(
            "Failed to get sync status: {stderr}"
        )));
    }

    let stdout = String::from_utf8_lossy(&output.stdout);
    let parts: Vec<&str> = stdout.trim().split('\t').collect();

    if parts.len() != 2 {
        return Err(GitError::Other(format!(
            "Unexpected rev-list output format: {stdout}"
        )));
    }

    let behind: u32 = parts[0]
        .parse()
        .map_err(|_| GitError::Other(format!("Failed to parse behind count from: {}", parts[0])))?;

    let ahead: u32 = parts[1]
        .parse()
        .map_err(|_| GitError::Other(format!("Failed to parse ahead count from: {}", parts[1])))?;

    Ok(Some(SyncStatus { ahead, behind }))
}
