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
//! // Use real Project methods
//! let task = orchestrator.project.create_task("Feature", "Description").unwrap();
//!
//! // Skip breakdown for simplicity
//! orchestrator.project.update_task(&task.id, |t| {
//!     t.skip_breakdown = true;
//!     Ok(())
//! }).unwrap();
//!
//! // Simulate workflow using real code paths
//! orchestrator.project.set_plan(&task.id, "Plan").unwrap();
//! orchestrator.project.approve_plan(&task.id).unwrap();
//! orchestrator.simulate_worker_changes(&task.id, "Changes").unwrap();
//! orchestrator.project.complete_task(&task.id, "Done").unwrap();
//! let task = orchestrator.project.approve_review(&task.id).unwrap();
//! ```
//!
//! # Using Individual Mocks
//!
//! For unit tests that need trait-based mocking, use the mocks directly:
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
