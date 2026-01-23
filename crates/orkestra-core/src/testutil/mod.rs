//! Test utilities for orkestra-core.
//!
//! This module provides reusable test scaffolding:
//!
//! - **Git helpers** for creating temporary repositories
//! - **Test orchestrator** for full workflow E2E testing using real code paths
//!
//! # Quick Start
//!
//! For E2E tests, use [`create_test_orchestrator`]:
//!
//! ```ignore
//! use orkestra_core::testutil::create_test_orchestrator;
//! use orkestra_core::tasks;
//!
//! let (orchestrator, _temp_dir) = create_test_orchestrator().unwrap();
//!
//! // UI creates task (uses tasks:: functions like Tauri)
//! let task = tasks::create_task(&orchestrator.project, "Feature", "Description").unwrap();
//!
//! // Agent sets plan via CLI (like Claude Code would)
//! orchestrator.run_cli_in_worktree(&task.id, &["task", "set-plan", &task.id, "--plan", "..."]).unwrap();
//!
//! // UI approves plan
//! tasks::approve_task_plan(&orchestrator.project, &task.id).unwrap();
//!
//! // Agent makes changes and completes
//! orchestrator.simulate_worker_file_change(&task.id, "file.rs", "content").unwrap();
//! orchestrator.run_cli_in_worktree(&task.id, &["task", "complete", &task.id, "--summary", "Done"]).unwrap();
//!
//! // UI starts review, reviewer agent approves
//! tasks::start_automated_review(&orchestrator.project, &task.id).unwrap();
//! orchestrator.run_cli_in_worktree(&task.id, &["task", "approve-review", &task.id]).unwrap();
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
mod test_orchestrator;

pub use git_helpers::{
    create_and_commit_file, create_orkestra_dirs, create_temp_git_repo,
    create_worktree_setup_script, get_current_branch, is_git_repo, make_commit,
};
pub use test_orchestrator::{create_test_orchestrator, TestOrchestrator};
