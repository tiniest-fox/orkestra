//! Delete all worktree records on startup (orphan cleanup).
//!
//! Any worktree directories left behind are handled by `cleanup_orphaned_worktrees`,
//! which removes worktrees not referenced by any task.

use crate::workflow::ports::{WorkflowResult, WorkflowStore};

/// Delete all worktree records.
///
/// Called at startup before the tick loop. Removes stale prewarm records from
/// previous sessions so they don't pollute task creation.
pub fn execute(store: &dyn WorkflowStore) -> WorkflowResult<()> {
    let records = store.list_worktree_records()?;
    for record in records {
        store.delete_worktree_record(&record.task_id)?;
    }
    Ok(())
}
