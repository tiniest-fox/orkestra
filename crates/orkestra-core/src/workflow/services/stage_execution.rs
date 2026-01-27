//! Unified stage execution service.
//!
//! This service handles execution of workflow stages, whether they're
//! agent-based (Claude Code) or script-based (shell commands). It provides
//! a unified interface for spawning, tracking, and polling executions.
//!
//! Internally, this service delegates to specialized services:
//! - `TaskExecutionService` for agent executions
//! - `ScriptExecutionService` for script executions

use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::{Arc, Mutex};

use crate::workflow::config::WorkflowConfig;
use crate::workflow::domain::{IterationTrigger, Task};
use crate::workflow::execution::{AgentRunner, AgentRunnerTrait, StageOutput};
use crate::workflow::ports::WorkflowStore;

use super::script_execution::{ScriptExecutionService, ScriptPollResult};
use super::task_execution::{ExecutionHandle, TaskExecutionService};
use super::IterationService;

// ============================================================================
// Execution Poll Result (internal)
// ============================================================================

/// Result of polling an agent execution for completion.
enum AgentPoll {
    /// Agent is still running.
    Running,
    /// Agent completed.
    Completed(Result<StageOutput, String>),
    /// Error polling.
    Error(String),
}

// ============================================================================
// Agent Execution Handle (internal)
// ============================================================================

/// Internal wrapper for tracking an active agent execution.
struct ActiveAgent {
    handle: ExecutionHandle,
}

impl ActiveAgent {
    fn new(handle: ExecutionHandle) -> Self {
        Self { handle }
    }

    #[allow(dead_code)]
    fn task_id(&self) -> &str {
        &self.handle.task_id
    }

    fn stage(&self) -> &str {
        &self.handle.stage
    }

    fn poll(&mut self) -> AgentPoll {
        use crate::workflow::execution::RunEvent;

        match self.handle.events.try_recv() {
            Ok(RunEvent::Completed(result)) => AgentPoll::Completed(result),
            Err(std::sync::mpsc::TryRecvError::Empty) => AgentPoll::Running,
            Err(std::sync::mpsc::TryRecvError::Disconnected) => {
                AgentPoll::Error("Agent event channel disconnected unexpectedly".to_string())
            }
        }
    }
}

// ============================================================================
// Stage Execution Service
// ============================================================================

/// Unified service for executing workflow stages.
///
/// This service orchestrates both agent and script executions through a common
/// interface, delegating to specialized services internally:
/// - `TaskExecutionService` for agent-based stages
/// - `ScriptExecutionService` for script-based stages
pub struct StageExecutionService {
    /// Agent execution service (for spawning agents).
    agent_service: Arc<TaskExecutionService>,
    /// Script execution service (for spawning scripts).
    script_service: Arc<ScriptExecutionService>,
    /// Active agent executions keyed by task ID.
    /// (Script executions are tracked by `ScriptExecutionService`)
    active_agents: Mutex<HashMap<String, ActiveAgent>>,
}

impl StageExecutionService {
    /// Create a new stage execution service with a custom runner.
    ///
    /// Use this constructor when you need to inject a mock runner for testing.
    #[allow(clippy::needless_pass_by_value)] // Arc clone is cheap, keeps API ergonomic
    pub fn with_runner(
        workflow: WorkflowConfig,
        project_root: PathBuf,
        store: Arc<dyn WorkflowStore>,
        iteration_service: Arc<IterationService>,
        runner: Arc<dyn AgentRunnerTrait>,
    ) -> Self {
        let agent_service = Arc::new(TaskExecutionService::new(
            runner,
            Arc::clone(&store),
            iteration_service,
            workflow.clone(),
            project_root.clone(),
        ));

        let script_service = Arc::new(ScriptExecutionService::new(workflow, project_root));

        Self {
            agent_service,
            script_service,
            active_agents: Mutex::new(HashMap::new()),
        }
    }

