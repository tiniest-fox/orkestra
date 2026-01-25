//! Modular Tauri commands for workflow operations.
//!
//! Commands are organized by concern:
//! - `task_crud`: Create, read, update, delete tasks
//! - `human_actions`: Approve, reject, answer questions
//! - `queries`: Read-only queries for iterations, artifacts, config

mod human_actions;
mod queries;
mod task_crud;

// Re-export all commands for use in invoke_handler!
pub use human_actions::*;
pub use queries::*;
pub use task_crud::*;
