//! Human action commands: approve, reject, answer questions.

use crate::{error::TauriError, project_registry::ProjectRegistry};
use orkestra_core::workflow::{spawn_merge_integration, spawn_pr_creation, QuestionAnswer, Task};
use tauri::{State, Window};

/// Approve the current stage artifact.
///
/// Moves the task to the next stage (or Done if this was the last stage).
#[tauri::command]
pub fn workflow_approve(
    registry: State<ProjectRegistry>,
    window: Window,
    task_id: String,
) -> Result<Task, TauriError> {
    registry.with_project(window.label(), |state| {
        state.api()?.approve(&task_id).map_err(Into::into)
    })
}

/// Reject the current stage artifact with feedback.
///
/// Creates a new iteration in the same stage so the agent can retry.
#[tauri::command]
pub fn workflow_reject(
    registry: State<ProjectRegistry>,
    window: Window,
    task_id: String,
    feedback: String,
) -> Result<Task, TauriError> {
    registry.with_project(window.label(), |state| {
        state.api()?.reject(&task_id, &feedback).map_err(Into::into)
    })
}

/// Answer pending questions from the agent.
///
/// Clears the pending questions and resumes the task.
#[tauri::command]
pub fn workflow_answer_questions(
    registry: State<ProjectRegistry>,
    window: Window,
    task_id: String,
    answers: Vec<QuestionAnswer>,
) -> Result<Task, TauriError> {
    registry.with_project(window.label(), |state| {
        state
            .api()?
            .answer_questions(&task_id, answers)
            .map_err(Into::into)
    })
}

/// Retry a failed task by resuming from its last active stage.
///
/// Assumes the underlying issue has been resolved.
#[tauri::command]
pub fn workflow_retry(
    registry: State<ProjectRegistry>,
    window: Window,
    task_id: String,
    instructions: Option<String>,
) -> Result<Task, TauriError> {
    registry.with_project(window.label(), |state| {
        state
            .api()?
            .retry(&task_id, instructions.as_deref())
            .map_err(Into::into)
    })
}

/// Set the auto_mode flag on a task.
///
/// When enabling auto mode on a task that is awaiting review,
/// immediately auto-approves or auto-answers pending questions.
#[tauri::command]
pub fn workflow_set_auto_mode(
    registry: State<ProjectRegistry>,
    window: Window,
    task_id: String,
    auto_mode: bool,
) -> Result<Task, TauriError> {
    registry.with_project(window.label(), |state| {
        state
            .api()?
            .set_auto_mode(&task_id, auto_mode)
            .map_err(Into::into)
    })
}

/// Interrupt a running agent execution.
///
/// Kills the agent process immediately and transitions to Interrupted phase.
#[tauri::command]
pub fn workflow_interrupt(
    registry: State<ProjectRegistry>,
    window: Window,
    task_id: String,
) -> Result<Task, TauriError> {
    registry.with_project(window.label(), |state| {
        state.api()?.interrupt(&task_id).map_err(Into::into)
    })
}

/// Resume an interrupted task with an optional message.
///
/// Creates a new iteration and sets the task to Idle for the orchestrator.
#[tauri::command]
pub fn workflow_resume(
    registry: State<ProjectRegistry>,
    window: Window,
    task_id: String,
    message: Option<String>,
) -> Result<Task, TauriError> {
    registry.with_project(window.label(), |state| {
        state.api()?.resume(&task_id, message).map_err(Into::into)
    })
}

/// Merge a Done task's branch into its base branch.
///
/// Validates and marks the task as Integrating, then spawns the git work
/// (squash, rebase, merge) on a background thread so the UI is not blocked.
#[tauri::command]
pub fn workflow_merge_task(
    registry: State<ProjectRegistry>,
    window: Window,
    task_id: String,
) -> Result<Task, TauriError> {
    registry.with_project(window.label(), |state| {
        spawn_merge_integration(state.api_arc(), &task_id).map_err(Into::into)
    })
}

/// Create a pull request for a Done task's branch.
///
/// Validates and marks the task as Integrating, then spawns PR creation
/// (commit, push, gh pr create) on a background thread so the UI is not blocked.
#[tauri::command]
pub fn workflow_open_pr(
    registry: State<ProjectRegistry>,
    window: Window,
    task_id: String,
) -> Result<Task, TauriError> {
    registry.with_project(window.label(), |state| {
        spawn_pr_creation(state.api_arc(), &task_id).map_err(Into::into)
    })
}

/// Retry PR creation by recovering from Failed to Done+Idle.
///
/// Clears the error state so the user can attempt PR creation again.
#[tauri::command]
pub fn workflow_retry_pr(
    registry: State<ProjectRegistry>,
    window: Window,
    task_id: String,
) -> Result<Task, TauriError> {
    registry.with_project(window.label(), |state| {
        state.api()?.retry_pr_creation(&task_id).map_err(Into::into)
    })
}
