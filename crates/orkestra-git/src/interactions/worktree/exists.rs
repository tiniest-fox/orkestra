//! Check if a worktree exists for a task.

use git2::Repository;
use std::sync::Mutex;

/// Check if a worktree exists for the given task ID.
pub fn execute(repo: &Mutex<Repository>, task_id: &str) -> bool {
    let Ok(repo) = repo.lock() else {
        return false;
    };
    repo.find_worktree(task_id).is_ok()
}
