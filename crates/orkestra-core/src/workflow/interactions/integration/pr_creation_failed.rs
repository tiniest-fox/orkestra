//! Record failed PR creation by transitioning task to Failed status.

use crate::workflow::domain::Task;
use crate::workflow::ports::{WorkflowError, WorkflowResult, WorkflowStore};
use crate::workflow::runtime::{Phase, Status};

pub fn execute(store: &dyn WorkflowStore, task_id: &str, error: &str) -> WorkflowResult<Task> {
    let mut task = store
        .get_task(task_id)?
        .ok_or_else(|| WorkflowError::TaskNotFound(task_id.into()))?;

    task.status = Status::failed(format!("PR creation failed: {error}"));
    task.phase = Phase::Idle;
    task.updated_at = chrono::Utc::now().to_rfc3339();
    store.save_task(&task)?;
    Ok(task)
}
