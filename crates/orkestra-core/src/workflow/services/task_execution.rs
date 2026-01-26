//! Task execution service.
//!
//! This service coordinates stage execution for tasks. It ties together:
//! - PromptService: for building agent prompts
//! - SessionService: for session continuity across resumes
//! - AgentRunner: for running the actual agent
//!
//! The orchestrator delegates to this service for all agent execution.

use std::path::PathBuf;
use std::sync::mpsc::Receiver;
use std::sync::Arc;

use crate::orkestra_debug;
use crate::workflow::config::WorkflowConfig;
use crate::workflow::domain::Task;
use crate::workflow::execution::{
    AgentConfigError, AgentRunnerTrait, IntegrationErrorContext, RunConfig, RunError, RunEvent,
    StageOutput,
};
use crate::workflow::ports::{WorkflowResult, WorkflowStore};

use super::prompt_service::PromptService;
use super::session_service::SessionService;
use super::{workflow_error, workflow_warn};

// ============================================================================
// Execution Handle
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

impl ExecutionHandle {
    /// Check if the execution is complete (channel closed).
    pub fn is_complete(&self) -> bool {
        // Try a non-blocking receive - if we get Disconnected, it's complete
        use std::sync::mpsc::TryRecvError;
        match self.events.try_recv() {
            Err(TryRecvError::Disconnected) => true,
            _ => false,
        }
    }
}

// ============================================================================
// Execution Error
// ============================================================================

/// Errors that can occur during task execution.
#[derive(Debug, Clone)]
pub enum ExecutionError {
    /// Failed to resolve agent configuration.
    ConfigError(String),
    /// Failed to get session context.
    SessionError(String),
    /// Failed to run the agent.
    RunError(String),
}

impl std::fmt::Display for ExecutionError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::ConfigError(msg) => write!(f, "Config error: {msg}"),
            Self::SessionError(msg) => write!(f, "Session error: {msg}"),
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

// ============================================================================
// Task Execution Service
// ============================================================================

/// Service for coordinating task stage execution.
///
/// This service is the main entry point for running agents. It:
/// 1. Builds the prompt from task context
/// 2. Gets session resume info
/// 3. Runs the agent
/// 4. Handles events (completion)
pub struct TaskExecutionService {
    /// Agent runner for executing Claude processes.
    runner: Arc<dyn AgentRunnerTrait>,
    /// Prompt building service.
    prompt_service: PromptService,
    /// Session management service.
    session_service: SessionService,
    /// Workflow configuration.
    workflow: WorkflowConfig,
}

impl TaskExecutionService {
    /// Create a new task execution service.
    pub fn new(
        runner: Arc<dyn AgentRunnerTrait>,
        store: Arc<dyn WorkflowStore>,
        workflow: WorkflowConfig,
        project_root: PathBuf,
    ) -> Self {
        Self {
            runner,
            prompt_service: PromptService::new(project_root),
            session_service: SessionService::new(store),
            workflow,
        }
    }

