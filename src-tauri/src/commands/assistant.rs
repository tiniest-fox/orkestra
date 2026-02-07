//! Assistant chat commands.
//!
//! Commands for the project-level assistant chat panel: sending messages,
//! stopping processes, listing sessions, and retrieving logs.

use crate::{error::TauriError, project_registry::ProjectRegistry};
use orkestra_core::workflow::{
    domain::AssistantSession,
    services::AssistantService,
    LogEntry,
};
use std::sync::Arc;
use tauri::{State, Window};

/// Create an `AssistantService` from project state.
///
/// The service requires: store (from DB), spawner (from provider registry), and `project_root`.
fn create_assistant_service(
    registry: &State<ProjectRegistry>,
    window: &Window,
) -> Result<AssistantService, TauriError> {
    registry.with_project(window.label(), |state| {
        let store = state.create_store();
        let project_root = state.project_root().to_path_buf();
        let provider_registry = Arc::clone(state.provider_registry());

        Ok(AssistantService::new(store, provider_registry, project_root))
    })
}

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
) -> Result<AssistantSession, TauriError> {
    let service = create_assistant_service(&registry, &window)?;
    service
        .send_message(session_id.as_deref(), &message)
        .map_err(Into::into)
}

/// Stop the running agent process for a session.
///
/// Kills the agent process tree if running and updates the session state.
#[tauri::command]
pub fn assistant_stop(
    registry: State<ProjectRegistry>,
    window: Window,
    session_id: String,
) -> Result<(), TauriError> {
    let service = create_assistant_service(&registry, &window)?;
    service.stop_process(&session_id).map_err(Into::into)
}

/// List all assistant sessions for this project.
///
/// Returns sessions ordered by creation time (most recent first).
#[tauri::command]
pub fn assistant_list_sessions(
    registry: State<ProjectRegistry>,
    window: Window,
) -> Result<Vec<AssistantSession>, TauriError> {
    let service = create_assistant_service(&registry, &window)?;
    service.list_sessions().map_err(Into::into)
}

/// Get log entries for a specific assistant session.
///
/// Returns all log entries (user messages, agent output, errors) for the session.
#[tauri::command]
pub fn assistant_get_logs(
    registry: State<ProjectRegistry>,
    window: Window,
    session_id: String,
) -> Result<Vec<LogEntry>, TauriError> {
    let service = create_assistant_service(&registry, &window)?;
    service.get_session_logs(&session_id).map_err(Into::into)
}
