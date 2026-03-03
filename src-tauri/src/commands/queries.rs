//! Read-only query commands.

use std::sync::Arc;

use crate::{error::TauriError, project_registry::ProjectRegistry};
use orkestra_core::workflow::{
    Artifact, AutoTaskTemplate, Iteration, LogEntry, Question, TaskView, WorkflowConfig,
};
use orkestra_networking::{fetch_pr_status, PrStatus};
use serde::Serialize;
use tauri::{State, Window};

/// Get the workflow configuration.
///
/// Returns the stage definitions and workflow settings.
/// This is infallible since config is loaded at startup, but returns Result
/// for API consistency.
#[tauri::command]
#[allow(clippy::unnecessary_wraps)]
pub fn workflow_get_config(
    registry: State<ProjectRegistry>,
    window: Window,
) -> Result<WorkflowConfig, TauriError> {
    registry.with_project(window.label(), |state| Ok(state.config().clone()))
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

/// Consume the pre-fetched startup data (one-shot).
///
/// Returns `Some(StartupData)` if the background prefetch has completed,
/// `None` if it hasn't finished yet (React should fall back to polling).
#[tauri::command]
#[allow(clippy::unnecessary_wraps)]
pub fn workflow_get_startup_data(
    registry: State<ProjectRegistry>,
    window: Window,
) -> Result<Option<StartupData>, TauriError> {
    registry.with_project(window.label(), |state| {
        let arc = state.startup_tasks();
        let slot = arc.lock().unwrap();
        Ok(slot.as_ref().map(|tasks| StartupData {
            config: state.config().clone(),
            tasks: tasks.clone(),
        }))
    })
}

/// Get auto-task templates.
///
/// Returns predefined task templates loaded from `.orkestra/tasks/*.md`.
/// Templates are loaded once at startup and cached.
#[tauri::command]
#[allow(clippy::unnecessary_wraps)]
pub fn workflow_get_auto_task_templates(
    registry: State<ProjectRegistry>,
    window: Window,
) -> Result<Vec<AutoTaskTemplate>, TauriError> {
    registry.with_project(window.label(), |state| {
        Ok(state.auto_task_templates().to_vec())
    })
}

/// Get all iterations for a task.
#[tauri::command]
pub fn workflow_get_iterations(
    registry: State<ProjectRegistry>,
    window: Window,
    task_id: String,
) -> Result<Vec<Iteration>, TauriError> {
    registry.with_project(window.label(), |state| {
        state.api()?.get_iterations(&task_id).map_err(Into::into)
    })
}

/// Get a specific artifact by name.
#[tauri::command]
pub fn workflow_get_artifact(
    registry: State<ProjectRegistry>,
    window: Window,
    task_id: String,
    name: String,
) -> Result<Option<Artifact>, TauriError> {
    registry.with_project(window.label(), |state| {
        state
            .api()?
            .get_artifact(&task_id, &name)
            .map_err(Into::into)
    })
}

/// Get pending questions for a task.
#[tauri::command]
pub fn workflow_get_pending_questions(
    registry: State<ProjectRegistry>,
    window: Window,
    task_id: String,
) -> Result<Vec<Question>, TauriError> {
    registry.with_project(window.label(), |state| {
        state
            .api()?
            .get_pending_questions(&task_id)
            .map_err(Into::into)
    })
}

/// Get the current stage for a task.
#[tauri::command]
pub fn workflow_get_current_stage(
    registry: State<ProjectRegistry>,
    window: Window,
    task_id: String,
) -> Result<Option<String>, TauriError> {
    registry.with_project(window.label(), |state| {
        state.api()?.get_current_stage(&task_id).map_err(Into::into)
    })
}

/// Get rejection feedback from the last iteration.
#[tauri::command]
pub fn workflow_get_rejection_feedback(
    registry: State<ProjectRegistry>,
    window: Window,
    task_id: String,
) -> Result<Option<String>, TauriError> {
    registry.with_project(window.label(), |state| {
        state
            .api()?
            .get_rejection_feedback(&task_id)
            .map_err(Into::into)
    })
}

/// Branch information for the UI.
#[derive(Serialize)]
pub struct BranchList {
    /// Available branches (excluding task/* branches).
    pub branches: Vec<String>,
    /// Currently checked-out branch.
    pub current: Option<String>,
    /// Latest commit message (first line).
    pub latest_commit_message: Option<String>,
}

/// List available git branches.
///
/// Returns empty lists if git service is not configured.
#[tauri::command]
pub fn workflow_list_branches(
    registry: State<ProjectRegistry>,
    window: Window,
) -> Result<BranchList, TauriError> {
    registry.with_project(window.label(), |state| {
        let git = {
            let api = state.api()?;
            let Some(git) = api.git_service() else {
                return Ok(BranchList {
                    branches: vec![],
                    current: None,
                    latest_commit_message: None,
                });
            };
            Arc::clone(git)
        }; // mutex released here — git subprocesses run off the lock

        let latest_commit_message = git
            .commit_log(1)
            .ok()
            .and_then(|commits| commits.first().map(|c| c.message.clone()));

        Ok(BranchList {
            branches: git.list_branches().unwrap_or_default(),
            current: git.current_branch().ok(),
            latest_commit_message,
        })
    })
}

/// Get log entries for a task's stage or a specific session.
///
/// Reads log entries from the database for a specific session, or the task's
/// current (or specified) stage session.
///
/// # Arguments
/// * `task_id` - The task ID
/// * `stage` - Optional stage name. If None, uses the task's current stage.
/// * `session_id` - Optional session ID. If provided, fetches logs for that
///   specific session directly (takes precedence over `stage`).
///
/// # Returns
/// Vec of LogEntry representing agent activity (tool uses, text output, etc.)
#[tauri::command]
#[allow(clippy::similar_names)]
pub fn workflow_get_logs(
    registry: State<ProjectRegistry>,
    window: Window,
    task_id: String,
    stage: Option<String>,
    session_id: Option<String>,
) -> Result<Vec<LogEntry>, TauriError> {
    registry.with_project(window.label(), |state| {
        state
            .api()?
            .get_task_logs(&task_id, stage.as_deref(), session_id.as_deref())
            .map_err(Into::into)
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
) -> Result<Option<LogEntry>, TauriError> {
    registry.with_project(window.label(), |state| {
        state.api()?.get_latest_log(&task_id).map_err(Into::into)
    })
}

// =============================================================================
// PR Status
// =============================================================================

/// Get PR status from GitHub.
///
/// Delegates to `orkestra_networking::fetch_pr_status`, which calls `gh pr view`
/// and `gh api` endpoints for state, checks, reviews, and comments.
///
/// # Arguments
/// * `pr_url` - The full GitHub PR URL (e.g., `https://github.com/owner/repo/pull/123`)
///
/// # Errors
/// Returns error if `gh` CLI is not installed or the PR URL is invalid.
#[tauri::command]
pub async fn workflow_get_pr_status(pr_url: String) -> Result<PrStatus, TauriError> {
    fetch_pr_status(&pr_url)
        .await
        .map_err(|e| TauriError::new(e.code, e.message))
}
