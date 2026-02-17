//! Query file content at HEAD in a task's worktree.

use std::path::Path;

use crate::workflow::ports::{GitService, WorkflowError, WorkflowResult, WorkflowStore};

/// Get the content of a file at HEAD in a task's worktree.
///
/// Returns the file content as a string, or None if the file doesn't exist.
pub fn execute(
    store: &dyn WorkflowStore,
    git: &dyn GitService,
    task_id: &str,
    file_path: &str,
) -> WorkflowResult<Option<String>> {
    let task = store
        .get_task(task_id)?
        .ok_or_else(|| WorkflowError::TaskNotFound(task_id.into()))?;

    let worktree_path = task
        .worktree_path
        .as_ref()
        .ok_or_else(|| WorkflowError::GitError("Task has no worktree".into()))?;

    git.read_file_at_head(Path::new(worktree_path), file_path)
        .map_err(|e| WorkflowError::GitError(e.to_string()))
}
