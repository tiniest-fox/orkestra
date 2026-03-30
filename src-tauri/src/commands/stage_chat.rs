//! Tauri commands for stage chat during `AwaitingReview` and Interrupted.
//!
//! Stage chat allows users to send free-form messages to a stage agent
//! while it is awaiting approval or interrupted, without affecting task state.

use crate::{error::TauriError, project_registry::ProjectRegistry};
use orkestra_networking::stage_chat;
use serde_json::Value;
use tauri::{State, Window};

/// Send a chat message to the stage agent for a task.
///
/// Valid when the task is in `AwaitingApproval` or `Interrupted` phase.
/// The agent responds in free-form — no JSON schema, no state transitions.
#[tauri::command]
pub fn stage_chat_send(
    registry: State<ProjectRegistry>,
    window: Window,
    task_id: String,
    message: String,
) -> Result<Value, TauriError> {
    registry.with_project(window.label(), |state| {
        let params = serde_json::json!({ "task_id": task_id, "message": message });
        stage_chat::stage_chat_send(state.command_context(), &params).map_err(Into::into)
    })
}

/// Stop the running chat agent process for a task.
///
/// Kills the process tree and clears the agent PID. Does not exit chat mode —
/// call `workflow_return_to_work` to exit chat and resume structured work.
#[tauri::command]
pub fn stage_chat_stop(
    registry: State<ProjectRegistry>,
    window: Window,
    task_id: String,
) -> Result<Value, TauriError> {
    registry.with_project(window.label(), |state| {
        let params = serde_json::json!({ "task_id": task_id });
        stage_chat::stage_chat_stop(state.command_context(), &params).map_err(Into::into)
    })
}
