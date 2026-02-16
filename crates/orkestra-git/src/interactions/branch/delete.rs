//! Delete a branch.

use git2::Repository;
use std::sync::Mutex;

use crate::types::GitError;

/// Delete a branch using git2 API.
pub fn execute(repo: &Mutex<Repository>, branch_name: &str) -> Result<(), GitError> {
    let repo = repo
        .lock()
        .map_err(|_| GitError::IoError("Repository mutex poisoned".into()))?;

    let mut branch = repo
        .find_branch(branch_name, git2::BranchType::Local)
        .map_err(|e| GitError::BranchError(format!("Failed to find branch: {e}")))?;

    branch
        .delete()
        .map_err(|e| GitError::BranchError(format!("Failed to delete branch: {e}")))?;

    Ok(())
}
