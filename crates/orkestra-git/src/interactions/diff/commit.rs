//! Diff a single commit.

use std::path::Path;
use std::process::Command;

use crate::types::{GitError, TaskDiff};

/// Get the diff for a specific commit.
pub fn execute(
    repo_path: &Path,
    commit_hash: &str,
    context_lines: u32,
) -> Result<TaskDiff, GitError> {
    // Try normal case (commit with parent)
    let output = Command::new("git")
        .args([
            "diff",
            &format!("{commit_hash}^..{commit_hash}"),
            &format!("--unified={context_lines}"),
            "--no-color",
            "--numstat",
            "--no-renames",
            "-p",
        ])
        .current_dir(repo_path)
        .output()
        .map_err(|e| GitError::IoError(format!("Failed to run git diff for commit: {e}")))?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        // Handle initial commit (no parent)
        if stderr.contains("unknown revision") || stderr.contains("bad revision") {
            let fallback = Command::new("git")
                .args([
                    "show",
                    &format!("--unified={context_lines}"),
                    "--no-color",
                    "--numstat",
                    "--no-renames",
                    "-p",
                    "--format=",
                    commit_hash,
                ])
                .current_dir(repo_path)
                .output()
                .map_err(|e| {
                    GitError::IoError(format!("Failed to run git show for initial commit: {e}"))
                })?;

            if !fallback.status.success() {
                let fallback_stderr = String::from_utf8_lossy(&fallback.stderr);
                return Err(GitError::IoError(format!(
                    "git show failed for initial commit: {fallback_stderr}"
                )));
            }
            let stdout = String::from_utf8_lossy(&fallback.stdout);
            return Ok(super::parse_output::execute(&stdout));
        }
        return Err(GitError::IoError(format!("git diff failed: {stderr}")));
    }

    let stdout = String::from_utf8_lossy(&output.stdout);
    Ok(super::parse_output::execute(&stdout))
}
