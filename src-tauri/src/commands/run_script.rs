//! Commands for managing run script processes per task.

use std::path::PathBuf;

use tauri::State;

use crate::error::TauriError;
use crate::project_registry::ProjectRegistry;
use crate::run_process::{RunLogs, RunStatus};

/// Start the run script for a task.
///
/// Returns the current status. If the process is already running, returns the existing status
/// without spawning a new process.
#[tauri::command]
pub fn start_run_script(
    registry: State<ProjectRegistry>,
    window: tauri::Window,
    task_id: String,
) -> Result<RunStatus, TauriError> {
    registry.with_project(window.label(), |state| {
        let project_root = state.project_root().to_path_buf();

        let task = state
            .api()?
            .get_task(&task_id)
            .map_err(Into::<TauriError>::into)?;

        if task.is_archived() {
            return Err(TauriError::new(
                "TASK_TERMINAL",
                "Cannot run script on an archived task",
            ));
        }

        let worktree_path: PathBuf = task
            .worktree_path
            .ok_or_else(|| {
                TauriError::new(
                    "NO_WORKTREE",
                    "Task has no worktree — run.sh requires a worktree",
                )
            })
            .map(PathBuf::from)?;

        state
            .run_processes()
            .start(&task_id, &project_root, &worktree_path)
            .map_err(|e| TauriError::new("RUN_START_FAILED", e))
    })
}

/// Stop the run script for a task.
///
/// No-op if no process is running for this task.
#[tauri::command]
pub fn stop_run_script(
    registry: State<ProjectRegistry>,
    window: tauri::Window,
    task_id: String,
) -> Result<(), TauriError> {
    registry.with_project(window.label(), |state| {
        state.run_processes().stop(&task_id);
        Ok(())
    })
}

/// Get the current status of the run script for a task.
#[tauri::command]
pub fn get_run_status(
    registry: State<ProjectRegistry>,
    window: tauri::Window,
    task_id: String,
) -> Result<RunStatus, TauriError> {
    registry.with_project(window.label(), |state| {
        Ok(state.run_processes().status(&task_id))
    })
}

/// Get log lines produced by the run script since `since_line`.
///
/// Use `since_line: 0` for the first poll. Pass the returned `total_lines` as
/// `since_line` on subsequent polls to receive only new lines.
#[tauri::command]
pub fn get_run_logs(
    registry: State<ProjectRegistry>,
    window: tauri::Window,
    task_id: String,
    since_line: usize,
) -> Result<RunLogs, TauriError> {
    registry.with_project(window.label(), |state| {
        Ok(state.run_processes().logs(&task_id, since_line))
    })
}
