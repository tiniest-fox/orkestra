//! Selectively delete stale prewarm records on startup.
//!
//! Preserves Ready records for existing tasks so `retry_pending_adoptions` can
//! adopt them after cleanup. Any worktree directories left behind are handled by
//! `cleanup_orphaned_worktrees`, which removes worktrees not referenced by any task.

use std::collections::HashSet;

use orkestra_store::WorktreeStatus;

use crate::workflow::ports::{WorkflowResult, WorkflowStore};

/// Selectively delete orphaned or unrecoverable worktree records.
///
/// Deletes a record when either:
/// - No matching task exists (truly orphaned — task was deleted), or
/// - The record is Pending (the prewarm thread from the previous session is dead
///   and cannot complete — it must be discarded rather than left dangling).
///
/// Ready records for existing tasks are kept so `retry_pending_adoptions` can
/// adopt them in the same startup recovery pass.
///
/// The N+1 delete is intentional — runs only once at startup and the expected
/// number of records is near zero.
pub fn execute(store: &dyn WorkflowStore) -> WorkflowResult<()> {
    let records = store.list_worktree_records()?;
    if records.is_empty() {
        return Ok(());
    }

    let headers = store.list_task_headers()?;
    let task_ids: HashSet<&str> = headers.iter().map(|h| h.id.as_str()).collect();

    for record in &records {
        // Delete if: (a) no matching task exists, or (b) record is Pending
        // (prewarm thread from previous session is dead -- cannot complete)
        if !task_ids.contains(record.task_id.as_str()) || record.status == WorktreeStatus::Pending {
            store.delete_worktree_record(&record.task_id)?;
        }
    }
    Ok(())
}
