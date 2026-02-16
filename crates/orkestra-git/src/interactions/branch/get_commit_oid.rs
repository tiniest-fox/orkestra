//! Get the commit OID for a branch or HEAD.

use git2::{Oid, Repository};
use std::sync::Mutex;

use crate::types::GitError;

/// Get the commit OID for a branch or HEAD.
pub fn execute(repo: &Mutex<Repository>, base_branch: Option<&str>) -> Result<Oid, GitError> {
    let repo = repo
        .lock()
        .map_err(|_| GitError::IoError("Repository mutex poisoned".into()))?;

    if let Some(branch) = base_branch {
        let branch_ref = repo
            .find_branch(branch, git2::BranchType::Local)
            .map_err(|e| GitError::BranchError(format!("Failed to find branch '{branch}': {e}")))?;
        let commit = branch_ref.get().peel_to_commit().map_err(|e| {
            GitError::BranchError(format!("Failed to get commit for branch '{branch}': {e}"))
        })?;
        Ok(commit.id())
    } else {
        let head = repo
            .head()
            .map_err(|e| GitError::BranchError(format!("Failed to get HEAD: {e}")))?;
        let commit = head
            .peel_to_commit()
            .map_err(|e| GitError::BranchError(format!("Failed to get commit: {e}")))?;
        Ok(commit.id())
    }
}
