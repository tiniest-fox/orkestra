//! Read-only query commands.

use crate::{error::TauriError, project_registry::ProjectRegistry};
use orkestra_core::workflow::{TaskView, WorkflowConfig};
use orkestra_networking::{fetch_pr_status, query, PrStatus};
use serde_json::Value;
use tauri::{State, Window};

/// Get the workflow configuration.
///
/// Returns the stage definitions and workflow settings.
#[tauri::command]
pub fn workflow_get_config(
    registry: State<ProjectRegistry>,
    window: Window,
) -> Result<Value, TauriError> {
    registry.with_project(window.label(), |state| {
        query::get_config(state.command_context(), &Value::Null).map_err(Into::into)
    })
}

/// Bundled startup data pushed from the Tauri side before React mounts.
///
/// Lets React skip IPC calls for the initial render — both config and tasks
/// are already in memory when the window opens.
#[derive(serde::Serialize, Clone)]
pub struct StartupData {
    /// Workflow config (already loaded at startup).
    pub config: WorkflowConfig,
    /// Task list pre-fetched in the background thread.
    pub tasks: Vec<TaskView>,
}

/// Get startup data (config + tasks) in a single call.
///
/// Returns the workflow config and full task list together.
#[tauri::command]
pub fn workflow_get_startup_data(
    registry: State<ProjectRegistry>,
    window: Window,
) -> Result<Value, TauriError> {
    registry.with_project(window.label(), |state| {
        query::get_startup_data(state.command_context(), &Value::Null).map_err(Into::into)
    })
}

/// Get auto-task templates.
///
/// Returns predefined task templates loaded from `.orkestra/tasks/*.md`.
#[tauri::command]
pub fn workflow_get_auto_task_templates(
    registry: State<ProjectRegistry>,
    window: Window,
) -> Result<Value, TauriError> {
    registry.with_project(window.label(), |state| {
        query::get_auto_task_templates(state.command_context(), &Value::Null).map_err(Into::into)
    })
}

/// Get all iterations for a task.
#[tauri::command]
pub fn workflow_get_iterations(
    registry: State<ProjectRegistry>,
    window: Window,
    task_id: String,
) -> Result<Value, TauriError> {
    registry.with_project(window.label(), |state| {
        let params = serde_json::json!({ "task_id": task_id });
        query::get_iterations(state.command_context(), &params).map_err(Into::into)
    })
}

/// Get a specific artifact by name.
#[tauri::command]
pub fn workflow_get_artifact(
    registry: State<ProjectRegistry>,
    window: Window,
    task_id: String,
    name: String,
) -> Result<Value, TauriError> {
    registry.with_project(window.label(), |state| {
        let params = serde_json::json!({ "task_id": task_id, "name": name });
        query::get_artifact(state.command_context(), &params).map_err(Into::into)
    })
}

/// Get pending questions for a task.
#[tauri::command]
pub fn workflow_get_pending_questions(
    registry: State<ProjectRegistry>,
    window: Window,
    task_id: String,
) -> Result<Value, TauriError> {
    registry.with_project(window.label(), |state| {
        let params = serde_json::json!({ "task_id": task_id });
        query::get_pending_questions(state.command_context(), &params).map_err(Into::into)
    })
}

/// Get the current stage for a task.
#[tauri::command]
pub fn workflow_get_current_stage(
    registry: State<ProjectRegistry>,
    window: Window,
    task_id: String,
) -> Result<Value, TauriError> {
    registry.with_project(window.label(), |state| {
        let params = serde_json::json!({ "task_id": task_id });
        query::get_current_stage(state.command_context(), &params).map_err(Into::into)
    })
}

/// Get rejection feedback from the last iteration.
#[tauri::command]
pub fn workflow_get_rejection_feedback(
    registry: State<ProjectRegistry>,
    window: Window,
    task_id: String,
) -> Result<Value, TauriError> {
    registry.with_project(window.label(), |state| {
        let params = serde_json::json!({ "task_id": task_id });
        query::get_rejection_feedback(state.command_context(), &params).map_err(Into::into)
    })
}

/// List available git branches.
///
/// Returns empty lists if git service is not configured.
#[tauri::command]
pub fn workflow_list_branches(
    registry: State<ProjectRegistry>,
    window: Window,
) -> Result<Value, TauriError> {
    registry.with_project(window.label(), |state| {
        query::list_branches(state.command_context(), &Value::Null).map_err(Into::into)
    })
}

/// Get log entries for a task's stage or a specific session with optional cursor-based pagination.
///
/// # Arguments
/// * `task_id` - The task ID
/// * `stage` - Optional stage name. If None, uses the task's current stage.
/// * `session_id` - Optional session ID. If provided, fetches logs for that
///   specific session directly (takes precedence over `stage`).
/// * `cursor` - Optional sequence_number cursor. If provided, only entries with
///   sequence_number > cursor are returned, enabling incremental fetching.
///
/// # Returns
/// `{ entries: Vec<LogEntry>, cursor: u64 | null }` — entries since the cursor, plus
/// the new cursor value for the next incremental fetch.
#[tauri::command]
pub fn workflow_get_logs(
    registry: State<ProjectRegistry>,
    window: Window,
    task_id: String,
    stage: Option<String>,
    session_id: Option<String>,
    cursor: Option<u64>,
) -> Result<Value, TauriError> {
    registry.with_project(window.label(), |state| {
        let params = serde_json::json!({
            "task_id": task_id,
            "stage": stage,
            "session_id": session_id,
            "cursor": cursor,
        });
        query::get_logs(state.command_context(), &params).map_err(Into::into)
    })
}

/// Get the most recent log entry for a task's current stage session.
///
/// Returns `None` if the task has no active stage, no session for the stage,
/// or the session has no log entries.
#[tauri::command]
pub fn workflow_get_latest_log(
    registry: State<ProjectRegistry>,
    window: Window,
    task_id: String,
) -> Result<Value, TauriError> {
    registry.with_project(window.label(), |state| {
        let params = serde_json::json!({ "task_id": task_id });
        query::get_latest_log(state.command_context(), &params).map_err(Into::into)
    })
}

// =============================================================================
// PR Status
// =============================================================================

/// Get PR status from GitHub.
///
/// Calls `gh pr view` and `gh api` endpoints for state, checks, reviews, and comments.
///
/// # Arguments
/// * `pr_url` - The full GitHub PR URL (e.g., `https://github.com/owner/repo/pull/123`)
///
/// # Errors
/// Returns error if `gh` CLI is not installed or the PR URL is invalid.
#[tauri::command]
pub async fn workflow_get_pr_status(pr_url: String) -> Result<PrStatus, TauriError> {
    fetch_pr_status(&pr_url).await.map_err(Into::into)
}
