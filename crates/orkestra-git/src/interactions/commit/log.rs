//! Git log (most recent commits on current branch).

use std::path::Path;
use std::process::Command;

use crate::types::{CommitInfo, GitError};

/// Format string for `git log` output: record-separated fields per commit.
///
/// Fields (null-delimited): hash, subject, author name, author ISO date, body.
pub(super) const LOG_FORMAT: &str = "--format=%x1e%h%x00%s%x00%an%x00%aI%x00%b";

/// Get the N most recent commits on the current branch.
pub fn execute(repo_path: &Path, limit: usize) -> Result<Vec<CommitInfo>, GitError> {
    // Use record separator (0x1e) between commits to handle multi-line bodies
    let output = Command::new("git")
        .args(["log", &format!("-{limit}"), LOG_FORMAT])
        .current_dir(repo_path)
        .output()
        .map_err(|e| GitError::IoError(format!("Failed to run git log: {e}")))?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        return Err(GitError::IoError(format!("git log failed: {stderr}")));
    }

    let stdout = String::from_utf8_lossy(&output.stdout);
    Ok(parse_log_output(&stdout))
}

/// Parse the output of `git log` formatted with [`LOG_FORMAT`] into [`CommitInfo`] records.
pub(super) fn parse_log_output(stdout: &str) -> Vec<CommitInfo> {
    let mut commits = Vec::new();

    for record in stdout.split('\x1e') {
        let record = record.trim();
        if record.is_empty() {
            continue;
        }
        let parts: Vec<&str> = record.splitn(5, '\0').collect();
        if parts.len() == 5 {
            let body_text = parts[4].trim();
            let body = if body_text.is_empty() {
                None
            } else {
                Some(body_text.to_string())
            };
            commits.push(CommitInfo {
                hash: parts[0].to_string(),
                message: parts[1].to_string(),
                body,
                author: parts[2].to_string(),
                timestamp: parts[3].to_string(),
                file_count: None,
            });
        }
    }

    commits
}
