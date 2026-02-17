//! Configurable workflow system for task orchestration.
//!
//! This module provides a flexible, config-driven workflow system where stages
//! are defined in YAML rather than hardcoded. Key concepts:
//!
//! - **Stage**: A named step in the workflow (e.g., "planning", "review")
//! - **Artifact**: Named output from a stage (e.g., "plan", "summary")
//! - **Capabilities**: What a stage can do (ask questions, produce subtasks)
//! - **Workflow**: Ordered collection of stages with transition rules
//!
//! # Example Configuration
//!
//! ```yaml
//! stages:
//!   - name: planning
//!     artifact: plan
//!     capabilities:
//!       ask_questions: true
//!
//!   - name: work
//!     artifact: summary
//!     inputs: [plan]
//! ```
//!
//! # Design Principles
//!
//! - **Modular**: Each concept in its own file
//! - **Self-contained**: No dependencies on legacy code
//! - **Testable**: Pure functions, minimal side effects
//! - **Extensible**: Easy to add new capabilities or stage types

// ============================================================================
// Unchanged infrastructure modules
// ============================================================================

pub mod adapters;
pub mod config;
pub mod domain;
pub mod execution;
pub mod ports;
pub mod runtime;

// ============================================================================
// Domain modules (interactions + services co-located)
// ============================================================================

pub mod agent;
pub mod assistant;
pub mod human;
pub mod integration;
pub mod query;
pub mod stage;
pub mod task;

// ============================================================================
// Shared infrastructure (not domain-specific)
// ============================================================================

pub(crate) mod api;
mod cleanup;
pub(crate) mod iteration;
pub(crate) mod log_service;
pub mod orchestrator;
mod periodic;
pub(crate) mod prompt;

// ============================================================================
// Logging Macros
// ============================================================================

/// Log workflow warnings (non-critical failures that should be visible for debugging).
macro_rules! workflow_warn {
    ($($arg:tt)*) => {
        $crate::orkestra_debug!("workflow", "WARNING: {}", format!($($arg)*));
    };
}

// Make macro available within the workflow module
pub(crate) use workflow_warn;

// ============================================================================
// Re-exports
// ============================================================================

// Re-export main types for convenience
#[cfg(any(test, feature = "testutil"))]
pub use adapters::InMemoryWorkflowStore;
pub use adapters::{Git2GitService, SqliteWorkflowStore};
pub use config::{
    load_auto_task_templates, load_workflow, load_workflow_for_project, AutoTaskTemplate,
    FlowConfig, FlowStageEntry, FlowStageOverride, IntegrationConfig, LoadError, StageCapabilities,
    StageConfig, WorkflowConfig,
};
pub use domain::{
    AssistantSession, DerivedTaskState, Iteration, LogEntry, OrkAction, PrCommentData, Question,
    QuestionAnswer, QuestionOption, SessionState, StageSession, Task, TaskView, TodoItem,
    ToolInput,
};
pub use execution::{PromptBuilder, StageOutput, StageOutputError, StagePromptContext};
pub use ports::{
    CommitInfo, GitError, GitService, MergeResult, WorkflowError, WorkflowResult, WorkflowStore,
    WorktreeCreated,
};
pub use runtime::{Artifact, ArtifactStore, Outcome, Phase, Status};

// Service re-exports (from new locations)
pub use api::{AgentKiller, WorkflowApi};
pub use assistant::service::AssistantService;
pub use cleanup::cleanup_stale_target_lock;
pub use integration::merge::{merge_task_sync, spawn_merge_integration};
pub use integration::pr_creation::{create_pr_sync, spawn_pr_creation};
pub use iteration::IterationService;
pub use log_service::LogService;
pub use orchestrator::{OrchestratorError, OrchestratorEvent, OrchestratorLoop};
pub use prompt::PromptService;
pub use stage::service::{
    ExecutionComplete, ExecutionResult, SpawnError, SpawnResult, StageExecutionService,
};
pub use stage::session::{SessionService, SessionSpawnContext};

// Parser re-exports
pub use orkestra_parser::{ResumeMarker, ResumeMarkerType};

// Export execution types for testing
pub use execution::{AgentRunner, AgentRunnerTrait, RunConfig};

#[cfg(any(test, feature = "testutil"))]
pub use execution::MockAgentRunner;
