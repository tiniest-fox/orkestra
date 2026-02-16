//! List worktree names (task IDs).

use git2::Repository;
use std::path::Path;
use std::sync::Mutex;

use crate::types::GitError;

/// List worktree directory names (task IDs) under the worktrees directory.
pub fn execute(repo: &Mutex<Repository>, worktrees_dir: &Path) -> Result<Vec<String>, GitError> {
    let mut names = Vec::new();

    // Collect worktree directories on disk
    if worktrees_dir.exists() {
        let entries = std::fs::read_dir(worktrees_dir)
            .map_err(|e| GitError::IoError(format!("Failed to read worktrees dir: {e}")))?;

        for entry in entries.flatten() {
            if entry.path().is_dir() {
                if let Some(name) = entry.file_name().to_str() {
                    names.push(name.to_string());
                }
            }
        }
    }

    // Also collect worktrees registered in git whose path is under our
    // worktrees_dir. This catches stale/prunable entries where the directory
    // was deleted but git metadata in .git/worktrees/ remains.
    let repo = repo
        .lock()
        .map_err(|_| GitError::IoError("Repository mutex poisoned".into()))?;
    let git_worktree_names = repo
        .worktrees()
        .map_err(|e| GitError::IoError(format!("Failed to list git worktrees: {e}")))?;
    for i in 0..git_worktree_names.len() {
        let Some(wt_name) = git_worktree_names.get(i) else {
            continue;
        };
        if names.iter().any(|n| n == wt_name) {
            continue;
        }
        if let Ok(worktree) = repo.find_worktree(wt_name) {
            if worktree.path().starts_with(worktrees_dir) {
                names.push(wt_name.to_string());
            }
        }
    }

    Ok(names)
}
