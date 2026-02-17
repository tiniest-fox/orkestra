//! Delete a task and all its descendants.

use crate::workflow::ports::{WorkflowError, WorkflowResult, WorkflowStore};

pub fn execute(store: &dyn WorkflowStore, task_id: &str) -> WorkflowResult<()> {
    // Verify task exists
    store
        .get_task(task_id)?
        .ok_or_else(|| WorkflowError::TaskNotFound(task_id.into()))?;

    // Collect all task IDs to delete (parent + subtasks recursively)
    let mut task_ids = vec![task_id.to_string()];
    collect_subtask_ids(store, task_id, &mut task_ids)?;

    // Delete everything in one transaction
    store.delete_task_tree(&task_ids)
}

// -- Helpers --

/// Recursively collect all descendant subtask IDs.
pub(crate) fn collect_subtask_ids(
    store: &dyn WorkflowStore,
    parent_id: &str,
    ids: &mut Vec<String>,
) -> WorkflowResult<()> {
    for subtask in store.list_subtasks(parent_id)? {
        ids.push(subtask.id.clone());
        collect_subtask_ids(store, &subtask.id, ids)?;
    }
    Ok(())
}
