//! Adapter implementations for the workflow system.
//!
//! Adapters implement the port traits for specific backends.

mod gh_pr_service;

pub use gh_pr_service::GhPrService;
pub use orkestra_git::Git2GitService;

// ProcessSpawner adapters re-exported from orkestra-agent
pub use orkestra_agent::interactions::spawner::claude::ClaudeProcessSpawner;
pub use orkestra_agent::interactions::spawner::opencode::OpenCodeProcessSpawner;

// Store types re-exported from orkestra-store
#[cfg(any(test, feature = "testutil"))]
pub use orkestra_store::InMemoryWorkflowStore;
pub use orkestra_store::SqliteWorkflowStore;
