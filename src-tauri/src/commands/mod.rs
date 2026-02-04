//! Modular Tauri commands for workflow operations.
//!
//! Commands are organized by concern:
//! - `task_crud`: Create, read, update, delete tasks
//! - `human_actions`: Approve, reject, answer questions
//! - `queries`: Read-only queries for iterations, artifacts, config
//! - `external_tools`: Open worktrees in terminal emulators and code editors
//! - `diff`: Git diff operations with syntax highlighting
//! - Startup: Get startup status (always available)

mod diff;
mod external_tools;
mod human_actions;
mod project;
mod queries;
mod task_crud;

// Re-export all commands for use in invoke_handler!
pub use diff::*;
pub use external_tools::*;
pub use human_actions::*;
pub use project::*;
pub use queries::*;
pub use task_crud::*;
