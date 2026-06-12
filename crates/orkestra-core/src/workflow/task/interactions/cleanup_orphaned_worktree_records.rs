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

// ============================================================================
// Tests
// ============================================================================

#[cfg(test)]
mod tests {
    use std::sync::Arc;

    use orkestra_store::{WorktreeRecord, WorktreeStatus};

    use crate::workflow::domain::Task;
    use crate::workflow::ports::WorkflowStore;
    use crate::workflow::InMemoryWorkflowStore;

    use super::execute;

    fn make_record(task_id: &str, status: WorktreeStatus) -> WorktreeRecord {
        WorktreeRecord {
            task_id: task_id.to_string(),
            status,
            base_branch: Some("main".to_string()),
            worktree_path: Some("/tmp/wt".to_string()),
            branch_name: Some("task/my-task".to_string()),
            base_commit: Some("abc123".to_string()),
            created_at: "2025-01-01T00:00:00Z".to_string(),
        }
    }

    fn make_task(id: &str) -> Task {
        Task::new(id, "Test", "desc", "work", "2025-01-01T00:00:00Z")
    }

    #[test]
    fn empty_records_is_noop() {
        let store = Arc::new(InMemoryWorkflowStore::new());
        execute(store.as_ref()).unwrap();
        // No panic, no error — just a no-op.
    }

    #[test]
    fn ready_record_for_existing_task_is_preserved() {
        let store = Arc::new(InMemoryWorkflowStore::new());
        store.save_task(&make_task("task-1")).unwrap();
        store
            .save_worktree_record(&make_record("task-1", WorktreeStatus::Ready))
            .unwrap();

        execute(store.as_ref()).unwrap();

        let record = store.get_worktree_record("task-1").unwrap();
        assert!(
            record.is_some(),
            "Ready record for an existing task must be preserved for deferred adoption"
        );
    }

    #[test]
    fn ready_record_for_missing_task_is_deleted() {
        let store = Arc::new(InMemoryWorkflowStore::new());
        // No task saved — this is an orphaned record.
        store
            .save_worktree_record(&make_record("ghost-task", WorktreeStatus::Ready))
            .unwrap();

        execute(store.as_ref()).unwrap();

        let record = store.get_worktree_record("ghost-task").unwrap();
        assert!(
            record.is_none(),
            "Ready record for a non-existent task must be deleted"
        );
    }

    #[test]
    fn pending_record_for_existing_task_is_deleted() {
        let store = Arc::new(InMemoryWorkflowStore::new());
        store.save_task(&make_task("task-2")).unwrap();
        store
            .save_worktree_record(&make_record("task-2", WorktreeStatus::Pending))
            .unwrap();

        execute(store.as_ref()).unwrap();

        let record = store.get_worktree_record("task-2").unwrap();
        assert!(
            record.is_none(),
            "Pending record must be deleted (prewarm thread from previous session is dead)"
        );
    }
}
