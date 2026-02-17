//! Query task diffs against base branch.

use std::path::Path;

use crate::workflow::ports::{GitService, TaskDiff, WorkflowError, WorkflowResult, WorkflowStore};

/// Get the diff for a task against its base branch.
///
/// Returns the structured diff data including file paths, change types,
/// additions/deletions counts, and unified diff content.
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

    let branch_name = task
        .branch_name
        .as_ref()
        .ok_or_else(|| WorkflowError::GitError("Task has no branch".into()))?;

    git.diff_against_base(Path::new(worktree_path), branch_name, &task.base_branch)
        .map_err(|e| WorkflowError::GitError(e.to_string()))
}
