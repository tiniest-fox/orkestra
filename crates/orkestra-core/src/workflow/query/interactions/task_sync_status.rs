//! Query sync status for a task's branch relative to origin.

use crate::workflow::ports::{
    GitService, SyncStatus, WorkflowError, WorkflowResult, WorkflowStore,
};

/// Get sync status for a task's branch relative to origin.
///
/// Validates that the task is Done with an open PR before querying git.
pub fn execute(
    store: &dyn WorkflowStore,
    git: &dyn GitService,
    task_id: &str,
) -> WorkflowResult<Option<SyncStatus>> {
    let task = store
        .get_task(task_id)?
        .ok_or_else(|| WorkflowError::TaskNotFound(task_id.into()))?;

    if !task.is_done() {
        return Err(WorkflowError::InvalidTransition(
            "Can only check sync status for Done tasks".into(),
        ));
    }

    if !task.has_open_pr() {
        return Err(WorkflowError::InvalidTransition(
            "Task does not have an open PR".into(),
        ));
    }

    let branch = task
        .branch_name
        .as_ref()
        .ok_or_else(|| WorkflowError::InvalidTransition("Task has no branch".into()))?;

    git.sync_status_for_branch(branch)
        .map_err(|e| WorkflowError::GitError(e.to_string()))
}
