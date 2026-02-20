//! Git operations for Orkestra task orchestration.
//!
//! Provides worktree management, branch operations, merge/rebase, and diff
//! capabilities for isolating tasks in parallel git worktrees.

mod interface;
mod types;

mod interactions;
mod service;

#[cfg(any(test, feature = "testutil"))]
mod mock;

// API Layer: re-export public interface
pub use interface::GitService;
pub use service::Git2GitService;
pub use types::{
    CommitInfo, FileChangeType, FileDiff, GitError, MergeResult, SyncStatus, TaskDiff,
    WorktreeCreated, WorktreeState,
};

#[cfg(any(test, feature = "testutil"))]
pub use mock::MockGitService;
