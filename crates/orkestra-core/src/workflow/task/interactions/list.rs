//! List tasks with filtering by parent/archived status.

use crate::workflow::domain::Task;
use crate::workflow::ports::{WorkflowResult, WorkflowStore};

/// List all active top-level tasks (excluding archived, without parents).
pub fn list_active(store: &dyn WorkflowStore) -> WorkflowResult<Vec<Task>> {
    let all_tasks = store.list_active_tasks()?;
    Ok(all_tasks
        .into_iter()
        .filter(|t| t.parent_id.is_none())
        .collect())
}

/// List all archived top-level tasks (tasks without parents).
pub fn list_archived(store: &dyn WorkflowStore) -> WorkflowResult<Vec<Task>> {
    let all_tasks = store.list_archived_tasks()?;
    Ok(all_tasks
        .into_iter()
        .filter(|t| t.parent_id.is_none())
        .collect())
}

/// List subtasks of a parent task.
pub fn list_subtasks(store: &dyn WorkflowStore, parent_id: &str) -> WorkflowResult<Vec<Task>> {
    store.list_subtasks(parent_id)
}
