//! Human action commands: approve, reject, answer questions.

use crate::{error::TauriError, state::AppState};
use orkestra_core::workflow::{QuestionAnswer, Task};
use tauri::State;

/// Approve the current stage artifact.
///
/// Moves the task to the next stage (or Done if this was the last stage).
#[tauri::command]
pub fn workflow_approve(state: State<AppState>, task_id: String) -> Result<Task, TauriError> {
    state.api()?.approve(&task_id).map_err(Into::into)
}

/// Reject the current stage artifact with feedback.
///
/// Creates a new iteration in the same stage so the agent can retry.
#[tauri::command]
pub fn workflow_reject(
    state: State<AppState>,
    task_id: String,
    feedback: String,
) -> Result<Task, TauriError> {
    state.api()?.reject(&task_id, &feedback).map_err(Into::into)
}

/// Answer pending questions from the agent.
///
/// Clears the pending questions and resumes the task.
#[tauri::command]
pub fn workflow_answer_questions(
    state: State<AppState>,
    task_id: String,
    answers: Vec<QuestionAnswer>,
) -> Result<Task, TauriError> {
    state
        .api()?
        .answer_questions(&task_id, answers)
        .map_err(Into::into)
}

/// Integrate a completed task by merging its branch to primary.
///
/// Commits any pending changes, merges the task branch, and cleans up.
/// On merge conflict, the task is moved back to the work stage.
#[tauri::command]
pub fn workflow_integrate_task(
    state: State<AppState>,
    task_id: String,
) -> Result<Task, TauriError> {
    state.api()?.integrate_task(&task_id).map_err(Into::into)
}

/// Retry a failed task by resuming from its last active stage.
///
/// Assumes the underlying issue has been resolved.
#[tauri::command]
pub fn workflow_retry(state: State<AppState>, task_id: String) -> Result<Task, TauriError> {
    state.api()?.retry(&task_id).map_err(Into::into)
}

/// Set the auto_mode flag on a task.
///
/// When enabling auto mode on a task that is awaiting review,
/// immediately auto-approves or auto-answers pending questions.
#[tauri::command]
pub fn workflow_set_auto_mode(
    state: State<AppState>,
    task_id: String,
    auto_mode: bool,
) -> Result<Task, TauriError> {
    state
        .api()?
        .set_auto_mode(&task_id, auto_mode)
        .map_err(Into::into)
}
