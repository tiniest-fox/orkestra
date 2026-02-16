//! Adapter implementations for the workflow system.
//!
//! Adapters implement the port traits for specific backends.

mod claude_process;
mod gh_pr_service;
mod memory;
mod opencode_process;
mod sqlite;

pub use claude_process::ClaudeProcessSpawner;
pub use gh_pr_service::GhPrService;
pub use memory::InMemoryWorkflowStore;
pub use opencode_process::OpenCodeProcessSpawner;
pub use orkestra_git::Git2GitService;
pub use sqlite::SqliteWorkflowStore;
