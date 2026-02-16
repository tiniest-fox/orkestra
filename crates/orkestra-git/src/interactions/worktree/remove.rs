//! Remove a git worktree and optionally its branch.

use git2::Repository;
use std::path::Path;
use std::sync::Mutex;

use crate::types::GitError;

/// Remove a worktree and optionally delete its branch.
pub fn execute(
    repo: &Mutex<Repository>,
    worktrees_dir: &Path,
    task_id: &str,
    delete_branch: bool,
) -> Result<(), GitError> {
    let worktree_path = worktrees_dir.join(task_id);
    let branch_name = format!("task/{task_id}");

    // Prune the worktree from git
    {
        let repo = repo
            .lock()
            .map_err(|_| GitError::IoError("Repository mutex poisoned".into()))?;
        if let Ok(worktree) = repo.find_worktree(task_id) {
            let mut prune_opts = git2::WorktreePruneOptions::new();
            prune_opts.valid(true);
            worktree
                .prune(Some(&mut prune_opts))
                .map_err(|e| GitError::WorktreeError(format!("Failed to prune worktree: {e}")))?;
        }
    }

    // Remove the directory if it still exists
    if worktree_path.exists() {
        std::fs::remove_dir_all(&worktree_path)?;
    }

    // Delete the branch if requested
    if delete_branch {
        crate::interactions::branch::delete::execute(repo, &branch_name)?;
    }

    Ok(())
}
