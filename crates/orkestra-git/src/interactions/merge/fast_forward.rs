//! Merge a branch into a target branch.

use std::path::Path;
use std::process::Command;

use crate::types::{GitError, MergeResult};

/// Merge a branch into the target branch using fast-forward only.
///
/// Operates in the given working directory. Stashes uncommitted changes,
/// performs the merge, then restores the stash.
pub fn execute(
    repo_path: &Path,
    worktrees_dir: &Path,
    branch_name: &str,
    target_branch: &str,
) -> Result<MergeResult, GitError> {
    let working_dir = crate::interactions::branch::resolve_working_dir::execute(
        repo_path,
        worktrees_dir,
        target_branch,
    )?;
    let was_stashed = crate::interactions::stash::push::execute(&working_dir)?;

    let merge_result = fast_forward_merge(&working_dir, branch_name, target_branch);

    crate::interactions::stash::pop::execute(&working_dir, was_stashed)?;

    merge_result
}

/// Perform fast-forward merge in a specific working directory.
fn fast_forward_merge(
    working_dir: &Path,
    source: &str,
    target: &str,
) -> Result<MergeResult, GitError> {
    // Detect if this is a worktree by checking if .git is a file (not a directory)
    let is_worktree = working_dir.join(".git").is_file();

    if !is_worktree {
        // Checkout the target branch (only needed in main repo)
        let checkout_output = Command::new("git")
            .args(["checkout", target])
            .current_dir(working_dir)
            .output()
            .map_err(|e| {
                GitError::MergeError(format!(
                    "Failed to checkout {target} in {}: {e}",
                    working_dir.display()
                ))
            })?;

        if !checkout_output.status.success() {
            let stderr = String::from_utf8_lossy(&checkout_output.stderr);
            return Err(GitError::MergeError(format!(
                "Failed to checkout {target} in {}: {stderr}",
                working_dir.display()
            )));
        }
    }

    // Fast-forward merge
    let merge_output = Command::new("git")
        .args(["merge", "--ff-only", source])
        .current_dir(working_dir)
        .output()
        .map_err(|e| {
            GitError::MergeError(format!(
                "Failed to merge {source} into {target} in {}: {e}",
                working_dir.display()
            ))
        })?;

    if !merge_output.status.success() {
        let stderr = String::from_utf8_lossy(&merge_output.stderr);
        return Err(GitError::MergeError(format!(
            "Failed to merge {source} into {target} in {}: {stderr}",
            working_dir.display()
        )));
    }

    // Get the resulting commit SHA
    let head_output = Command::new("git")
        .args(["rev-parse", "HEAD"])
        .current_dir(working_dir)
        .output()
        .map_err(|e| {
            GitError::MergeError(format!(
                "Failed to get HEAD in {}: {e}",
                working_dir.display()
            ))
        })?;

    if !head_output.status.success() {
        let stderr = String::from_utf8_lossy(&head_output.stderr);
        return Err(GitError::MergeError(format!(
            "Failed to get HEAD after merge in {}: {stderr}",
            working_dir.display()
        )));
    }

    let commit_sha = String::from_utf8_lossy(&head_output.stdout)
        .trim()
        .to_string();

    Ok(MergeResult {
        commit_sha,
        target_branch: target.to_string(),
        merged_at: chrono::Utc::now().to_rfc3339(),
    })
}
