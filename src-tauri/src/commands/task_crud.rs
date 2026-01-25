//! Task CRUD commands.

use crate::{error::TauriError, state::AppState};
use orkestra_core::workflow::Task;
use tauri::State;

/// Get all tasks from the workflow.
#[tauri::command]
pub fn workflow_get_tasks(state: State<AppState>) -> Result<Vec<Task>, TauriError> {
    state.api()?.list_tasks().map_err(Into::into)
}

/// Create a new task.
#[tauri::command]
pub fn workflow_create_task(
    state: State<AppState>,
    title: String,
    description: String,
) -> Result<Task, TauriError> {
    state
        .api()?
        .create_task(&title, &description)
        .map_err(Into::into)
}

/// Create a subtask under a parent task.
#[tauri::command]
pub fn workflow_create_subtask(
    state: State<AppState>,
    parent_id: String,
    title: String,
    description: String,
) -> Result<Task, TauriError> {
    state
        .api()?
        .create_subtask(&parent_id, &title, &description)
        .map_err(Into::into)
}

/// Get a specific task by ID.
#[tauri::command]
pub fn workflow_get_task(state: State<AppState>, task_id: String) -> Result<Task, TauriError> {
    state.api()?.get_task(&task_id).map_err(Into::into)
}

/// Delete a task.
#[tauri::command]
pub fn workflow_delete_task(state: State<AppState>, task_id: String) -> Result<(), TauriError> {
    state.api()?.delete_task(&task_id).map_err(Into::into)
}

/// List subtasks for a parent task.
#[tauri::command]
pub fn workflow_list_subtasks(
    state: State<AppState>,
    parent_id: String,
) -> Result<Vec<Task>, TauriError> {
    state.api()?.list_subtasks(&parent_id).map_err(Into::into)
}
