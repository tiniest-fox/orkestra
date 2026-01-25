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

pub mod adapters;
pub mod config;
pub mod domain;
pub mod execution;
pub mod ports;
pub mod runtime;
pub mod services;

// Re-export main types for convenience
pub use adapters::{InMemoryWorkflowStore, SqliteWorkflowStore};
pub use config::{
    load_workflow, load_workflow_for_project, IntegrationConfig, LoadError, StageCapabilities,
    StageConfig, WorkflowConfig,
};
pub use domain::{Iteration, Question, QuestionAnswer, QuestionOption, Task};
pub use execution::{PromptBuilder, StageOutput, StageOutputError, StagePromptContext};
pub use ports::{WorkflowError, WorkflowResult, WorkflowStore};
pub use runtime::{
    Artifact, ArtifactStore, Outcome, Phase, Status, Transition, TransitionError,
    TransitionTrigger, TransitionValidator,
};
pub use services::{
    OrchestratorError, OrchestratorEvent, OrchestratorLoop, TaskExecutionService, WorkflowApi,
};

// Export execution types for testing
pub use execution::{AgentRunner, AgentRunnerTrait, RunConfig};

#[cfg(any(test, feature = "testutil"))]
pub use execution::MockAgentRunner;

// Re-export crash recovery types
pub use ports::CrashRecoveryStore;

#[cfg(any(test, feature = "testutil"))]
pub use ports::InMemoryCrashRecoveryStore;
