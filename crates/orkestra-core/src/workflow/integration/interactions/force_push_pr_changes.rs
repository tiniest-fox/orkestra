//! Force-push a task's branch to origin for an open PR.

use crate::workflow::domain::Task;
use crate::workflow::ports::{GitService, WorkflowError, WorkflowResult, WorkflowStore};

/// Force-push the task's branch to origin using --force-with-lease.
///
/// Validates that the task is Done and has an open PR before proceeding.
/// Does NOT auto-commit pending changes — the caller is expected to have
/// already committed (e.g., after a rebase). Auto-committing dirty state
/// after a divergence would be surprising and potentially incorrect.
pub fn execute(
    store: &dyn WorkflowStore,
    git: &dyn GitService,
    task_id: &str,
) -> WorkflowResult<Task> {
    let task = store
        .get_task(task_id)?
        .ok_or_else(|| WorkflowError::TaskNotFound(task_id.into()))?;

    if !task.is_done() {
        return Err(WorkflowError::InvalidTransition(
            "Can only force push for Done tasks".into(),
        ));
    }

    if !task.has_open_pr() {
        return Err(WorkflowError::InvalidTransition(
            "Task does not have an open PR".into(),
        ));
    }

    let branch = task.branch_name.as_deref().ok_or_else(|| {
        WorkflowError::InvalidTransition("Cannot force push: task has no branch".into())
    })?;

    git.force_push_branch(branch)
        .map_err(|e| WorkflowError::GitError(e.to_string()))?;

    Ok(task)
}
