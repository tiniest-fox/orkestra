//! Adapter implementations for the workflow system.
//!
//! Adapters implement the port traits for specific backends.

mod claude_process;
mod diff;
mod git_service;
mod memory;
mod opencode_process;
mod sqlite;

pub use claude_process::ClaudeProcessSpawner;
pub use diff::*;
pub use git_service::Git2GitService;
pub use memory::InMemoryWorkflowStore;
pub use opencode_process::OpenCodeProcessSpawner;
pub use sqlite::SqliteWorkflowStore;
