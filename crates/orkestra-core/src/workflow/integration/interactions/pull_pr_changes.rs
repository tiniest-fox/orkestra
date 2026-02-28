//! Fetch and fast-forward the task's branch from origin for a task with an open PR.

use std::path::Path;

use crate::workflow::domain::Task;
use crate::workflow::ports::{GitError, GitService, WorkflowError, WorkflowResult, WorkflowStore};

/// Fetch and fast-forward the task's branch from origin.
///
/// Validates that the task is Done and has an open PR before proceeding.
/// Unlike push, there is no pre-step — just validate and pull.
pub fn execute(
    store: &dyn WorkflowStore,
    git: &dyn GitService,
    task_id: &str,
) -> WorkflowResult<Task> {
    let task = store
        .get_task(task_id)?
        .ok_or_else(|| WorkflowError::TaskNotFound(task_id.into()))?;

    if !task.is_done() {
        return Err(WorkflowError::InvalidTransition(
            "Can only pull PR changes for Done tasks".into(),
        ));
    }

    if !task.has_open_pr() {
        return Err(WorkflowError::InvalidTransition(
            "Task does not have an open PR — use open_pr to create one first".into(),
        ));
    }

    // Validate branch exists as a precondition, but don't pass it to the git call —
    // pull_branch_in operates on whichever branch is checked out in the worktree, so
    // no explicit branch name is needed (unlike push, which takes a ref by name).
    let _branch = task.branch_name.as_deref().ok_or_else(|| {
        WorkflowError::InvalidTransition("Cannot pull PR changes: task has no branch".into())
    })?;

    let worktree_path = task.worktree_path.as_deref().ok_or_else(|| {
        WorkflowError::InvalidTransition("Cannot pull PR changes: task has no worktree".into())
    })?;

    git.pull_branch_in(Path::new(worktree_path))
        .map_err(|e| git_to_workflow_err(&e))?;

    Ok(task)
}

// -- Helpers --

fn git_to_workflow_err(e: &GitError) -> WorkflowError {
    WorkflowError::GitError(e.to_string())
}
