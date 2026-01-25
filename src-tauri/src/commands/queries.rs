//! Read-only query commands.

use crate::{error::TauriError, state::AppState};
use orkestra_core::workflow::{Artifact, Iteration, Question, WorkflowConfig};
use serde::Serialize;
use tauri::State;

/// Get the workflow configuration.
///
/// Returns the stage definitions and workflow settings.
/// This is infallible since config is loaded at startup, but returns Result
/// for API consistency.
#[tauri::command]
pub fn workflow_get_config(state: State<AppState>) -> Result<WorkflowConfig, TauriError> {
    Ok(state.config().clone())
}

/// Get all iterations for a task.
#[tauri::command]
pub fn workflow_get_iterations(
    state: State<AppState>,
    task_id: String,
) -> Result<Vec<Iteration>, TauriError> {
    state.api()?.get_iterations(&task_id).map_err(Into::into)
}

/// Get a specific artifact by name.
#[tauri::command]
pub fn workflow_get_artifact(
    state: State<AppState>,
    task_id: String,
    name: String,
) -> Result<Option<Artifact>, TauriError> {
    state
        .api()?
        .get_artifact(&task_id, &name)
        .map_err(Into::into)
}

/// Get pending questions for a task.
#[tauri::command]
pub fn workflow_get_pending_questions(
    state: State<AppState>,
    task_id: String,
) -> Result<Vec<Question>, TauriError> {
    state
        .api()?
        .get_pending_questions(&task_id)
        .map_err(Into::into)
}

/// Get the current stage for a task.
#[tauri::command]
pub fn workflow_get_current_stage(
    state: State<AppState>,
    task_id: String,
) -> Result<Option<String>, TauriError> {
    state.api()?.get_current_stage(&task_id).map_err(Into::into)
}

/// Get rejection feedback from the last iteration.
#[tauri::command]
pub fn workflow_get_rejection_feedback(
    state: State<AppState>,
    task_id: String,
) -> Result<Option<String>, TauriError> {
    state
        .api()?
        .get_rejection_feedback(&task_id)
        .map_err(Into::into)
}

/// Branch information for the UI.
#[derive(Serialize)]
pub struct BranchList {
    /// Available branches (excluding task/* branches).
    pub branches: Vec<String>,
    /// Currently checked-out branch.
    pub current: Option<String>,
    /// Primary branch (main or master).
    pub primary: Option<String>,
}

/// List available git branches.
///
/// Returns empty lists if git service is not configured.
#[tauri::command]
pub fn workflow_list_branches(state: State<AppState>) -> Result<BranchList, TauriError> {
    let api = state.api()?;

    let Some(git) = api.git_service() else {
        return Ok(BranchList {
            branches: vec![],
            current: None,
            primary: None,
        });
    };

    Ok(BranchList {
        branches: git.list_branches().unwrap_or_default(),
        current: git.current_branch().ok(),
        primary: git.detect_primary_branch().ok(),
    })
}
