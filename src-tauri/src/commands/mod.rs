//! Modular Tauri commands for workflow operations.
//!
//! Commands are organized by concern:
//! - `task_crud`: Create, read, update, delete tasks
//! - `human_actions`: Approve, reject, answer questions
//! - `queries`: Read-only queries for iterations, artifacts, config
//! - Startup: Get startup status (always available)

mod human_actions;
mod queries;
mod task_crud;

use crate::startup::{StartupState, StartupStatus};
use tauri::State;

// Re-export all commands for use in invoke_handler!
pub use human_actions::*;
pub use queries::*;
pub use task_crud::*;

// =============================================================================
// Startup Commands
// =============================================================================

/// Get the startup status.
///
/// This command is always available and should be called by the frontend
/// before attempting any other workflow operations.
#[tauri::command]
pub fn get_startup_status(state: State<StartupState>) -> StartupStatus {
    state.status().clone()
}
