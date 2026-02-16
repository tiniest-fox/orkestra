//! Run git diff, parse output, and append untracked files.

use std::path::Path;
use std::process::Command;

use crate::types::{GitError, TaskDiff};

/// Run git diff with given args, parse output, and append untracked files.
pub fn execute(worktree_path: &Path, git_args: &[&str]) -> Result<TaskDiff, GitError> {
    let output = Command::new("git")
        .args(git_args)
        .current_dir(worktree_path)
        .output()
        .map_err(|e| GitError::IoError(format!("Failed to execute git diff: {e}")))?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        return Err(GitError::IoError(format!("git diff failed: {stderr}")));
    }

    let stdout = String::from_utf8_lossy(&output.stdout);
    let mut task_diff = super::parse_output::execute(&stdout);

    // Add untracked files as new additions
    let untracked = get_untracked_files(worktree_path)?;
    for path in untracked {
        if let Some(file_diff) = super::untracked_file::execute(worktree_path, &path) {
            task_diff.files.push(file_diff);
        }
    }

    Ok(task_diff)
}

/// Get list of untracked files (excluding ignored files).
fn get_untracked_files(worktree_path: &Path) -> Result<Vec<String>, GitError> {
    let output = Command::new("git")
        .args(["ls-files", "--others", "--exclude-standard"])
        .current_dir(worktree_path)
        .output()
        .map_err(|e| GitError::IoError(format!("Failed to list untracked files: {e}")))?;

    if !output.status.success() {
        return Ok(vec![]);
    }

    let stdout = String::from_utf8_lossy(&output.stdout);
    Ok(stdout.lines().map(String::from).collect())
}
