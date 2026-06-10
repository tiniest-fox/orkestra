//! Check if a prewarmed worktree is ready and adopt it for a task.

use orkestra_store::{WorktreeRecord, WorktreeStatus};

use crate::workflow::domain::Task;
use crate::workflow::ports::{WorkflowResult, WorkflowStore};

/// Return the Ready worktree record for `task_id` and delete it, or return None.
///
/// Deletes the record on adopt so ownership transfers to the task record.
/// Returns None if no record exists or if the record is still Pending.
pub fn execute(store: &dyn WorkflowStore, task_id: &str) -> WorkflowResult<Option<WorktreeRecord>> {
    let Some(record) = store.get_worktree_record(task_id)? else {
        return Ok(None);
    };
    if record.status == WorktreeStatus::Ready {
        store.delete_worktree_record(task_id)?;
        Ok(Some(record))
    } else {
        Ok(None)
    }
}

/// Transfer all fields from a ready `WorktreeRecord` into the task.
///
/// `base_branch` is only written when the task's field is empty, so an
/// already-resolved value (from a CLI flag or git) is never overwritten.
pub fn apply_to_task(task: &mut Task, record: WorktreeRecord) {
    if let Some(path) = record.worktree_path {
        task.worktree_path = Some(path);
    }
    if let Some(branch) = record.base_branch {
        if task.base_branch.is_empty() {
            task.base_branch = branch;
        }
    }
    if let Some(branch_name) = record.branch_name {
        task.branch_name = Some(branch_name);
    }
    if let Some(base_commit) = record.base_commit {
        task.base_commit = base_commit;
    }
}

// ============================================================================
// Tests
// ============================================================================

#[cfg(test)]
mod tests {
    use std::sync::Arc;

    use orkestra_store::{WorktreeRecord, WorktreeStatus};

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

    #[test]
    fn test_adopt_ready_record_returns_and_deletes() {
        let store = Arc::new(InMemoryWorkflowStore::new());
        store
            .save_worktree_record(&make_record("task-1", WorktreeStatus::Ready))
            .unwrap();

        let result = execute(store.as_ref(), "task-1").unwrap();
        assert!(result.is_some(), "Should return Ready record");
        assert_eq!(result.unwrap().worktree_path, Some("/tmp/wt".to_string()));

        // Record should be deleted after adoption.
        let remaining = store.get_worktree_record("task-1").unwrap();
        assert!(
            remaining.is_none(),
            "Record should be deleted after adoption"
        );
    }

    #[test]
    fn test_adopt_pending_record_returns_none() {
        let store = Arc::new(InMemoryWorkflowStore::new());
        store
            .save_worktree_record(&make_record("task-2", WorktreeStatus::Pending))
            .unwrap();

        let result = execute(store.as_ref(), "task-2").unwrap();
        assert!(result.is_none(), "Pending record should not be adopted");

        // Record should still exist.
        let remaining = store.get_worktree_record("task-2").unwrap();
        assert!(remaining.is_some(), "Pending record should still exist");
    }

    #[test]
    fn test_adopt_missing_record_returns_none() {
        let store = Arc::new(InMemoryWorkflowStore::new());
        let result = execute(store.as_ref(), "no-such-task").unwrap();
        assert!(result.is_none(), "Missing record should return None");
    }
}
