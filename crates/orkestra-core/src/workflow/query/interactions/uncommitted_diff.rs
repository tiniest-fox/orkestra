//! Query uncommitted changes in a task's worktree.

use std::path::Path;

use crate::workflow::ports::{GitService, TaskDiff, WorkflowError, WorkflowResult, WorkflowStore};

/// Get the uncommitted diff (staged + unstaged vs HEAD) for a task's worktree.
///
/// Returns an error if the task has no worktree path configured.
pub fn execute(
    store: &dyn WorkflowStore,
    git: &dyn GitService,
    task_id: &str,
) -> WorkflowResult<TaskDiff> {
    let task = store
        .get_task(task_id)?
        .ok_or_else(|| WorkflowError::TaskNotFound(task_id.into()))?;
    let worktree_path = task
        .worktree_path
        .as_ref()
        .ok_or_else(|| WorkflowError::GitError("Task has no worktree".into()))?;
    git.diff_uncommitted(Path::new(worktree_path))
        .map_err(|e| WorkflowError::GitError(e.to_string()))
}

// ============================================================================
// Tests
// ============================================================================

#[cfg(test)]
mod tests {
    use super::*;
    use crate::workflow::ports::{InMemoryWorkflowStore, MockGitService, WorkflowError};
    use orkestra_types::domain::Task;

    fn setup_task(store: &InMemoryWorkflowStore, task_id: &str, worktree: Option<&str>) {
        let mut task = Task::new(task_id, "Test", "", "work", "2026-01-01T00:00:00Z");
        task.worktree_path = worktree.map(std::string::ToString::to_string);
        store.save_task(&task).unwrap();
    }

    #[test]
    fn returns_error_when_task_not_found() {
        let store = InMemoryWorkflowStore::new();
        let git = MockGitService::new();
        let err = execute(&store, &git, "nonexistent").unwrap_err();
        assert!(matches!(err, WorkflowError::TaskNotFound(_)));
    }

    #[test]
    fn returns_error_when_no_worktree() {
        let store = InMemoryWorkflowStore::new();
        let git = MockGitService::new();
        setup_task(&store, "t1", None);
        let err = execute(&store, &git, "t1").unwrap_err();
        assert!(matches!(err, WorkflowError::GitError(_)));
        if let WorkflowError::GitError(msg) = err {
            assert!(msg.contains("no worktree"));
        }
    }

    #[test]
    fn returns_diff_on_success() {
        let store = InMemoryWorkflowStore::new();
        let git = MockGitService::new();
        setup_task(&store, "t1", Some("/tmp/wt"));
        // Default mock returns Ok(TaskDiff { files: vec![] })
        let diff = execute(&store, &git, "t1").unwrap();
        assert!(diff.files.is_empty());
    }
}
