//! Test utilities for orkestra-core.
//!
//! This module provides reusable test scaffolding:
//!
//! - **Git helpers** for creating temporary repositories
//!
//! # Unit Tests
//!
//! For unit tests, use `SqliteStore::in_memory()`:
//!
//! ```ignore
//! use orkestra_core::adapters::{SqliteStore, FixedClock};
//! use orkestra_core::services::TaskService;
//!
//! let store = SqliteStore::in_memory().unwrap();
//! let clock = FixedClock("2025-01-21T00:00:00Z".to_string());
//! let service = TaskService::new(store, clock);
//!
//! let task = service.create("Title", "Desc", false).unwrap();
//! ```
//!
//! # Integration Tests
//!
//! For workflow integration tests, use `MockSpawner`:
//!
//! ```ignore
//! use orkestra_core::workflow::{WorkflowApi, SqliteWorkflowStore, OrchestratorLoop};
//! use orkestra_core::workflow::execution::MockSpawner;
//! ```

mod git_helpers;

pub use git_helpers::{
    create_and_commit_file, create_orkestra_dirs, create_temp_git_repo,
    create_worktree_setup_script, get_current_branch, is_git_repo, make_commit,
};
