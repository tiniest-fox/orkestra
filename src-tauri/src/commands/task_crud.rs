//! Task CRUD commands.

use crate::{error::TauriError, project_registry::ProjectRegistry};
use orkestra_networking::task;
use serde_json::Value;
use tauri::{State, Window};

/// Get all tasks from the workflow (rich view with iterations, sessions, derived state).
#[tauri::command]
pub fn workflow_get_tasks(
    registry: State<ProjectRegistry>,
    window: Window,
) -> Result<Value, TauriError> {
    registry.with_project(window.label(), |state| {
        task::list_tasks(state.command_context(), &Value::Null).map_err(Into::into)
    })
}

/// Create a new task.
///
/// If git service is configured, creates a worktree and branch.
/// `base_branch` specifies which branch to create from (defaults to current).
/// `auto_mode` enables autonomous execution through all stages.
/// `interactive` starts the task in interactive mode (user-directed agent session).
/// `flow` selects an alternate workflow flow (e.g., `"quick_fix"`). Omit for default full pipeline.
#[tauri::command]
#[allow(clippy::too_many_arguments)]
pub fn workflow_create_task(
    registry: State<ProjectRegistry>,
    window: Window,
    title: String,
    description: String,
    base_branch: Option<String>,
    auto_mode: Option<bool>,
    interactive: Option<bool>,
    flow: Option<String>,
) -> Result<Value, TauriError> {
    registry.with_project(window.label(), |state| {
        let params = serde_json::json!({
            "title": title,
            "description": description,
            "base_branch": base_branch,
            "auto_mode": auto_mode,
            "interactive": interactive,
            "flow": flow,
        });
        task::create_task(state.command_context(), &params).map_err(Into::into)
    })
}

/// Create a subtask under a parent task.
#[tauri::command]
pub fn workflow_create_subtask(
    registry: State<ProjectRegistry>,
    window: Window,
    parent_id: String,
    title: String,
    description: String,
) -> Result<Value, TauriError> {
    registry.with_project(window.label(), |state| {
        let params = serde_json::json!({
            "parent_id": parent_id,
            "title": title,
            "description": description,
        });
        task::create_subtask(state.command_context(), &params).map_err(Into::into)
    })
}

/// Get a specific task by ID.
#[tauri::command]
pub fn workflow_get_task(
    registry: State<ProjectRegistry>,
    window: Window,
    task_id: String,
) -> Result<Value, TauriError> {
    registry.with_project(window.label(), |state| {
        let params = serde_json::json!({ "task_id": task_id });
        task::get_task(state.command_context(), &params).map_err(Into::into)
    })
}

/// Delete a task, killing any running agents first.
///
/// Terminates running agent processes (instant signal sends), then deletes all
/// DB records in a single transaction. Git worktree cleanup is handled in the
/// background by the orchestrator's orphaned worktree cleanup on startup.
#[tauri::command]
pub fn workflow_delete_task(
    registry: State<ProjectRegistry>,
    window: Window,
    task_id: String,
) -> Result<Value, TauriError> {
    registry.with_project(window.label(), |state| {
        let params = serde_json::json!({ "task_id": task_id });
        task::delete_task(state.command_context(), &params).map_err(Into::into)
    })
}

/// List subtasks for a parent task (rich view with derived state).
#[tauri::command]
pub fn workflow_list_subtasks(
    registry: State<ProjectRegistry>,
    window: Window,
    parent_id: String,
) -> Result<Value, TauriError> {
    registry.with_project(window.label(), |state| {
        let params = serde_json::json!({ "parent_id": parent_id });
        task::list_subtasks(state.command_context(), &params).map_err(Into::into)
    })
}

/// Get all archived tasks (rich view with iterations, sessions, derived state).
///
/// Archived tasks are completed tasks that have been integrated (branch merged).
#[tauri::command]
pub fn workflow_get_archived_tasks(
    registry: State<ProjectRegistry>,
    window: Window,
) -> Result<Value, TauriError> {
    registry.with_project(window.label(), |state| {
        task::get_archived_tasks(state.command_context(), &Value::Null).map_err(Into::into)
    })
}
