//! HEAD SHA + dirty status for a worktree — pure git2, no subprocess.

use std::path::Path;

use git2::{Repository, StatusOptions};

use crate::types::{GitError, WorktreeState};

/// Get HEAD SHA and dirty status for a worktree using git2 (no subprocess, ~1ms).
pub fn execute(worktree_path: &Path) -> Result<WorktreeState, GitError> {
    let repo = Repository::open(worktree_path)
        .map_err(|e| GitError::RepositoryNotFound(format!("Failed to open worktree: {e}")))?;

    let head_sha = repo
        .head()
        .map_err(|e| GitError::Other(format!("HEAD lookup failed: {e}")))?
        .peel_to_commit()
        .map_err(|e| GitError::Other(format!("HEAD is not a commit: {e}")))?
        .id()
        .to_string();

    let mut opts = StatusOptions::new();
    opts.include_untracked(false).include_ignored(false);
    let statuses = repo
        .statuses(Some(&mut opts))
        .map_err(|e| GitError::Other(format!("Status check failed: {e}")))?;

    Ok(WorktreeState {
        head_sha,
        is_dirty: !statuses.is_empty(),
    })
}
