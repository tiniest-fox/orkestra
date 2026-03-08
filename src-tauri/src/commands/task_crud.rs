//! Task CRUD commands.

use crate::{error::TauriError, project_registry::ProjectRegistry};
use orkestra_core::workflow::{Task, TaskView};
use tauri::{State, Window};

/// Get all tasks from the workflow (rich view with iterations, sessions, derived state).
#[tauri::command]
pub fn workflow_get_tasks(
    registry: State<ProjectRegistry>,
    window: Window,
) -> Result<Vec<TaskView>, TauriError> {
    registry.with_project(window.label(), |state| {
        state.api()?.list_task_views().map_err(Into::into)
    })
}

/// Create a new task.
///
/// If git service is configured, creates a worktree and branch.
/// `base_branch` specifies which branch to create from (defaults to current).
/// `auto_mode` enables autonomous execution through all stages.
/// `flow` selects an alternate workflow flow (e.g., `"quick_fix"`). Omit for default full pipeline.
#[tauri::command]
pub fn workflow_create_task(
    registry: State<ProjectRegistry>,
    window: Window,
    title: String,
    description: String,
    base_branch: Option<String>,
    auto_mode: Option<bool>,
    flow: Option<String>,
) -> Result<Task, TauriError> {
    registry.with_project(window.label(), |state| {
        state
            .api()?
            .create_task_with_options(
                &title,
                &description,
                base_branch.as_deref(),
                auto_mode.unwrap_or(false),
                flow.as_deref(),
            )
            .map_err(Into::into)
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
) -> Result<Task, TauriError> {
    registry.with_project(window.label(), |state| {
        state
            .api()?
            .create_subtask(&parent_id, &title, &description)
            .map_err(Into::into)
    })
}

/// Get a specific task by ID.
#[tauri::command]
pub fn workflow_get_task(
    registry: State<ProjectRegistry>,
    window: Window,
    task_id: String,
) -> Result<Task, TauriError> {
    registry.with_project(window.label(), |state| {
        state.api()?.get_task(&task_id).map_err(Into::into)
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
) -> Result<(), TauriError> {
    registry.with_project(window.label(), |state| {
        state
            .api()?
            .delete_task_with_cleanup(&task_id)
            .map_err(Into::into)
    })
}

/// List subtasks for a parent task (rich view with derived state).
#[tauri::command]
pub fn workflow_list_subtasks(
    registry: State<ProjectRegistry>,
    window: Window,
    parent_id: String,
) -> Result<Vec<TaskView>, TauriError> {
    registry.with_project(window.label(), |state| {
        state
            .api()?
            .list_subtask_views(&parent_id)
            .map_err(Into::into)
    })
}

/// Get all archived tasks (rich view with iterations, sessions, derived state).
///
/// Archived tasks are completed tasks that have been integrated (branch merged).
#[tauri::command]
pub fn workflow_get_archived_tasks(
    registry: State<ProjectRegistry>,
    window: Window,
) -> Result<Vec<TaskView>, TauriError> {
    registry.with_project(window.label(), |state| {
        state.api()?.list_archived_task_views().map_err(Into::into)
    })
}
