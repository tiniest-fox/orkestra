//! Manually archive a Done task.

use crate::workflow::domain::Task;
use crate::workflow::ports::{WorkflowError, WorkflowResult, WorkflowStore};

/// Archive a Done task (manual trigger, no git integration).
///
/// Validates the task is Done, then delegates to the integration
/// succeeded logic (which transitions to Archived).
pub fn execute(store: &dyn WorkflowStore, task_id: &str) -> WorkflowResult<Task> {
    let task = store
        .get_task(task_id)?
        .ok_or_else(|| WorkflowError::TaskNotFound(task_id.into()))?;

    if !task.is_done() {
        return Err(WorkflowError::InvalidTransition(format!(
            "Cannot archive task in state {} (expected Done)",
            task.state
        )));
    }

    // Delegate to integration succeeded (transitions to Archived)
    crate::workflow::integration::interactions::integration_succeeded::execute(store, task_id)
}
