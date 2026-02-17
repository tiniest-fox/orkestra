//! Manually archive a Done task.

use crate::workflow::domain::Task;
use crate::workflow::ports::{WorkflowError, WorkflowResult, WorkflowStore};
use crate::workflow::runtime::Phase;

/// Archive a Done task (manual trigger, no git integration).
///
/// Validates the task is in Idle phase, then delegates to the integration
/// succeeded logic (which transitions to Archived).
pub fn execute(store: &dyn WorkflowStore, task_id: &str) -> WorkflowResult<Task> {
    let task = store
        .get_task(task_id)?
        .ok_or_else(|| WorkflowError::TaskNotFound(task_id.into()))?;

    if task.phase != Phase::Idle {
        return Err(WorkflowError::InvalidTransition(format!(
            "Cannot archive task in phase {:?}",
            task.phase
        )));
    }

    // Delegate to integration succeeded (transitions to Archived + Idle)
    crate::workflow::integration::interactions::integration_succeeded::execute(store, task_id)
}
