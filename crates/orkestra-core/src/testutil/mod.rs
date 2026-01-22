//! Test utilities for orkestra-core.
//!
//! This module provides reusable test scaffolding:
//!
//! - **Git helpers** for creating temporary repositories
//! - **Test orchestrator** for full workflow E2E testing
//! - **Mock process spawner** for testing without invoking Claude Code
//!
//! # Quick Start
//!
//! For E2E tests, use [`create_test_orchestrator`]:
//!
//! ```ignore
//! use orkestra_core::testutil::create_test_orchestrator;
//!
//! let (orchestrator, _temp_dir) = create_test_orchestrator().unwrap();
//!
//! // Use real Project methods (real SQLite database, real git)
//! let task = orchestrator.project.create_task("Feature", "Description").unwrap();
//!
//! // Simulate workflow using real code paths
//! orchestrator.project.set_plan(&task.id, "Plan").unwrap();
//! orchestrator.project.approve_plan(&task.id).unwrap();
//! orchestrator.simulate_worker_changes(&task.id, "Changes").unwrap();
//! orchestrator.project.complete_task(&task.id, "Done").unwrap();
//! let task = orchestrator.project.approve_review(&task.id).unwrap();
//! ```
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

mod git_helpers;
mod mock_spawner;
mod test_orchestrator;

pub use git_helpers::{
    create_and_commit_file, create_orkestra_dirs, create_temp_git_repo, get_current_branch,
    is_git_repo, make_commit,
};
pub use mock_spawner::{MockProcessSpawner, SpawnCall};
pub use test_orchestrator::{create_test_orchestrator, TestOrchestrator};
