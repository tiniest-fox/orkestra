//! Mark agent as started on a task.

use crate::orkestra_debug;
use crate::workflow::domain::Task;
use crate::workflow::ports::{WorkflowError, WorkflowResult, WorkflowStore};
use crate::workflow::runtime::TaskState;

pub fn execute(store: &dyn WorkflowStore, task_id: &str) -> WorkflowResult<Task> {
    let mut task = store
        .get_task(task_id)?
        .ok_or_else(|| WorkflowError::TaskNotFound(task_id.into()))?;

    let stage = match &task.state {
        TaskState::Queued { stage } => stage.clone(),
        _ => {
            return Err(WorkflowError::InvalidTransition(format!(
                "Agent cannot start in state {} (expected Queued)",
                task.state
            )));
        }
    };

    task.state = TaskState::agent_working(&stage);
    task.updated_at = chrono::Utc::now().to_rfc3339();

    orkestra_debug!(
        "action",
        "agent_started {}: state={}, stage={:?}",
        task_id,
        task.state,
        task.current_stage()
    );

    store.save_task(&task)?;
    Ok(task)
}
