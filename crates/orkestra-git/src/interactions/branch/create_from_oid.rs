//! Create a branch from a commit OID.

use git2::{Oid, Repository};
use std::sync::Mutex;

use crate::types::GitError;

/// Create a branch from a commit OID.
pub fn execute(
    repo: &Mutex<Repository>,
    branch_name: &str,
    commit_oid: Oid,
) -> Result<(), GitError> {
    let repo = repo
        .lock()
        .map_err(|_| GitError::IoError("Repository mutex poisoned".into()))?;
    let commit = repo
        .find_commit(commit_oid)
        .map_err(|e| GitError::BranchError(format!("Failed to find commit: {e}")))?;
    repo.branch(branch_name, &commit, false)
        .map_err(|e| GitError::BranchError(format!("Failed to create branch: {e}")))?;
    Ok(())
}
