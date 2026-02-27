//! Commit pending changes and push to origin for a task with an open PR.

use crate::workflow::domain::Task;
use crate::workflow::ports::{GitError, GitService, WorkflowError, WorkflowResult, WorkflowStore};

/// Commit any pending worktree changes and push the task's branch to origin.
///
/// Validates that the task is Done and has an open PR before proceeding.
/// The commit uses "push-update" as the stage label to distinguish it from
/// initial PR creation commits ("integrating").
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
            "Can only push PR changes for Done tasks".into(),
        ));
    }

    if !task.has_open_pr() {
        return Err(WorkflowError::InvalidTransition(
            "Task does not have an open PR — use open_pr to create one first".into(),
        ));
    }

    let branch = task.branch_name.as_deref().ok_or_else(|| {
        WorkflowError::InvalidTransition("Cannot push PR changes: task has no branch".into())
    })?;

    // Safety-net commit: capture any uncommitted changes before pushing
    super::commit_worktree::execute(git, &task, "push-update", None)
        .map_err(git_to_workflow_err)?;

    // Push the task's branch to origin
    git.push_branch(branch).map_err(git_to_workflow_err)?;

    Ok(task)
}

// -- Helpers --

fn git_to_workflow_err(e: GitError) -> WorkflowError {
    WorkflowError::GitError(e.to_string())
}
