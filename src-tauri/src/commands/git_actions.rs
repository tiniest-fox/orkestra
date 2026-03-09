//! Tauri commands for git sync operations.
//!
//! Push, pull, and sync status for the current branch.

use std::sync::Arc;

use orkestra_core::workflow::ports::{SyncStatus, WorkflowError};
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
) -> Result<Option<SyncStatus>, TauriError> {
    registry.with_project(window.label(), |state| {
        let git = {
            let api = state.api()?;
            let Some(git) = api.git_service() else {
                return Ok(None);
            };
            Arc::clone(git)
        }; // mutex released here — git subprocess runs off the lock
        git.sync_status()
            .map_err(|e| WorkflowError::GitError(e.to_string()).into())
    })
}

/// Push the current branch to origin.
///
/// Uses `git push -u origin <current_branch>`.
#[tauri::command]
pub fn workflow_git_push(
    registry: State<ProjectRegistry>,
    window: Window,
) -> Result<(), TauriError> {
    registry.with_project(window.label(), |state| {
        let git = {
            let api = state.api()?;
            let Some(git) = api.git_service() else {
                return Err(
                    WorkflowError::GitError("Git service not available".to_string()).into(),
                );
            };
            Arc::clone(git)
        }; // mutex released here — git subprocess runs off the lock
        let branch = git
            .current_branch()
            .map_err(|e| WorkflowError::GitError(e.to_string()))?;
        git.push_branch(&branch)
            .map_err(|e| WorkflowError::GitError(e.to_string()).into())
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
) -> Result<(), TauriError> {
    registry.with_project(window.label(), |state| {
        let git = {
            let api = state.api()?;
            let Some(git) = api.git_service() else {
                return Err(
                    WorkflowError::GitError("Git service not available".to_string()).into(),
                );
            };
            Arc::clone(git)
        }; // mutex released here — git subprocess runs off the lock
        git.pull_branch()
            .map_err(|e| WorkflowError::GitError(e.to_string()).into())
    })
}

/// Fetch from origin to update remote-tracking refs without merging.
#[tauri::command]
pub fn workflow_git_fetch(
    registry: State<ProjectRegistry>,
    window: Window,
) -> Result<(), TauriError> {
    registry.with_project(window.label(), |state| {
        let git = {
            let api = state.api()?;
            let Some(git) = api.git_service() else {
                return Err(
                    WorkflowError::GitError("Git service not available".to_string()).into(),
                );
            };
            Arc::clone(git)
        }; // mutex released here — git subprocess runs off the lock
        git.fetch_origin()
            .map_err(|e| WorkflowError::GitError(e.to_string()).into())
    })
}
