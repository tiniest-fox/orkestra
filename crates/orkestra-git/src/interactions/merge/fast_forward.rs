//! Merge a branch into a target branch.

use std::path::Path;
use std::process::Command;

use crate::types::{GitError, MergeResult};

/// Merge a branch into the target branch.
///
/// Operates in the given working directory. Stashes uncommitted changes,
/// performs the merge, then restores the stash. Stash pop failure is
/// non-fatal: the merge result is returned successfully and the caller is
/// responsible for informing the user that `git stash pop` may need to be
/// run manually.
///
/// When `message` is `Some`, uses `--no-ff -m <message>` to create an
/// explicit merge commit with the given message. When `None`, uses
/// `--ff-only` (fast-forward only, no new commit if possible).
pub fn execute(
    repo_path: &Path,
    worktrees_dir: &Path,
    branch_name: &str,
    target_branch: &str,
    message: Option<&str>,
) -> Result<MergeResult, GitError> {
    let working_dir = crate::interactions::branch::resolve_working_dir::execute(
        repo_path,
        worktrees_dir,
        target_branch,
    )?;
    let was_stashed = crate::interactions::stash::push::execute(&working_dir)?;

    let merge_result = do_merge(&working_dir, branch_name, target_branch, message);

    // Always attempt to pop the stash for cleanup, but treat failure as
    // non-fatal: if the merge itself succeeded the integration is complete.
    // Failure here most often means the stashed changes conflict with the
    // newly merged state; the stash entry remains and can be restored with
    // `git stash pop` in the working directory.
    let pop_result = crate::interactions::stash::pop::execute(&working_dir, was_stashed);

    match merge_result {
        Ok(result) => {
            if let Err(e) = pop_result {
                eprintln!(
                    "[orkestra-git] Warning: stash pop failed after successful merge in {} — \
                     run `git stash pop` manually to restore uncommitted changes. Error: {e}",
                    working_dir.display()
                );
            }
            Ok(result)
        }
        Err(merge_err) => {
            // Merge failed; stash pop was best-effort cleanup, ignore its result.
            Err(merge_err)
        }
    }
}

/// Perform the merge in a specific working directory.
///
/// Uses `--no-ff -m <message>` when a message is provided, otherwise `--ff-only`.
fn do_merge(
    working_dir: &Path,
    source: &str,
    target: &str,
    message: Option<&str>,
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

    // Merge: --no-ff with custom message, or --ff-only
    let mut cmd = Command::new("git");
    cmd.current_dir(working_dir);

    if let Some(msg) = message {
        cmd.args(["merge", "--no-ff", "-m", msg, source]);
    } else {
        cmd.args(["merge", "--ff-only", source]);
    }

    let merge_output = cmd.output().map_err(|e| {
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
