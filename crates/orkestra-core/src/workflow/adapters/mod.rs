//! Adapter implementations for the workflow system.
//!
//! Adapters implement the port traits for specific backends.

mod claude_spawner;
mod memory;
mod sqlite;

pub use claude_spawner::ClaudeAgentSpawner;
pub use memory::InMemoryWorkflowStore;
pub use sqlite::SqliteWorkflowStore;