    /// Execute a stage for a task (async with events).
    ///
    /// This starts the agent and returns immediately with a handle.
    /// The caller should poll the handle's event receiver for progress.
    pub fn execute_stage(
        &self,
        task: &Task,
        feedback: Option<&str>,
        integration_error: Option<IntegrationErrorContext<'_>>,
    ) -> Result<ExecutionHandle, ExecutionError> {
        let stage = task
            .current_stage()
            .ok_or_else(|| ExecutionError::ConfigError("Task not in active stage".into()))?;

        orkestra_debug!("exec", "execute_stage {}/{}: starting", task.id, stage);

        // 1. Build prompt
        let config = self.prompt_service.resolve_config(
            &self.workflow,
            task,
            feedback,
            integration_error,
        )?;

        orkestra_debug!(
            "exec",
            "execute_stage {}/{}: prompt_len={}",
            task.id,
            stage,
            config.prompt.len()
        );

        // 2. Create session FIRST (generates UUID if new session)
        self.session_service
            .on_spawn_starting(&task.id, stage)
            .map_err(|e| ExecutionError::SessionError(format!("Failed to create spawn session: {e}")))?;

        // 3. Get session context (session must exist now)
        let spawn_ctx = self
            .session_service
            .get_spawn_context(&task.id, stage)
            .map_err(|e| ExecutionError::SessionError(e.to_string()))?;

        // 4. Build run config with session info
        let working_dir = task
            .worktree_path
            .as_ref()
            .map(PathBuf::from)
            .unwrap_or_else(|| self.prompt_service.project_root().to_path_buf());

        orkestra_debug!(
            "exec",
            "execute_stage {}/{}: session_id={}, is_resume={}",
            task.id,
            stage,
            spawn_ctx.session_id,
            spawn_ctx.is_resume
        );

        let mut run_config = RunConfig::new(working_dir, config.prompt)
            .with_session(spawn_ctx.session_id, spawn_ctx.is_resume);

        if let Some(schema) = config.json_schema {
            run_config = run_config.with_schema(schema);
        }

        // 5. Run the agent
        match self.runner.run_async(run_config) {
            Ok((pid, events)) => {
                orkestra_debug!(
                    "exec",
                    "execute_stage {}/{}: spawned pid={}",
                    task.id,
                    stage,
                    pid
                );

                // 6a. Record successful spawn (non-fatal if fails - spawn already happened)
                if let Err(e) = self.session_service.on_agent_spawned(&task.id, stage, pid) {
                    workflow_warn!("Failed to record agent spawn for {}/{}: {}", task.id, stage, e);
                }

                Ok(ExecutionHandle {
                    task_id: task.id.clone(),
                    stage: stage.to_string(),
                    pid,
                    events,
                })
            }
            Err(e) => {
                orkestra_debug!(
                    "exec",
                    "execute_stage {}/{}: spawn failed: {}",
                    task.id,
                    stage,
                    e
                );

                // 6b. Record spawn failure in iteration (non-fatal - spawn already failed)
                if let Err(session_err) = self.session_service.on_spawn_failed(&task.id, stage, &e.to_string()) {
                    workflow_warn!("Failed to record spawn failure for {}/{}: {}", task.id, stage, session_err);
                }

                Err(e.into())
            }
        }
    }

    /// Execute a stage synchronously (blocking).
    ///
    /// This runs the agent to completion and returns the result.
    /// Useful for simpler orchestration or testing.
    pub fn execute_stage_sync(
        &self,
        task: &Task,
        feedback: Option<&str>,
        integration_error: Option<IntegrationErrorContext<'_>>,
    ) -> Result<StageOutput, ExecutionError> {
        let stage = task
            .current_stage()
            .ok_or_else(|| ExecutionError::ConfigError("Task not in active stage".into()))?;

        // Build prompt
        let config = self.prompt_service.resolve_config(
            &self.workflow,
            task,
            feedback,
            integration_error,
        )?;

        // Create session FIRST (generates UUID if new session)
        self.session_service
            .on_spawn_starting(&task.id, stage)
            .map_err(|e| ExecutionError::SessionError(format!("Failed to create spawn session: {e}")))?;

        // Get session context (session must exist now)
        let spawn_ctx = self
            .session_service
            .get_spawn_context(&task.id, stage)
            .map_err(|e| ExecutionError::SessionError(e.to_string()))?;

        // Build run config with session info
        let working_dir = task
            .worktree_path
            .as_ref()
            .map(PathBuf::from)
            .unwrap_or_else(|| self.prompt_service.project_root().to_path_buf());

        let mut run_config = RunConfig::new(working_dir, config.prompt)
            .with_session(spawn_ctx.session_id, spawn_ctx.is_resume);

        if let Some(schema) = config.json_schema {
            run_config = run_config.with_schema(schema);
        }

        // Run synchronously
        let result = match self.runner.run_sync(run_config) {
            Ok(result) => {
                // Record successful spawn (non-fatal - spawn already happened)
                if let Err(e) = self.session_service.on_agent_spawned(&task.id, stage, 0) {
                    // Note: sync execution doesn't have real PID, using 0 as placeholder
                    workflow_warn!("Failed to record agent spawn for {}/{}: {}", task.id, stage, e);
                }
                result
            }
            Err(e) => {
                // Record spawn/execution failure (non-fatal - spawn already failed)
                if let Err(session_err) = self.session_service.on_spawn_failed(&task.id, stage, &e.to_string()) {
                    workflow_warn!("Failed to record spawn failure for {}/{}: {}", task.id, stage, session_err);
                }
                return Err(e.into());
            }
        };

        // Record agent exited (cleanup)
        if let Err(e) = self.session_service.on_agent_exited(&task.id, stage) {
            workflow_warn!("Failed to record agent exit for {}/{}: {}", task.id, stage, e);
        }

        Ok(result.parsed_output)
    }