    /// Create a new stage execution service with the default Claude runner.
    pub fn new(
        workflow: WorkflowConfig,
        project_root: PathBuf,
        store: Arc<dyn WorkflowStore>,
        iteration_service: Arc<IterationService>,
    ) -> Self {
        use crate::workflow::adapters::ClaudeProcessSpawner;
        use crate::workflow::ports::ProcessSpawner;

        let spawner: Arc<dyn ProcessSpawner> = Arc::new(ClaudeProcessSpawner::new());
        let runner: Arc<dyn AgentRunnerTrait> = Arc::new(AgentRunner::new(spawner));

        Self::with_runner(workflow, project_root, store, iteration_service, runner)
    }

    /// Check if a stage is a script stage (vs agent stage).
    pub fn is_script_stage(&self, stage: &str) -> bool {
        self.script_service.is_script_stage(stage)
    }

    /// Check if a task has an active execution (agent or script).
    pub fn has_active_execution(&self, task_id: &str) -> bool {
        let has_agent = self
            .active_agents
            .lock()
            .map(|agents| agents.contains_key(task_id))
            .unwrap_or(false);

        has_agent || self.script_service.has_active_script(task_id)
    }

    /// Get count of active executions (agents + scripts).
    pub fn active_count(&self) -> usize {
        let agent_count = self.active_agents.lock().map(|a| a.len()).unwrap_or(0);
        agent_count + self.script_service.active_count()
    }

    /// Spawn an execution for a task's current stage.
    ///
    /// Automatically determines whether to spawn an agent or script based
    /// on the stage configuration.
    pub fn spawn(
        &self,
        task: &Task,
        trigger: Option<&IterationTrigger>,
    ) -> Result<SpawnResult, SpawnError> {
        let stage = task.current_stage().ok_or(SpawnError::NoActiveStage)?;

        if self.is_script_stage(stage) {
            self.spawn_script(task, stage)
        } else {
            self.spawn_agent(task, stage, trigger)
        }
    }

    /// Spawn an agent execution.
    fn spawn_agent(
        &self,
        task: &Task,
        stage: &str,
        trigger: Option<&IterationTrigger>,
    ) -> Result<SpawnResult, SpawnError> {
        let handle = self
            .agent_service
            .execute_stage(task, trigger)
            .map_err(|e| SpawnError::AgentError(e.to_string()))?;

        let pid = handle.pid;
        let agent = ActiveAgent::new(handle);

        self.active_agents
            .lock()
            .map_err(|_| SpawnError::LockError)?
            .insert(task.id.clone(), agent);

        Ok(SpawnResult {
            task_id: task.id.clone(),
            stage: stage.to_string(),
            pid,
            is_script: false,
            command: None,
        })
    }

    /// Spawn a script execution (delegates to `ScriptExecutionService`).
    fn spawn_script(&self, task: &Task, stage: &str) -> Result<SpawnResult, SpawnError> {
        let command = self
            .script_service
            .get_script_config(stage)
            .map(|c| c.command.clone());

        let pid = self
            .script_service
            .spawn_script(task, stage)
            .map_err(|e| SpawnError::ScriptError(e.to_string()))?;

        Ok(SpawnResult {
            task_id: task.id.clone(),
            stage: stage.to_string(),
            pid,
            is_script: true,
            command,
        })
    }

    /// Poll all active executions and return completed ones.
    pub fn poll_active(&self) -> Vec<ExecutionComplete> {
        let mut completed = Vec::new();

        // Poll agent executions
        completed.extend(self.poll_agents());

        // Poll script executions (delegate to ScriptExecutionService)
        completed.extend(self.poll_scripts());

        completed
    }

    /// Poll active agent executions.
    fn poll_agents(&self) -> Vec<ExecutionComplete> {
        let mut completed = Vec::new();
        let mut to_remove = Vec::new();

        if let Ok(mut agents) = self.active_agents.lock() {
            for (task_id, agent) in agents.iter_mut() {
                match agent.poll() {
                    AgentPoll::Running => {
                        // Still running
                    }
                    AgentPoll::Completed(result) => {
                        to_remove.push(task_id.clone());
                        let exec_result = match result {
                            Ok(output) => ExecutionResult::AgentSuccess(output),
                            Err(error) => ExecutionResult::AgentFailed(error),
                        };
                        completed.push(ExecutionComplete {
                            task_id: task_id.clone(),
                            stage: agent.stage().to_string(),
                            result: exec_result,
                            recovery_stage: None, // Agents use workflow config for recovery
                        });
                    }
                    AgentPoll::Error(error) => {
                        to_remove.push(task_id.clone());
                        completed.push(ExecutionComplete {
                            task_id: task_id.clone(),
                            stage: agent.stage().to_string(),
                            result: ExecutionResult::PollError { error },
                            recovery_stage: None,
                        });
                    }
                }
            }

            for task_id in to_remove {
                agents.remove(&task_id);
            }
        }

        completed
    }

