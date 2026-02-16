//! Create a git worktree for an existing branch.

use git2::Repository;
use std::path::Path;
use std::sync::Mutex;

use crate::types::GitError;

/// Create a worktree for an existing branch.
pub fn execute(
    repo: &Mutex<Repository>,
    task_id: &str,
    branch_name: &str,
    worktree_path: &Path,
) -> Result<(), GitError> {
    let repo = repo
        .lock()
        .map_err(|_| GitError::IoError("Repository mutex poisoned".into()))?;

    let branch = repo
        .find_branch(branch_name, git2::BranchType::Local)
        .map_err(|e| GitError::BranchError(format!("Failed to find branch: {e}")))?;
    let reference = branch.into_reference();

    let mut opts = git2::WorktreeAddOptions::new();
    opts.reference(Some(&reference));

    // git2 API requires &mut but doesn't actually mutate
    #[allow(clippy::unnecessary_mut_passed)]
    repo.worktree(task_id, worktree_path, Some(&mut opts))
        .map_err(|e| GitError::WorktreeError(format!("Failed to create worktree: {e}")))?;

    Ok(())
}
