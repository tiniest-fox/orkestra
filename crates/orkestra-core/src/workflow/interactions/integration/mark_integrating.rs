//! Mark a task as being integrated.

use crate::workflow::domain::Task;
use crate::workflow::ports::{WorkflowError, WorkflowResult, WorkflowStore};
use crate::workflow::runtime::Phase;

/// Mark a task as being integrated.
///
/// Sets the phase to `Integrating` to prevent double-integration
/// and to indicate that the merge is in progress.
pub fn execute(store: &dyn WorkflowStore, task_id: &str) -> WorkflowResult<Task> {
    let mut task = store
        .get_task(task_id)?
        .ok_or_else(|| WorkflowError::TaskNotFound(task_id.into()))?;

    if !task.is_done() {
        return Err(WorkflowError::InvalidTransition(
            "Can only integrate Done tasks".into(),
        ));
    }

    if task.phase != Phase::Idle {
        return Err(WorkflowError::InvalidTransition(format!(
            "Task must be Idle to start integration, but is {:?}",
            task.phase
        )));
    }

    task.phase = Phase::Integrating;
    task.updated_at = chrono::Utc::now().to_rfc3339();
    store.save_task(&task)?;
    Ok(task)
}
