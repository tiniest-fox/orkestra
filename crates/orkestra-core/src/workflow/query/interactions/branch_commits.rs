//! Query branch-specific commits for a task.

use std::path::Path;

use crate::workflow::ports::{
    CommitInfo, GitService, WorkflowError, WorkflowResult, WorkflowStore,
};

/// Get commits on a task's branch since it diverged from the base branch.
///
/// Returns `Ok(vec![])` when the task has no worktree yet — nothing to show.
pub fn execute(
    store: &dyn WorkflowStore,
    git: &dyn GitService,
    task_id: &str,
) -> WorkflowResult<Vec<CommitInfo>> {
    let task = store
        .get_task(task_id)?
        .ok_or_else(|| WorkflowError::TaskNotFound(task_id.into()))?;

    let Some(worktree_path) = &task.worktree_path else {
        return Ok(vec![]); // Task has no worktree yet — nothing to show
    };

    git.branch_commits(Path::new(worktree_path), &task.base_branch, 200)
        .map_err(|e| WorkflowError::GitError(e.to_string()))
}
