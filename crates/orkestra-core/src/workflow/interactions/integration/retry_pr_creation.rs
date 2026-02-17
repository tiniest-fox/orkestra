//! Retry PR creation by recovering from Failed state back to Done+Idle.

use crate::workflow::domain::Task;
use crate::workflow::ports::{WorkflowError, WorkflowResult, WorkflowStore};
use crate::workflow::runtime::{Phase, Status};

pub fn execute(store: &dyn WorkflowStore, task_id: &str) -> WorkflowResult<Task> {
    let mut task = store
        .get_task(task_id)?
        .ok_or_else(|| WorkflowError::TaskNotFound(task_id.into()))?;

    if !matches!(task.status, Status::Failed { .. }) {
        return Err(WorkflowError::InvalidTransition(
            "Can only retry PR creation for Failed tasks".into(),
        ));
    }

    task.status = Status::Done;
    task.phase = Phase::Idle;
    task.updated_at = chrono::Utc::now().to_rfc3339();
    store.save_task(&task)?;
    Ok(task)
}
