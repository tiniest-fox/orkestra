//! Assistant chat commands.
//!
//! Commands for the project-level assistant chat panel: sending messages,
//! stopping processes, listing sessions, and retrieving logs.

use crate::{error::TauriError, project_registry::ProjectRegistry};
use orkestra_networking::assistant;
use serde_json::Value;
use tauri::{State, Window};

/// Send a message to an assistant session.
///
/// If `session_id` is None, creates a new session. Otherwise, loads the existing session.
/// Spawns or resumes the Claude Code agent and streams its output to the database.
///
/// # Arguments
/// * `session_id` - Optional session ID. None creates a new session.
/// * `message` - The user's message text.
///
/// # Returns
/// The assistant session (new or existing) with updated state.
#[tauri::command]
pub fn assistant_send_message(
    registry: State<ProjectRegistry>,
    window: Window,
    session_id: Option<String>,
    message: String,
) -> Result<Value, TauriError> {
    registry.with_project(window.label(), |state| {
        let params = serde_json::json!({ "session_id": session_id, "message": message });
        assistant::assistant_send_message(state.command_context(), &params).map_err(Into::into)
    })
}

/// Stop the running agent process for a session.
///
/// Kills the agent process tree if running and updates the session state.
#[tauri::command]
pub fn assistant_stop(
    registry: State<ProjectRegistry>,
    window: Window,
    session_id: String,
) -> Result<Value, TauriError> {
    registry.with_project(window.label(), |state| {
        let params = serde_json::json!({ "session_id": session_id });
        assistant::assistant_stop(state.command_context(), &params).map_err(Into::into)
    })
}

/// List all assistant sessions for this project.
///
/// Returns sessions ordered by creation time (most recent first).
#[tauri::command]
pub fn assistant_list_sessions(
    registry: State<ProjectRegistry>,
    window: Window,
) -> Result<Value, TauriError> {
    registry.with_project(window.label(), |state| {
        assistant::assistant_list_sessions(state.command_context(), &Value::Null)
            .map_err(Into::into)
    })
}

/// Get log entries for a specific assistant session.
///
/// Returns all log entries (user messages, agent output, errors) for the session.
#[tauri::command]
pub fn assistant_get_logs(
    registry: State<ProjectRegistry>,
    window: Window,
    session_id: String,
) -> Result<Value, TauriError> {
    registry.with_project(window.label(), |state| {
        let params = serde_json::json!({ "session_id": session_id });
        assistant::assistant_get_logs(state.command_context(), &params).map_err(Into::into)
    })
}

/// Send a message to the task-scoped assistant session.
///
/// Creates a new session if none exists for the task, or reuses the existing one.
/// Spawns Claude Code in the task's worktree for task-specific context.
#[tauri::command]
pub fn assistant_send_task_message(
    registry: State<ProjectRegistry>,
    window: Window,
    task_id: String,
    message: String,
) -> Result<Value, TauriError> {
    registry.with_project(window.label(), |state| {
        let params = serde_json::json!({ "task_id": task_id, "message": message });
        assistant::assistant_send_task_message(state.command_context(), &params).map_err(Into::into)
    })
}

/// List project-level assistant sessions (excludes task-scoped sessions).
///
/// Returns sessions ordered by creation time (most recent first).
#[tauri::command]
pub fn assistant_list_project_sessions(
    registry: State<ProjectRegistry>,
    window: Window,
) -> Result<Value, TauriError> {
    registry.with_project(window.label(), |state| {
        assistant::assistant_list_project_sessions(state.command_context(), &Value::Null)
            .map_err(Into::into)
    })
}
