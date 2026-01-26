//! Adapter implementations for the workflow system.
//!
//! Adapters implement the port traits for specific backends.

mod claude_process;
mod git_service;
mod memory;
mod sqlite;

pub use claude_process::ClaudeProcessSpawner;
pub use git_service::Git2GitService;
pub use memory::InMemoryWorkflowStore;
pub use sqlite::SqliteWorkflowStore;
