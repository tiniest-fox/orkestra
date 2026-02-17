//! Validate and mark a Done task as Integrating for PR creation.

use crate::workflow::domain::Task;
use crate::workflow::ports::{WorkflowError, WorkflowResult, WorkflowStore};
use crate::workflow::runtime::Phase;

pub fn execute(
    store: &dyn WorkflowStore,
    has_pr_service: bool,
    task_id: &str,
) -> WorkflowResult<Task> {
    if !has_pr_service {
        return Err(WorkflowError::GitError(
            "No PR service configured — cannot create PR".into(),
        ));
    }

    let mut task = store
        .get_task(task_id)?
        .ok_or_else(|| WorkflowError::TaskNotFound(task_id.into()))?;

    if !task.is_done() {
        return Err(WorkflowError::InvalidTransition(
            "Can only open PR for Done tasks".into(),
        ));
    }
    if task.phase != Phase::Idle {
        return Err(WorkflowError::InvalidTransition(format!(
            "Task must be Idle to open PR, but is {:?}",
            task.phase
        )));
    }
    if task.has_open_pr() {
        return Err(WorkflowError::InvalidTransition(
            "Task already has an open PR".into(),
        ));
    }

    task.phase = Phase::Integrating;
    task.updated_at = chrono::Utc::now().to_rfc3339();
    store.save_task(&task)?;
    Ok(task)
}
