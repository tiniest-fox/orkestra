//! Record a successful commit and transition to Finished phase.

use crate::workflow::domain::Task;
use crate::workflow::ports::{WorkflowError, WorkflowResult, WorkflowStore};
use crate::workflow::runtime::Phase;

/// Transition a task from Committing to Finished after a successful commit.
pub fn execute(store: &dyn WorkflowStore, task_id: &str) -> WorkflowResult<Task> {
    let mut task = store
        .get_task(task_id)?
        .ok_or_else(|| WorkflowError::TaskNotFound(task_id.into()))?;

    if task.phase != Phase::Committing {
        return Err(WorkflowError::InvalidTransition(format!(
            "Cannot mark commit succeeded in phase {:?} (expected Committing)",
            task.phase
        )));
    }

    task.phase = Phase::Finished;
    task.updated_at = chrono::Utc::now().to_rfc3339();
    store.save_task(&task)?;
    Ok(task)
}
