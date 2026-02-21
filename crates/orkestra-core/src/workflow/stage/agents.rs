//! Agent execution service.
//!
//! Thin service that holds process lifecycle dependencies and delegates
//! execution to the `execute_agent` interaction.

use std::path::PathBuf;
use std::sync::mpsc::Receiver;
use std::sync::Arc;

use super::types::ActivityLogEntry;
use crate::workflow::config::WorkflowConfig;
use crate::workflow::domain::{IterationTrigger, Task};
use crate::workflow::execution::{
    AgentConfigError, AgentRunnerTrait, ProviderRegistry, RegistryError, RunError, RunEvent,
    SiblingTaskContext,
};
use crate::workflow::prompt::PromptService;

use super::session::SessionSpawnContext;

// ============================================================================
// Types
// ============================================================================

/// Handle to a running task execution.
///
/// The orchestrator polls the event receiver to process execution events.
pub struct ExecutionHandle {
    /// Task being executed.
    pub task_id: String,
    /// Stage being executed.
    pub stage: String,
    /// Process ID of the agent.
    pub pid: u32,
    /// Event receiver for execution progress.
    pub events: Receiver<RunEvent>,
}

/// Errors that can occur during agent execution.
#[derive(Debug, Clone)]
#[allow(clippy::enum_variant_names)] // Error suffix is intentional for clarity
pub enum ExecutionError {
    /// Failed to resolve agent configuration.
    ConfigError(String),
    /// Failed to run the agent.
    RunError(String),
}

impl std::fmt::Display for ExecutionError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::ConfigError(msg) => write!(f, "Config error: {msg}"),
            Self::RunError(msg) => write!(f, "Run error: {msg}"),
        }
    }
}

impl std::error::Error for ExecutionError {}

impl From<AgentConfigError> for ExecutionError {
    fn from(err: AgentConfigError) -> Self {
        Self::ConfigError(err.to_string())
    }
}

impl From<RunError> for ExecutionError {
    fn from(err: RunError) -> Self {
        Self::RunError(err.to_string())
    }
}

impl From<RegistryError> for ExecutionError {
    fn from(err: RegistryError) -> Self {
        Self::ConfigError(err.to_string())
    }
}

// ============================================================================
// Agent Execution Service
// ============================================================================

/// Service for executing agent instances across different providers.
///
/// Holds process lifecycle dependencies and delegates execution to the
/// `execute_agent` interaction.
pub struct AgentExecutionService {
    /// Agent runner for executing agent processes.
    runner: Arc<dyn AgentRunnerTrait>,
    /// Prompt building service.
    prompt_service: PromptService,
    /// Workflow configuration.
    workflow: WorkflowConfig,
    /// Provider registry for resolving model specs to capabilities.
    registry: Arc<ProviderRegistry>,
}

impl AgentExecutionService {
    /// Create a new agent execution service.
    pub fn new(
        runner: Arc<dyn AgentRunnerTrait>,
        workflow: WorkflowConfig,
        project_root: PathBuf,
        registry: Arc<ProviderRegistry>,
    ) -> Self {
        Self {
            runner,
            prompt_service: PromptService::new(project_root),
            workflow,
            registry,
        }
    }

    /// Execute a stage for a task (async with events).
    ///
    /// Delegates to the `execute_agent` interaction.
    pub fn execute_stage(
        &self,
        task: &Task,
        trigger: Option<&IterationTrigger>,
        spawn_context: &SessionSpawnContext,
        activity_logs: &[ActivityLogEntry],
        sibling_tasks: &[SiblingTaskContext],
    ) -> Result<ExecutionHandle, ExecutionError> {
        super::interactions::execute_agent::execute(
            self.runner.as_ref(),
            &self.prompt_service,
            &self.workflow,
            self.registry.as_ref(),
            task,
            trigger,
            spawn_context,
            activity_logs,
            sibling_tasks,
        )
    }
}

// ============================================================================
// Tests
// ============================================================================

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_execution_error_display() {
        let err = ExecutionError::ConfigError("test".into());
        assert!(err.to_string().contains("Config"));

        let err = ExecutionError::RunError("test".into());
        assert!(err.to_string().contains("Run"));
    }

    #[test]
    fn test_registry_error_converts_to_config_error() {
        let registry_err = RegistryError::UnknownProvider("badprovider".into());
        let exec_err = ExecutionError::from(registry_err);
        assert!(matches!(exec_err, ExecutionError::ConfigError(_)));
        assert!(exec_err.to_string().contains("badprovider"));
    }
}