    /// Poll active script executions (via `ScriptExecutionService`).
    fn poll_scripts(&self) -> Vec<ExecutionComplete> {
        self.script_service
            .poll_active_scripts()
            .into_iter()
            .filter_map(|poll_result| match poll_result {
                ScriptPollResult::Running => None,
                ScriptPollResult::Completed(completion) => {
                    let result = if completion.result.is_success() {
                        ExecutionResult::ScriptSuccess {
                            output: completion.result.output,
                        }
                    } else {
                        ExecutionResult::ScriptFailed {
                            output: completion.result.output,
                            timed_out: completion.result.timed_out,
                        }
                    };
                    Some(ExecutionComplete {
                        task_id: completion.task_id,
                        stage: completion.stage,
                        result,
                        recovery_stage: completion.recovery_stage,
                    })
                }
                ScriptPollResult::Error(error) => {
                    // Script poll errors don't have task context
                    // Log and skip for now
                    eprintln!("[stage_execution] Script poll error: {error}");
                    None
                }
            })
            .collect()
    }
}

// ============================================================================
// Supporting Types
// ============================================================================

/// Result of spawning an execution.
#[derive(Debug)]
pub struct SpawnResult {
    /// Task ID.
    pub task_id: String,
    /// Stage name.
    pub stage: String,
    /// Process ID.
    pub pid: u32,
    /// Whether this is a script (vs agent).
    pub is_script: bool,
    /// Command (for scripts only).
    pub command: Option<String>,
}

/// Error spawning an execution.
#[derive(Debug)]
pub enum SpawnError {
    /// Task has no active stage.
    NoActiveStage,
    /// Stage not found in workflow config.
    StageNotFound(String),
    /// Stage is not a script stage.
    NotAScriptStage(String),
    /// Error spawning agent.
    AgentError(String),
    /// Error spawning script.
    ScriptError(String),
    /// Lock error.
    LockError,
}

impl std::fmt::Display for SpawnError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::NoActiveStage => write!(f, "Task has no active stage"),
            Self::StageNotFound(s) => write!(f, "Stage not found: {s}"),
            Self::NotAScriptStage(s) => write!(f, "Stage is not a script stage: {s}"),
            Self::AgentError(e) => write!(f, "Agent spawn error: {e}"),
            Self::ScriptError(e) => write!(f, "Script spawn error: {e}"),
            Self::LockError => write!(f, "Lock error"),
        }
    }
}

impl std::error::Error for SpawnError {}

/// A completed execution.
pub struct ExecutionComplete {
    /// Task ID.
    pub task_id: String,
    /// Stage name.
    pub stage: String,
    /// The result.
    pub result: ExecutionResult,
    /// Recovery stage (for scripts with `on_failure` configured).
    pub recovery_stage: Option<String>,
}

/// Result of a completed execution.
pub enum ExecutionResult {
    /// Agent completed with structured output.
    AgentSuccess(StageOutput),
    /// Agent failed with error message.
    AgentFailed(String),
    /// Script completed successfully.
    ScriptSuccess {
        /// Output text.
        output: String,
    },
    /// Script failed.
    ScriptFailed {
        /// Output text (may contain error info).
        output: String,
        /// Whether this was a timeout.
        timed_out: bool,
    },
    /// Error polling the execution.
    PollError {
        /// Error message.
        error: String,
    },
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_spawn_error_display() {
        assert_eq!(
            SpawnError::NoActiveStage.to_string(),
            "Task has no active stage"
        );
        assert_eq!(
            SpawnError::StageNotFound("foo".into()).to_string(),
            "Stage not found: foo"
        );
    }
}
