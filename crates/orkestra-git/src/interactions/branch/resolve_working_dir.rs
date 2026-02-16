//! Resolve a branch name to its working directory.

use std::path::{Path, PathBuf};

use crate::types::GitError;

/// Resolve a branch name to the working directory where it's checked out.
///
/// - `task/*` branches -> worktree path (must exist)
/// - Everything else -> main repo path
pub fn execute(repo_path: &Path, worktrees_dir: &Path, branch: &str) -> Result<PathBuf, GitError> {
    if let Some(task_id) = branch.strip_prefix("task/") {
        let worktree_path = worktrees_dir.join(task_id);
        if worktree_path.join(".git").exists() {
            return Ok(worktree_path);
        }
        return Err(GitError::WorktreeError(format!(
            "Worktree for task branch '{branch}' not found at {}",
            worktree_path.display()
        )));
    }
    Ok(repo_path.to_path_buf())
}
