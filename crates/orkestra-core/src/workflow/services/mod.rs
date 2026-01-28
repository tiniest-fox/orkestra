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
//! let task = api.create_task("Fix bug", "Fix the login bug", None)?;
//! // ... agent does work ...
//! let task = api.approve(&task.id)?;
//! ```

mod agent_actions;
mod api;
mod human_actions;
mod integration;
mod iteration_service;
mod log_service;
mod orchestrator;
mod prompt_service;
mod queries;
mod script_execution;
mod session_logs;
mod session_service;
mod stage_execution;
mod subtask_service;
mod task_crud;
mod agent_execution;

// ============================================================================
// Logging Macros
// ============================================================================

/// Log workflow warnings (non-critical failures that should be visible for debugging).
macro_rules! workflow_warn {
    ($($arg:tt)*) => {
        eprintln!("[orkestra] WARNING: {}", format!($($arg)*));
    };
}

// Make macros available within the services module
pub(crate) use workflow_warn;

pub use api::WorkflowApi;
pub use iteration_service::IterationService;
pub use log_service::LogService;
pub use orchestrator::{OrchestratorError, OrchestratorEvent, OrchestratorLoop};
pub use prompt_service::PromptService;
// Note: ScriptExecutionService is internal to StageExecutionService
pub use session_logs::{
    get_claude_session_path, recover_session_logs, ResumeMarker, ResumeMarkerType,
};
pub use session_service::{SessionService, SessionSpawnContext};
pub use stage_execution::{
    ExecutionComplete, ExecutionResult, SpawnError, SpawnResult, StageExecutionService,
};
pub use subtask_service::SubtaskService;
// Note: AgentExecutionService is internal to StageExecutionService
