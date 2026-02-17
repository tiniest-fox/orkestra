//! Query task artifacts and current stage.

use crate::workflow::ports::{WorkflowError, WorkflowResult, WorkflowStore};
use crate::workflow::runtime::Artifact;

/// Get a specific artifact by name.
pub fn get_artifact(
    store: &dyn WorkflowStore,
    task_id: &str,
    name: &str,
) -> WorkflowResult<Option<Artifact>> {
    let task = store
        .get_task(task_id)?
        .ok_or_else(|| WorkflowError::TaskNotFound(task_id.into()))?;
    Ok(task.artifacts.get(name).cloned())
}

/// Get the current stage name for a task.
pub fn get_current_stage(
    store: &dyn WorkflowStore,
    task_id: &str,
) -> WorkflowResult<Option<String>> {
    let task = store
        .get_task(task_id)?
        .ok_or_else(|| WorkflowError::TaskNotFound(task_id.into()))?;
    Ok(task.current_stage().map(std::string::ToString::to_string))
}
