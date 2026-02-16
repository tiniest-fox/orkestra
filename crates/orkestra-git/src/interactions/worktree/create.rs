//! Create a git worktree for a task.

use git2::Repository;
use std::path::Path;
use std::sync::Mutex;

use crate::types::{GitError, WorktreeCreated};

/// Create a worktree if it doesn't exist, or return existing info.
///
/// Does NOT run the setup script — the caller handles that separately.
pub fn execute(
    repo: &Mutex<Repository>,
    worktrees_dir: &Path,
    task_id: &str,
    base_branch: Option<&str>,
) -> Result<WorktreeCreated, GitError> {
    let branch_name = format!("task/{task_id}");
    let worktree_path = worktrees_dir.join(task_id);

    // If worktree already exists, return its info
    if super::exists::execute(repo, task_id) {
        let base_commit =
            crate::interactions::branch::get_commit_oid::execute(repo, Some(&branch_name))
                .map(|oid| oid.to_string())
                .unwrap_or_default();
        return Ok(WorktreeCreated {
            branch_name,
            worktree_path,
            base_commit,
        });
    }

    // Ensure worktrees directory exists
    std::fs::create_dir_all(worktrees_dir)?;

    // Get the commit OID to branch from
    let commit_oid = crate::interactions::branch::get_commit_oid::execute(repo, base_branch)?;

    // Create the branch
    crate::interactions::branch::create_from_oid::execute(repo, &branch_name, commit_oid)?;

    // Create the worktree
    super::create_for_branch::execute(repo, task_id, &branch_name, &worktree_path)?;

    Ok(WorktreeCreated {
        branch_name,
        worktree_path,
        base_commit: commit_oid.to_string(),
    })
}
