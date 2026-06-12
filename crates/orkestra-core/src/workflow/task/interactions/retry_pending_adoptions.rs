//! Retry worktree adoption for tasks that missed their prewarm window.

use crate::orkestra_debug;
use crate::workflow::ports::{WorkflowResult, WorkflowStore};
use crate::workflow::runtime::TaskState;

/// Adopt any Ready prewarm records into tasks that are missing their worktree.
///
/// Called each tick (before `setup_awaiting`) and at startup (after cleanup).
/// Returns the IDs of tasks that were adopted.
///
/// Cases handled:
/// - Ready record + task with no worktree → adopts, transitions `AwaitingSetup` → Queued
/// - Ready record + task already has worktree → stale record, deletes it
/// - Pending record + task → prewarm still in progress, skip
/// - Ready record + no matching task → orphan, skip (cleanup handles it)
/// - No records → returns empty immediately (fast path)
pub fn execute(store: &dyn WorkflowStore) -> WorkflowResult<Vec<String>> {
    let records = store.list_worktree_records()?;
    if records.is_empty() {
        return Ok(Vec::new());
    }

    let mut adopted = Vec::new();

    for record in records {
        let Some(mut task) = store.get_task(&record.task_id)? else {
            // No matching task — orphan record, cleanup handles it
            continue;
        };

        if task.worktree_path.is_some() {
            // Task already has a worktree — record is stale
            store.delete_worktree_record(&record.task_id)?;
            continue;
        }

        // Use adopt_worktree as the Single Source of Truth for adoption.
        // Returns None if the record is still Pending.
        let Some(adopted_record) = super::adopt_worktree::execute(store, &record.task_id)? else {
            continue;
        };

        super::adopt_worktree::apply_to_task(&mut task, adopted_record);

        // Only transition AwaitingSetup → Queued; leave all other states (e.g. Queued{chat}) alone.
        if let TaskState::AwaitingSetup { stage } = &task.state {
            let stage = stage.clone();
            task.state = TaskState::queued(&stage);
        }

        task.updated_at = chrono::Utc::now().to_rfc3339();
        store.save_task(&task)?;

        orkestra_debug!(
            "recovery",
            "Deferred worktree adoption for task {}",
            task.id
        );
        adopted.push(task.id);
    }

    Ok(adopted)
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
    use crate::workflow::runtime::TaskState;
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
    fn ready_record_with_no_worktree_adopts() {
        let store = Arc::new(InMemoryWorkflowStore::new());
        let mut task = make_task("task-1");
        task.state = TaskState::awaiting_setup("work");
        store.save_task(&task).unwrap();
        store
            .save_worktree_record(&make_record("task-1", WorktreeStatus::Ready))
            .unwrap();

        let adopted = execute(store.as_ref()).unwrap();
        assert_eq!(adopted, vec!["task-1"]);

        let updated = store.get_task("task-1").unwrap().unwrap();
        assert_eq!(
            updated.worktree_path,
            Some("/tmp/wt".to_string()),
            "worktree_path should be set after adoption"
        );
        // AwaitingSetup → Queued
        assert!(
            matches!(updated.state, TaskState::Queued { .. }),
            "state should transition to Queued"
        );
        // Record should be consumed
        assert!(store.get_worktree_record("task-1").unwrap().is_none());
    }

    #[test]
    fn ready_record_with_existing_worktree_deletes_stale_record() {
        let store = Arc::new(InMemoryWorkflowStore::new());
        let mut task = make_task("task-2");
        task.worktree_path = Some("/already/here".to_string());
        store.save_task(&task).unwrap();
        store
            .save_worktree_record(&make_record("task-2", WorktreeStatus::Ready))
            .unwrap();

        let adopted = execute(store.as_ref()).unwrap();
        assert!(adopted.is_empty());
        assert!(store.get_worktree_record("task-2").unwrap().is_none());
    }

    #[test]
    fn pending_record_is_skipped() {
        let store = Arc::new(InMemoryWorkflowStore::new());
        store.save_task(&make_task("task-3")).unwrap();
        store
            .save_worktree_record(&make_record("task-3", WorktreeStatus::Pending))
            .unwrap();

        let adopted = execute(store.as_ref()).unwrap();
        assert!(adopted.is_empty());
        // Record must remain for eventual adoption
        assert!(store.get_worktree_record("task-3").unwrap().is_some());
    }

    #[test]
    fn ready_record_with_no_matching_task_is_skipped() {
        let store = Arc::new(InMemoryWorkflowStore::new());
        store
            .save_worktree_record(&make_record("ghost-task", WorktreeStatus::Ready))
            .unwrap();

        let adopted = execute(store.as_ref()).unwrap();
        assert!(adopted.is_empty());
    }

    #[test]
    fn empty_records_returns_empty() {
        let store = Arc::new(InMemoryWorkflowStore::new());
        let adopted = execute(store.as_ref()).unwrap();
        assert!(adopted.is_empty());
    }
}
