//! Tauri commands for git sync operations.
//!
//! Push, pull, and sync status for the current branch.

use orkestra_networking::git;
use serde_json::Value;
use tauri::{State, Window};

use crate::error::TauriError;
use crate::project_registry::ProjectRegistry;

/// Get sync status relative to origin for the current branch.
///
/// Returns null if:
/// - Git service is not configured
/// - No remote named "origin" is configured
/// - The branch doesn't exist on origin
/// - In detached HEAD state
#[tauri::command]
pub fn workflow_git_sync_status(
    registry: State<ProjectRegistry>,
    window: Window,
) -> Result<Value, TauriError> {
    registry.with_project(window.label(), |state| {
        git::git_sync_status(state.command_context(), &Value::Null).map_err(Into::into)
    })
}

/// Push the current branch to origin.
///
/// Uses `git push -u origin <current_branch>`.
#[tauri::command]
pub fn workflow_git_push(
    registry: State<ProjectRegistry>,
    window: Window,
) -> Result<Value, TauriError> {
    registry.with_project(window.label(), |state| {
        git::git_push(state.command_context(), &Value::Null).map_err(Into::into)
    })
}

/// Pull changes from origin into the current branch using rebase.
///
/// Performs `git pull --rebase origin <current_branch>`. If the rebase encounters
/// conflicts, it is aborted to restore a clean working tree and a conflict error is returned.
#[tauri::command]
pub fn workflow_git_pull(
    registry: State<ProjectRegistry>,
    window: Window,
) -> Result<Value, TauriError> {
    registry.with_project(window.label(), |state| {
        git::git_pull(state.command_context(), &Value::Null).map_err(Into::into)
    })
}

/// Fetch from origin to update remote-tracking refs without merging.
#[tauri::command]
pub fn workflow_git_fetch(
    registry: State<ProjectRegistry>,
    window: Window,
) -> Result<Value, TauriError> {
    registry.with_project(window.label(), |state| {
        git::git_fetch(state.command_context(), &Value::Null).map_err(Into::into)
    })
}

/// Get sync status for a specific task's branch relative to origin.
///
/// Returns null if the branch has no remote tracking ref.
/// Requires the task to be Done with an open PR.
#[tauri::command]
pub fn workflow_task_sync_status(
    registry: State<ProjectRegistry>,
    window: Window,
    task_id: String,
) -> Result<Value, TauriError> {
    registry.with_project(window.label(), |state| {
        let params = serde_json::json!({ "task_id": task_id });
        git::task_sync_status(state.command_context(), &params).map_err(Into::into)
    })
}