    /// Handle an event from an async execution.
    ///
    /// Returns the parsed output when the agent completes successfully.
    pub fn handle_event(
        &self,
        task_id: &str,
        stage: &str,
        event: RunEvent,
    ) -> WorkflowResult<Option<StageOutput>> {
        match event {
            RunEvent::Completed(result) => {
                orkestra_debug!(
                    "exec",
                    "handle_event {}/{}: completed, is_ok={}",
                    task_id,
                    stage,
                    result.is_ok()
                );

                // Record agent exited (cleanup, non-critical)
                if let Err(e) = self.session_service.on_agent_exited(task_id, stage) {
                    workflow_warn!("Failed to record agent exit for {}/{}: {}", task_id, stage, e);
                }

                // Return parsed output
                match result {
                    Ok(output) => Ok(Some(output)),
                    Err(e) => {
                        workflow_error!("Parse error for {}/{}: {}", task_id, stage, e);
                        Ok(None)
                    }
                }
            }
        }
    }

    /// Mark a stage session as completed.
    ///
    /// Called when the stage is approved and we're moving to the next stage.
    pub fn complete_stage(&self, task_id: &str, stage: &str) -> WorkflowResult<()> {
        self.session_service.on_stage_completed(task_id, stage)
    }

    /// Mark a stage session as abandoned.
    ///
    /// Called when the task fails, is blocked, or the stage is restaged.
    pub fn abandon_stage(&self, task_id: &str, stage: &str) -> WorkflowResult<()> {
        self.session_service.on_stage_abandoned(task_id, stage)
    }

    /// Get all running agent processes.
    ///
    /// Returns (task_id, stage, pid) tuples for orphan cleanup.
    pub fn get_running_agents(&self) -> WorkflowResult<Vec<(String, String, u32)>> {
        self.session_service.get_running_agents()
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::workflow::adapters::InMemoryWorkflowStore;
    use crate::workflow::config::StageConfig;

    fn test_workflow() -> WorkflowConfig {
        WorkflowConfig::new(vec![
            StageConfig::new("planning", "plan"),
            StageConfig::new("work", "summary").with_inputs(vec!["plan".into()]),
        ])
    }

    // Note: Full integration tests would require mocking the ProcessSpawner
    // These tests verify the basic structure and error handling

    #[test]
    fn test_execution_error_display() {
        let err = ExecutionError::ConfigError("test".into());
        assert!(err.to_string().contains("Config"));

        let err = ExecutionError::SessionError("test".into());
        assert!(err.to_string().contains("Session"));

        let err = ExecutionError::RunError("test".into());
        assert!(err.to_string().contains("Run"));
    }

    #[test]
    fn test_session_id_generated_upfront() {
        let _workflow = test_workflow();
        let store = Arc::new(InMemoryWorkflowStore::new());

        // Create session service directly for testing
        let session_service = SessionService::new(store.clone());

        // Start an agent - session ID is generated upfront
        session_service.on_spawn_starting("task-1", "planning").unwrap();
        session_service.on_agent_spawned("task-1", "planning", 12345).unwrap();

        // Session ID should be available immediately (generated in on_spawn_starting)
        let ctx = session_service.get_spawn_context("task-1", "planning").unwrap();
        assert!(!ctx.session_id.is_empty(), "Session ID should be generated upfront");
        assert!(!ctx.is_resume, "First spawn should not be a resume");

        // Simulate agent finishing and spawning again
        session_service.on_agent_exited("task-1", "planning").unwrap();

        // Get context again - should now be a resume
        let ctx2 = session_service.get_spawn_context("task-1", "planning").unwrap();
        assert_eq!(ctx2.session_id, ctx.session_id, "Session ID should remain the same");
        assert!(ctx2.is_resume, "Second spawn should be a resume");
    }
}
