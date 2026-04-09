//! Query uncommitted changes in a task's worktree.

use std::path::Path;

use crate::workflow::ports::{GitService, TaskDiff, WorkflowError, WorkflowResult, WorkflowStore};

/// Get the uncommitted diff (staged + unstaged vs HEAD) for a task's worktree.
///
/// Returns an error if the task has no worktree path configured.
pub fn execute(
    store: &dyn WorkflowStore,
    git: &dyn GitService,
    task_id: &str,
) -> WorkflowResult<TaskDiff> {
    let task = store
        .get_task(task_id)?
        .ok_or_else(|| WorkflowError::TaskNotFound(task_id.into()))?;
    let worktree_path = task
        .worktree_path
        .as_ref()
        .ok_or_else(|| WorkflowError::GitError("Task has no worktree".into()))?;
    git.diff_uncommitted(Path::new(worktree_path))
        .map_err(|e| WorkflowError::GitError(e.to_string()))
}
