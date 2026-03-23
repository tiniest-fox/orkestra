//! Modular Tauri commands for workflow operations.
//!
//! Commands are organized by concern:
//! - `task_crud`: Create, read, update, delete tasks
//! - `human_actions`: Approve, reject, answer questions
//! - `queries`: Read-only queries for iterations, artifacts, config
//! - `external_tools`: Open worktrees in terminal emulators and code editors
//! - `setup`: One-time app setup (CLI tool installation)
//! - `diff`: Git diff operations with syntax highlighting
//! - `git_actions`: Git sync operations (push, pull, sync status)
//! - `assistant`: Project-level assistant chat panel commands
//! - Startup: Get startup status (always available)

mod assistant;
mod diff;
mod external_tools;
mod git_actions;
mod human_actions;
mod project;
mod queries;
mod run_script;
pub(crate) mod setup;
mod stage_chat;
mod task_crud;

// Re-export all commands for use in invoke_handler!
pub use assistant::*;
pub use diff::*;
pub use external_tools::*;
pub use git_actions::*;
pub use human_actions::*;
pub use project::*;
pub use queries::*;
pub use run_script::*;
pub use setup::*;
pub use stage_chat::*;
pub use task_crud::*;
