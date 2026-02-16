//! Adapter implementations for the workflow system.
//!
//! Adapters implement the port traits for specific backends.

mod claude_process;
mod gh_pr_service;
mod opencode_process;

pub use claude_process::ClaudeProcessSpawner;
pub use gh_pr_service::GhPrService;
pub use opencode_process::OpenCodeProcessSpawner;
pub use orkestra_git::Git2GitService;

// Store types re-exported from orkestra-store
#[cfg(any(test, feature = "testutil"))]
pub use orkestra_store::InMemoryWorkflowStore;
pub use orkestra_store::SqliteWorkflowStore;
