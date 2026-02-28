//! Merge a target branch into the current worktree branch.

use std::path::Path;
use std::process::Command;

use crate::types::GitError;

/// Merge the target branch into the current branch in the worktree.
///
/// Uses `--no-ff` to always create a merge commit. On conflict, returns
/// `GitError::MergeConflict` with the conflicting files — the merge is NOT
/// aborted so conflict markers remain in the working tree for agent resolution.
pub fn execute(worktree_path: &Path, target_branch: &str) -> Result<(), GitError> {
    let merge_output = Command::new("git")
        .args(["merge", "--no-ff", target_branch])
        .current_dir(worktree_path)
        .output()
        .map_err(|e| GitError::MergeError(format!("Failed to run git merge: {e}")))?;

    if !merge_output.status.success() {
        // Collect unmerged paths to distinguish conflicts from other failures.
        let conflict_output = Command::new("git")
            .args(["diff", "--name-only", "--diff-filter=U"])
            .current_dir(worktree_path)
            .output()
            .map_err(|e| GitError::IoError(format!("Failed to check conflicts: {e}")))?;

        let conflict_files: Vec<String> = String::from_utf8_lossy(&conflict_output.stdout)
            .lines()
            .filter(|s| !s.is_empty())
            .map(String::from)
            .collect();

        if !conflict_files.is_empty() {
            // Do NOT abort — leave conflict markers in place for the agent to resolve.
            let branch_name = Command::new("git")
                .args(["rev-parse", "--abbrev-ref", "HEAD"])
                .current_dir(worktree_path)
                .output()
                .ok()
                .filter(|o| o.status.success())
                .map(|o| String::from_utf8_lossy(&o.stdout).trim().to_string())
                .unwrap_or_default();

            return Err(GitError::MergeConflict {
                branch: branch_name,
                conflict_files,
            });
        }

        let stderr = String::from_utf8_lossy(&merge_output.stderr);
        return Err(GitError::MergeError(format!(
            "Failed to merge {target_branch}: {stderr}"
        )));
    }

    Ok(())
}
