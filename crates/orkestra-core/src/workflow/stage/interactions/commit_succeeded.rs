//! Record a successful commit and transition to Committed.

use crate::workflow::domain::Task;
use crate::workflow::ports::{WorkflowError, WorkflowResult, WorkflowStore};
use crate::workflow::runtime::TaskState;

/// Transition a task from Committing to Committed after a successful commit.
///
/// `advance_all_committed` will pick up the Committed task on the next tick
/// and call `finalize_stage_advancement` to advance to the next stage.
pub fn execute(store: &dyn WorkflowStore, task_id: &str) -> WorkflowResult<Task> {
    let mut task = store
        .get_task(task_id)?
        .ok_or_else(|| WorkflowError::TaskNotFound(task_id.into()))?;

    let stage = match &task.state {
        TaskState::Committing { stage } => stage.clone(),
        _ => {
            return Err(WorkflowError::InvalidTransition(format!(
                "Cannot mark commit succeeded in state {} (expected Committing)",
                task.state
            )));
        }
    };

    task.state = TaskState::committed(stage);
    task.updated_at = chrono::Utc::now().to_rfc3339();
    store.save_task(&task)?;
    Ok(task)
}
