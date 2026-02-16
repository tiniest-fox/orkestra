//! Port interfaces for the workflow system.
//!
//! Ports define abstractions that allow the workflow system to work with
//! different implementations (databases, file systems, etc.) and enable testing.

mod git_service;
mod pr_service;
mod process_spawner;
mod store;

pub use git_service::{
    CommitInfo, FileChangeType, FileDiff, GitError, GitService, MergeResult, SyncStatus, TaskDiff,
    WorktreeCreated,
};
pub use pr_service::{PrError, PrService};
pub use process_spawner::{ProcessConfig, ProcessError, ProcessHandle, ProcessSpawner};
pub use store::{WorkflowError, WorkflowResult, WorkflowStore};

#[cfg(any(test, feature = "testutil"))]
pub use git_service::mock::MockGitService;
#[cfg(any(test, feature = "testutil"))]
pub use pr_service::mock::MockPrService;
#[cfg(any(test, feature = "testutil"))]
pub use process_spawner::mock::MockProcessSpawner;
