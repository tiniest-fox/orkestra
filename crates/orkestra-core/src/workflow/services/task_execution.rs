//! Task execution service.
//!
//! This service coordinates stage execution for tasks. It ties together:
//! - PromptService: for building agent prompts
//! - SessionService: for session continuity across resumes
//! - AgentRunner: for running the actual agent
//! - CrashRecoveryStore: for persisting output before parsing
//!
//! The orchestrator delegates to this service for all agent execution.

use std::path::PathBuf;
use std::sync::mpsc::Receiver;
use std::sync::Arc;

use crate::workflow::config::WorkflowConfig;
use crate::workflow::domain::Task;
use crate::workflow::execution::{
    AgentConfigError, AgentRunnerTrait, IntegrationErrorContext, RunConfig, RunError, RunEvent,
    StageOutput,
};
use crate::workflow::ports::{CrashRecoveryStore, WorkflowResult, WorkflowStore};

use super::prompt_service::PromptService;
use super::session_service::SessionService;

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
// Recovered Output
// ============================================================================

/// A recovered pending output from crash recovery.
#[derive(Debug)]
pub struct RecoveredOutput {
    /// Task ID.
    pub task_id: String,
    /// Stage name.
    pub stage: String,
    /// Parsed output (or parse error).
    pub result: Result<StageOutput, String>,
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
/// 4. Handles events (session ID, raw output, completion)
/// 5. Manages crash recovery
pub struct TaskExecutionService {
    /// Agent runner for executing Claude processes.
    runner: Arc<dyn AgentRunnerTrait>,
    /// Prompt building service.
    prompt_service: PromptService,
    /// Session management service.
    session_service: SessionService,
    /// Crash recovery store.
    crash_recovery: Arc<dyn CrashRecoveryStore>,
    /// Workflow configuration.
    workflow: WorkflowConfig,
}

impl TaskExecutionService {
    /// Create a new task execution service.
    pub fn new(
        runner: Arc<dyn AgentRunnerTrait>,
        store: Arc<dyn WorkflowStore>,
        crash_recovery: Arc<dyn CrashRecoveryStore>,
        workflow: WorkflowConfig,
        project_root: PathBuf,
    ) -> Self {
        Self {
            runner,
            prompt_service: PromptService::new(project_root),
            session_service: SessionService::new(store),
            crash_recovery,
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

        // 1. Build prompt
        let config = self.prompt_service.resolve_config(
            &self.workflow,
            task,
            feedback,
            integration_error,
        )?;

        // 2. Get session resume context
        let spawn_ctx = self
            .session_service
            .get_spawn_context(&task.id, stage)
            .map_err(|e| ExecutionError::SessionError(e.to_string()))?;

        // 3. Build run config
        let working_dir = task
            .worktree_path
            .as_ref()
            .map(PathBuf::from)
            .unwrap_or_else(|| self.prompt_service.project_root().to_path_buf());

        let mut run_config = RunConfig::new(working_dir, config.prompt);
        if let Some(schema) = config.json_schema {
            run_config = run_config.with_schema(schema);
        }
        if let Some(session_id) = spawn_ctx.resume_session_id {
            run_config = run_config.with_resume(session_id);
        }

        // 4. Run the agent
        let (pid, events) = self.runner.run_async(run_config)?;

        // 5. Record agent started
        let _ = self.session_service.on_agent_started(&task.id, stage, pid);

        Ok(ExecutionHandle {
            task_id: task.id.clone(),
            stage: stage.to_string(),
            pid,
            events,
        })
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

        // Get session context
        let spawn_ctx = self
            .session_service
            .get_spawn_context(&task.id, stage)
            .map_err(|e| ExecutionError::SessionError(e.to_string()))?;

        // Build run config
        let working_dir = task
            .worktree_path
            .as_ref()
            .map(PathBuf::from)
            .unwrap_or_else(|| self.prompt_service.project_root().to_path_buf());

        let mut run_config = RunConfig::new(working_dir, config.prompt);
        if let Some(schema) = config.json_schema {
            run_config = run_config.with_schema(schema);
        }
        if let Some(session_id) = spawn_ctx.resume_session_id {
            run_config = run_config.with_resume(session_id);
        }

        // Run synchronously
        let result = self
            .runner
            .run_sync(run_config)
            .map_err(ExecutionError::from)?;

        // Record session ID if captured
        if let Some(session_id) = &result.session_id {
            let _ = self.session_service.on_session_id(&task.id, stage, session_id);
        }

        // Persist raw output for crash recovery
        let _ = self.crash_recovery.persist(&task.id, stage, &result.raw_output);

        // Clear on success
        let _ = self.crash_recovery.clear(&task.id, stage);

        // Record agent exited
        let _ = self.session_service.on_agent_exited(&task.id, stage);

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
            RunEvent::SessionIdCaptured(session_id) => {
                self.session_service.on_session_id(task_id, stage, &session_id)?;
                Ok(None)
            }
            RunEvent::RawOutputReady(raw_output) => {
                let _ = self.crash_recovery.persist(task_id, stage, &raw_output);
                Ok(None)
            }
            RunEvent::Completed(result) => {
                // Clear crash recovery on success
                if result.is_ok() {
                    let _ = self.crash_recovery.clear(task_id, stage);
                }

                // Record agent exited
                self.session_service.on_agent_exited(task_id, stage)?;

                // Return parsed output
                match result {
                    Ok(output) => Ok(Some(output)),
                    Err(e) => {
                        eprintln!("[execution] Parse error for {task_id}/{stage}: {e}");
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

    /// Recover pending outputs from crash recovery.
    ///
    /// Returns parsed outputs for all pending files.
    pub fn recover_pending(&self) -> Vec<RecoveredOutput> {
        self.crash_recovery
            .list_pending()
            .into_iter()
            .filter_map(|(task_id, stage)| {
                let raw = self.crash_recovery.read(&task_id, &stage)?;
                let result = crate::workflow::execution::parse_agent_output(&raw);
                Some(RecoveredOutput {
                    task_id,
                    stage,
                    result,
                })
            })
            .collect()
    }

    /// Clear a pending output after processing.
    pub fn clear_pending(&self, task_id: &str, stage: &str) {
        let _ = self.crash_recovery.clear(task_id, stage);
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::workflow::adapters::InMemoryWorkflowStore;
    use crate::workflow::config::StageConfig;
    use crate::workflow::ports::InMemoryCrashRecoveryStore;

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
    fn test_recover_pending() {
        let _workflow = test_workflow();
        let _store = Arc::new(InMemoryWorkflowStore::new());
        let crash_recovery = Arc::new(InMemoryCrashRecoveryStore::new());

        // Pre-populate crash recovery with a pending output
        crash_recovery
            .persist("task-1", "planning", r#"{"type": "completed", "summary": "Done"}"#)
            .unwrap();

        // Create service - needs a mock runner, but recover_pending doesn't use it
        // For this test, we just verify the crash recovery integration
        let recovered = crash_recovery
            .list_pending()
            .into_iter()
            .filter_map(|(task_id, stage)| {
                let raw = crash_recovery.read(&task_id, &stage)?;
                let result = crate::workflow::execution::parse_agent_output(&raw);
                Some(RecoveredOutput {
                    task_id,
                    stage,
                    result,
                })
            })
            .collect::<Vec<_>>();

        assert_eq!(recovered.len(), 1);
        assert_eq!(recovered[0].task_id, "task-1");
        assert_eq!(recovered[0].stage, "planning");
        assert!(recovered[0].result.is_ok());
    }

    #[test]
    fn test_handle_event_session_id() {
        let _workflow = test_workflow();
        let store = Arc::new(InMemoryWorkflowStore::new());
        let _crash_recovery = Arc::new(InMemoryCrashRecoveryStore::new());

        // Create session service directly for testing
        let session_service = SessionService::new(store.clone());

        // Start an agent first
        session_service.on_agent_started("task-1", "planning", 12345).unwrap();

        // Handle session ID event
        session_service
            .on_session_id("task-1", "planning", "session-abc")
            .unwrap();

        // Verify session ID was recorded
        let ctx = session_service.get_spawn_context("task-1", "planning").unwrap();
        assert_eq!(ctx.resume_session_id, Some("session-abc".to_string()));
    }
}
