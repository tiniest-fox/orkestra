//! Test utilities and mock implementations.
//!
//! This module provides reusable test scaffolding for orkestra-core tests:
//!
//! - **Mock implementations** for core traits
//! - **Git helpers** for creating temporary repositories
//! - **Test orchestrator** for full workflow testing
//!
//! # Module Structure
//!
//! - [`mock_store`] - In-memory task store ([`MockStore`])
//! - [`mock_spawner`] - Mock process spawner ([`MockProcessSpawner`])
//! - [`git_helpers`] - Git repository test utilities
//! - [`test_orchestrator`] - Full workflow test helper ([`TestOrchestrator`])
//!
//! # Quick Start
//!
//! For most E2E tests, use [`create_test_orchestrator`]:
//!
//! ```ignore
//! use orkestra_core::testutil::create_test_orchestrator;
//!
//! let (orchestrator, _temp_dir) = create_test_orchestrator().unwrap();
//!
//! // Create task with worktree
//! let task = orchestrator
//!     .create_task_with_worktree("Feature", "Description")
//!     .unwrap();
//!
//! // Simulate workflow...
//! orchestrator.simulate_planner_complete(&task.id, "Plan").unwrap();
//! orchestrator.task_service.approve_plan(&task.id).unwrap();
//! orchestrator.simulate_worker_complete(&task.id, "Done").unwrap();
//! let task = orchestrator.complete_and_integrate(&task.id).unwrap();
//! ```
//!
//! # Using Individual Mocks
//!
//! For unit tests, use the mocks directly:
//!
//! ```ignore
//! use orkestra_core::testutil::{MockStore, MockProcessSpawner};
//! use orkestra_core::adapters::FixedClock;
//! use orkestra_core::services::TaskService;
//!
//! let store = MockStore::new();
//! let clock = FixedClock("2025-01-21T00:00:00Z".to_string());
//! let service = TaskService::new(store, clock);
//!
//! let task = service.create("Title", "Desc", false).unwrap();
//! ```

mod git_helpers;
mod mock_spawner;
mod mock_store;
mod test_orchestrator;

// Re-export everything for convenient access
pub use git_helpers::{
    create_and_commit_file, create_orkestra_dirs, create_temp_git_repo, get_current_branch,
    is_git_repo, make_commit,
};
pub use mock_spawner::{MockProcessSpawner, SpawnCall};
pub use mock_store::MockStore;
pub use test_orchestrator::{create_test_orchestrator, TestOrchestrator};
