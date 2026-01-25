//! Workflow API service layer.
//!
//! This module provides the main API for workflow operations. The `WorkflowApi`
//! struct is the single entry point for all workflow operations, encapsulating
//! business logic for task lifecycle management.
//!
//! # Module Organization
//!
//! The API is split across files by concern:
//! - `api.rs`: Core struct definition and workflow config queries
//! - `task_crud.rs`: Task CRUD operations
//! - `human_actions.rs`: UI actions (approve, reject, answer questions)
//! - `agent_actions.rs`: Orchestrator calls (agent started, process output)
//! - `integration.rs`: Git integration operations
//! - `queries.rs`: Read-only query operations
//!
//! # Example
//!
//! ```ignore
//! use orkestra_core::workflow::{WorkflowApi, SqliteWorkflowStore, load_workflow};
//!
//! let workflow = load_workflow("workflow.yaml")?;
//! let store = Box::new(SqliteWorkflowStore::new(conn));
//! let api = WorkflowApi::new(workflow, store);
//!
//! let task = api.create_task("Fix bug", "Fix the login bug")?;
//! // ... agent does work ...
//! let task = api.approve(&task.id)?;
//! ```

mod agent_actions;
mod api;
mod human_actions;
mod integration;
mod orchestrator;
mod queries;
mod task_crud;

pub use api::WorkflowApi;
pub use orchestrator::{OrchestratorError, OrchestratorEvent, OrchestratorLoop};
