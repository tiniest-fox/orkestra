//! Query tasks that need agent execution spawned.

use crate::workflow::domain::Task;
use crate::workflow::ports::{WorkflowResult, WorkflowStore};
use crate::workflow::runtime::TaskState;

/// Get tasks that need agents spawned (in Queued state).
///
/// Filters out subtasks whose dependencies haven't completed yet.
pub fn execute(store: &dyn WorkflowStore) -> WorkflowResult<Vec<Task>> {
    let all_tasks = store.list_tasks()?;

    // Build a set of completed task IDs for dependency checking
    let done_ids: std::collections::HashSet<String> = all_tasks
        .iter()
        .filter(|t| t.is_done() || t.is_archived())
        .map(|t| t.id.clone())
        .collect();

    Ok(all_tasks
        .into_iter()
        .filter(|t| {
            matches!(t.state, TaskState::Queued { .. })
                && t.depends_on.iter().all(|dep| done_ids.contains(dep))
        })
        .collect())
}
