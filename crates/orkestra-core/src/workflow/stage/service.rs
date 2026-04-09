//! Unified stage execution service.
//!
//! This service handles execution of workflow stages, whether they're
//! agent-based (Claude Code) or script-based (shell commands). It provides
//! a unified interface for spawning, tracking, and polling executions.
//!
//! Internally, this service delegates to specialized services:
//! - `AgentExecutionService` for agent executions
//! - `ScriptExecutionService` for script executions

use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

use super::types::{deduplicate_activity_logs_by_stage, ActivityLogEntry};
use crate::workflow::config::WorkflowConfig;
use crate::workflow::domain::{IterationTrigger, LogEntry, Task};
use crate::workflow::execution::{AgentRunner, AgentRunnerTrait, ProviderRegistry, StageOutput};
use crate::workflow::ports::WorkflowStore;

use super::agents::{AgentExecutionService, ExecutionHandle};
use super::scripts::{ScriptExecutionService, ScriptPollResult};
use super::session::SessionSpawnContext;
use crate::workflow::iteration::IterationService;

// ============================================================================
// Execution Poll Result (internal)
// ============================================================================

/// Result of polling an agent execution for completion.
enum AgentPoll {
    /// Agent is still running (possibly with log entries collected this poll).
    Running(Vec<LogEntry>),
    /// Agent completed (possibly with log entries collected before completion).
    Completed(Result<StageOutput, String>, Vec<LogEntry>),
    /// Error polling.
    Error(String),
}

// ============================================================================
// Agent Execution Handle (internal)
// ============================================================================

/// How long an agent can run without producing any output before being killed.
/// Only applies if the agent has never produced a single event — once it shows
/// any sign of life, the timeout is disabled.
const AGENT_STARTUP_TIMEOUT: Duration = Duration::from_secs(5 * 60);

/// Internal wrapper for tracking an active agent execution.
struct ActiveAgent {
    handle: ExecutionHandle,
    /// Stage session ID for persisting log entries to the database.
    stage_session_id: String,
    /// Iteration ID for tagging log entries with their iteration.
    iteration_id: String,
    /// When the agent was spawned.
    spawned_at: Instant,
    /// Whether the agent has ever produced any output.
    has_activity: bool,
    /// Session ID extracted from the stream (for providers like `OpenCode` that
    /// generate their own session IDs). Set once, consumed by `take_extracted_session_id`.
    extracted_session_id: Option<String>,
}

impl ActiveAgent {
    fn new(handle: ExecutionHandle, stage_session_id: String, iteration_id: String) -> Self {
        Self {
            handle,
            stage_session_id,
            iteration_id,
            spawned_at: Instant::now(),
            has_activity: false,
            extracted_session_id: None,
        }
    }

    #[allow(dead_code)]
    fn task_id(&self) -> &str {
        &self.handle.task_id
    }

    fn stage(&self) -> &str {
        &self.handle.stage
    }

    /// Consume the extracted session ID, if any. Returns `Some` only once.
    fn take_extracted_session_id(&mut self) -> Option<String> {
        self.extracted_session_id.take()
    }

    fn poll(&mut self) -> AgentPoll {
        use crate::workflow::execution::RunEvent;

        let mut log_entries = Vec::new();

        loop {
            match self.handle.events.try_recv() {
                Ok(RunEvent::LogLine(entry)) => {
                    self.has_activity = true;
                    log_entries.push(entry);
                }
                Ok(RunEvent::SessionId(id)) => {
                    self.has_activity = true;
                    self.extracted_session_id = Some(id);
                }
                Ok(RunEvent::Completed(result)) => {
                    return AgentPoll::Completed(result, log_entries);
                }
                Err(std::sync::mpsc::TryRecvError::Empty) => {
                    if !self.has_activity && self.spawned_at.elapsed() > AGENT_STARTUP_TIMEOUT {
                        return AgentPoll::Error(format!(
                            "Agent produced no output after {}s",
                            AGENT_STARTUP_TIMEOUT.as_secs()
                        ));
                    }
                    return AgentPoll::Running(log_entries);
                }
                Err(std::sync::mpsc::TryRecvError::Disconnected) => {
                    return AgentPoll::Error(
                        "Agent event channel disconnected unexpectedly".to_string(),
                    );
                }
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
/// - `AgentExecutionService` for agent-based stages
/// - `ScriptExecutionService` for script-based stages
///
/// Session lifecycle is managed here via session interactions:
/// 1. Create session before spawn (`session::on_spawn_starting`)
/// 2. Record PID after spawn (`session::on_agent_spawned`)
/// 3. Handle completion/failure at stage transitions
pub struct StageExecutionService {
    /// Iteration service for creating iterations during spawn.
    iteration_service: Arc<IterationService>,
    /// Agent execution service (for spawning agents).
    agent_service: Arc<AgentExecutionService>,
    /// Script execution service (for spawning scripts).
    script_service: Arc<ScriptExecutionService>,
    /// Store for persisting log entries.
    store: Arc<dyn WorkflowStore>,
    /// Workflow config (for resolving stage model specs).
    workflow: WorkflowConfig,
    /// Provider registry (for checking provider capabilities).
    registry: Arc<ProviderRegistry>,
    /// Active agent executions keyed by task ID.
    /// (Script executions are tracked by `ScriptExecutionService`)
    active_agents: Mutex<HashMap<String, ActiveAgent>>,
}

impl StageExecutionService {
    /// Create a new stage execution service with a custom runner and registry.
    ///
    /// Use this constructor when you need to inject a mock runner for testing.
    #[allow(clippy::needless_pass_by_value)] // Arc clone is cheap, keeps API ergonomic
    pub fn with_runner(
        workflow: WorkflowConfig,
        project_root: PathBuf,
        store: Arc<dyn WorkflowStore>,
        iteration_service: Arc<IterationService>,
        runner: Arc<dyn AgentRunnerTrait>,
        registry: Arc<ProviderRegistry>,
    ) -> Self {
        // Agent service only handles execution - session lifecycle is managed here
        let agent_service = Arc::new(AgentExecutionService::new(
            runner,
            workflow.clone(),
            project_root.clone(),
            Arc::clone(&registry),
        ));

        let script_service = Arc::new(ScriptExecutionService::new(
            project_root,
            Arc::clone(&store),
        ));

        Self {
            iteration_service,
            agent_service,
            script_service,
            store,
            workflow,
            registry,
            active_agents: Mutex::new(HashMap::new()),
        }
    }

    /// Create a new stage execution service with the default provider registry.
    ///
    /// Registers both `ClaudeProcessSpawner` and `OpenCodeProcessSpawner` in the
    /// provider registry, enabling stages to use either provider via the `model`
    /// field in stage config.
    pub fn new(
        workflow: WorkflowConfig,
        project_root: PathBuf,
        store: Arc<dyn WorkflowStore>,
        iteration_service: Arc<IterationService>,
    ) -> Self {
        use crate::workflow::adapters::{ClaudeProcessSpawner, OpenCodeProcessSpawner};
        use crate::workflow::execution::{
            claudecode_aliases, claudecode_capabilities, opencode_aliases, opencode_capabilities,
            ProviderRegistry,
        };
        use crate::workflow::ports::ProcessSpawner;

        let mut registry = ProviderRegistry::new("claudecode");
        registry.register(
            "claudecode",
            Arc::new(ClaudeProcessSpawner::new()) as Arc<dyn ProcessSpawner>,
            claudecode_capabilities(),
            claudecode_aliases(),
        );
        registry.register(
            "opencode",
            Arc::new(OpenCodeProcessSpawner::new()) as Arc<dyn ProcessSpawner>,
            opencode_capabilities(),
            opencode_aliases(),
        );

        let registry = Arc::new(registry);
        let runner: Arc<dyn AgentRunnerTrait> = Arc::new(AgentRunner::new(Arc::clone(&registry)));

        Self::with_runner(
            workflow,
            project_root,
            store,
            iteration_service,
            runner,
            registry,
        )
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

    /// Get the set of task IDs with active executions (agents + scripts).
    pub fn active_task_ids(&self) -> std::collections::HashSet<String> {
        let mut ids: std::collections::HashSet<String> = self
            .active_agents
            .lock()
            .map(|agents| agents.keys().cloned().collect())
            .unwrap_or_default();
        ids.extend(self.script_service.active_script_task_ids());
        ids
    }

    /// Kill the active agent for a task and remove it from tracking.
    ///
    /// Returns the PID that was killed, or None if no active agent was found.
    /// This is used by the interrupt flow — kill the process first, then transition state.
    /// Scripts are intentionally excluded from this method.
    pub fn kill_active_agent(&self, task_id: &str) -> Option<u32> {
        // First check active agents
        let pid = self
            .active_agents
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner)
            .remove(task_id)
            .map(|agent| agent.handle.pid);

        if let Some(pid) = pid {
            if let Err(e) = orkestra_process::kill_process_tree(pid) {
                crate::orkestra_debug!("interrupt", "Failed to kill process tree {}: {}", pid, e);
            }
            return Some(pid);
        }

        // No agent found — could be already dead (race condition). That's fine.
        None
    }

    /// Block until all active executions (agents + gate scripts) complete, returning results.
    ///
    /// Used in test mode (`sync_background`) so gate scripts complete within
    /// a single orchestrator tick, making tests fully deterministic.
    pub fn drain_active(&self) -> Vec<ExecutionComplete> {
        let mut all_completed = Vec::new();
        loop {
            if self.active_count() == 0 {
                break;
            }
            std::thread::sleep(Duration::from_millis(10));
            all_completed.extend(self.poll_active());
        }
        all_completed
    }

    /// Spawn an execution for a task's current stage.
    ///
    /// This is the unified entry point for all stage executions. It:
    /// 1. Creates a session (unified for all stage types)
    /// 2. Gets spawn context (session ID, resume flag)
    /// 3. Delegates to agent or script execution
    /// 4. Records PID after successful spawn
    pub fn spawn(
        &self,
        task: &Task,
        trigger: Option<&IterationTrigger>,
    ) -> Result<SpawnResult, SpawnError> {
        let stage = task.current_stage().ok_or(SpawnError::NoActiveStage)?;

        // Determine if the provider generates its own session IDs.
        // If so, don't pre-generate a UUID — the ID will be extracted from the output stream.
        let model_spec = self
            .workflow
            .stage(&task.flow, stage)
            .and_then(|s| s.model.as_deref());
        let generates_own = self
            .registry
            .resolve(model_spec)
            .map(|r| r.capabilities.generates_own_session_id)
            .unwrap_or(false);

        // Closure to generate session ID based on provider capabilities
        let generate_session_id = || {
            if generates_own {
                None
            } else {
                Some(uuid::Uuid::new_v4().to_string())
            }
        };

        // 1. Pre-supersession: for "returning" triggers (Rejection, Integration) and untriggered
        //    re-entries, supersede the existing session BEFORE on_spawn_starting so it creates
        //    a new session automatically.
        if super::interactions::session::should_supersede::execute(
            self.store.as_ref(),
            trigger,
            &task.id,
            stage,
        )
        .map_err(|e| SpawnError::SessionError(e.to_string()))?
        {
            super::interactions::session::supersede_session::execute(
                self.store.as_ref(),
                &task.id,
                stage,
            )
            .map_err(|e| SpawnError::SessionError(e.to_string()))?;
        }

        // 2. Create session + get spawn context (session ID, resume flag)
        let spawn_context = super::interactions::session::on_spawn_starting::execute(
            self.store.as_ref(),
            &self.iteration_service,
            &task.id,
            stage,
            generate_session_id(),
        )
        .map_err(|e| SpawnError::SessionError(e.to_string()))?;

        // 3. Execute (all stages are agent stages)
        let result = self.spawn_agent(task, stage, trigger, &spawn_context);

        // 4. Record outcome
        match &result {
            Ok(spawn_result) => {
                // Record successful spawn with PID
                if let Err(e) = super::interactions::session::on_agent_spawned::execute(
                    self.store.as_ref(),
                    &task.id,
                    stage,
                    spawn_result.pid,
                ) {
                    // Non-fatal: spawn already happened, just log the error
                    crate::orkestra_debug!(
                        "stage_execution",
                        "Failed to record spawn for {}/{}: {}",
                        task.id,
                        stage,
                        e
                    );
                }

                // Mark trigger as delivered so crash recovery doesn't replay it
                if trigger.is_some() {
                    if let Err(e) = super::interactions::session::mark_trigger_delivered::execute(
                        self.store.as_ref(),
                        &task.id,
                        stage,
                    ) {
                        crate::orkestra_debug!(
                            "stage_execution",
                            "Failed to mark trigger delivered for {}/{}: {}",
                            task.id,
                            stage,
                            e
                        );
                    }
                }
            }
            Err(e) => {
                // Record spawn failure
                if let Err(session_err) = super::interactions::session::on_spawn_failed::execute(
                    self.store.as_ref(),
                    &task.id,
                    stage,
                    &e.to_string(),
                ) {
                    crate::orkestra_debug!(
                        "stage_execution",
                        "Failed to record spawn failure for {}/{}: {}",
                        task.id,
                        stage,
                        session_err
                    );
                }
            }
        }

        result
    }

    /// Spawn an agent execution.
    fn spawn_agent(
        &self,
        task: &Task,
        stage: &str,
        trigger: Option<&IterationTrigger>,
        spawn_context: &SessionSpawnContext,
    ) -> Result<SpawnResult, SpawnError> {
        // Query activity logs from completed iterations
        let mut iterations = self
            .store
            .get_iterations(&task.id)
            .map_err(|e| SpawnError::AgentError(format!("Failed to query iterations: {e}")))?;

        // Sort by started_at to ensure chronological order (get_iterations doesn't guarantee order)
        iterations.sort_by(|a, b| a.started_at.cmp(&b.started_at));

        let activity_logs: Vec<ActivityLogEntry> = iterations
            .iter()
            .filter(|i| i.ended_at.is_some() && i.activity_log.is_some())
            .map(|i| ActivityLogEntry {
                stage: i.stage.clone(),
                iteration_number: i.iteration_number,
                content: i.activity_log.clone().unwrap(),
            })
            .collect();

        // Deduplicate: keep only the most recent log per stage
        let activity_logs = deduplicate_activity_logs_by_stage(activity_logs);

        // Fetch sibling context for subtasks
        let sibling_tasks = if let Some(parent_id) = &task.parent_id {
            let siblings = self
                .store
                .list_subtasks(parent_id)
                .map_err(|e| SpawnError::AgentError(format!("Failed to query siblings: {e}")))?;
            super::interactions::compute_sibling_contexts::execute(task, siblings)
        } else {
            Vec::new()
        };

        // Load parent resources for subtask prompts so the inline resources list
        // includes resources registered by the parent task's stages.
        let parent_resources = match &task.parent_id {
            Some(pid) => self
                .store
                .get_task(pid)
                .map_err(|e| {
                    SpawnError::AgentError(format!("Failed to load parent task {pid}: {e}"))
                })?
                .map(|parent| parent.resources),
            None => None,
        };

        let handle = self
            .agent_service
            .execute_stage(
                task,
                trigger,
                spawn_context,
                &activity_logs,
                &sibling_tasks,
                parent_resources.as_ref(),
            )
            .map_err(|e| SpawnError::AgentError(e.to_string()))?;

        let pid = handle.pid;
        let stage_session_id = spawn_context.stage_session_id.clone();
        let agent = ActiveAgent::new(handle, stage_session_id, spawn_context.iteration_id.clone());

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

    /// Spawn a gate script for a task (delegates to `ScriptExecutionService`).
    ///
    /// Gate scripts validate an agent stage's output before the commit pipeline proceeds.
    /// Returns a `SpawnResult` the orchestrator uses to emit a `GateSpawned` event.
    pub fn spawn_gate(
        &self,
        task: &Task,
        stage: &str,
        gate_config: &crate::workflow::config::GateConfig,
        iteration_id: Option<&str>,
    ) -> Result<SpawnResult, SpawnError> {
        let pid = self
            .script_service
            .spawn_gate(task, stage, gate_config, iteration_id)
            .map_err(|e| SpawnError::ScriptError(e.to_string()))?;

        // Record gate PID in the session so cleanup functions (kill_running_agents,
        // cleanup_orphaned_agents, delete_task_with_cleanup) can find and kill it.
        if let Ok(Some(mut session)) = self.store.get_stage_session(&task.id, stage) {
            session.agent_pid = Some(pid);
            if let Err(e) = self.store.save_stage_session(&session) {
                crate::orkestra_debug!(
                    "stage_execution",
                    "Failed to record gate PID for {}/{}: {}",
                    task.id,
                    stage,
                    e
                );
            }
        }

        Ok(SpawnResult {
            task_id: task.id.clone(),
            stage: stage.to_string(),
            pid,
            is_script: true,
            command: Some(gate_config.command.clone()),
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

    /// Persist collected log entries to the database and agent log file.
    ///
    /// Non-fatal: if a write fails, logs the error and continues.
    fn persist_log_entries(
        &self,
        stage_session_id: &str,
        task_id: &str,
        stage: &str,
        entries: &[LogEntry],
        iteration_id: &str,
    ) {
        for entry in entries {
            // Persist to database
            if let Err(e) = self
                .store
                .append_log_entry(stage_session_id, entry, Some(iteration_id))
            {
                crate::orkestra_debug!(
                    "stage_execution",
                    "Failed to persist log entry for session {}: {}",
                    stage_session_id,
                    e
                );
            }

            // Write to agents.log file
            if let Ok(json) = serde_json::to_string(entry) {
                crate::orkestra_debug!(&format!("{task_id}/{stage}"), target: agents, "{json}");
            }
        }
    }

    /// Poll active agent executions.
    fn poll_agents(&self) -> Vec<ExecutionComplete> {
        let mut completed = Vec::new();
        let mut to_remove = Vec::new();
        // Collect (stage_session_id, task_id, stage, entries, iteration_id) outside the lock to write after releasing it.
        let mut log_batches: Vec<(String, String, String, Vec<LogEntry>, String)> = Vec::new();
        // Collect extracted session IDs to persist outside the lock.
        let mut session_id_updates: Vec<(String, String, String)> = Vec::new(); // (task_id, stage, session_id)

        if let Ok(mut agents) = self.active_agents.lock() {
            for (task_id, agent) in agents.iter_mut() {
                match agent.poll() {
                    AgentPoll::Running(log_entries) => {
                        if !log_entries.is_empty() {
                            log_batches.push((
                                agent.stage_session_id.clone(),
                                task_id.clone(),
                                agent.stage().to_string(),
                                log_entries,
                                agent.iteration_id.clone(),
                            ));
                        }
                    }
                    AgentPoll::Completed(result, log_entries) => {
                        if !log_entries.is_empty() {
                            log_batches.push((
                                agent.stage_session_id.clone(),
                                task_id.clone(),
                                agent.stage().to_string(),
                                log_entries,
                                agent.iteration_id.clone(),
                            ));
                        }
                        to_remove.push(task_id.clone());
                        let exec_result = match result {
                            Ok(output) => ExecutionResult::AgentSuccess(output),
                            Err(error) => ExecutionResult::AgentFailed(error),
                        };
                        completed.push(ExecutionComplete {
                            task_id: task_id.clone(),
                            stage: agent.stage().to_string(),
                            result: exec_result,
                        });
                    }
                    AgentPoll::Error(error) => {
                        to_remove.push(task_id.clone());
                        completed.push(ExecutionComplete {
                            task_id: task_id.clone(),
                            stage: agent.stage().to_string(),
                            result: ExecutionResult::PollError { error },
                        });
                    }
                }

                // Check for provider-generated session IDs (e.g. OpenCode's ses_...)
                if let Some(sid) = agent.take_extracted_session_id() {
                    session_id_updates.push((task_id.clone(), agent.stage().to_string(), sid));
                }
            }

            for task_id in to_remove {
                agents.remove(&task_id);
            }
        }

        // Persist log entries outside the agents lock to avoid holding it during I/O
        for (stage_session_id, task_id, stage, entries, iteration_id) in &log_batches {
            self.persist_log_entries(stage_session_id, task_id, stage, entries, iteration_id);
        }

        // Persist provider-generated session IDs (e.g. OpenCode's ses_...) so that
        // future resume attempts use the correct value.
        self.persist_extracted_session_ids(session_id_updates);

        completed
    }

    /// Save provider-generated session IDs (e.g. `ses_...` from `OpenCode`) to their stage sessions.
    fn persist_extracted_session_ids(&self, updates: Vec<(String, String, String)>) {
        for (task_id, stage, session_id) in updates {
            match self.store.get_stage_session(&task_id, &stage) {
                Ok(Some(mut session)) => {
                    session.claude_session_id = Some(session_id.clone());
                    if let Err(e) = self.store.save_stage_session(&session) {
                        crate::orkestra_debug!(
                            "stage_execution",
                            "Failed to save extracted session ID for {}/{}: {}",
                            task_id,
                            stage,
                            e
                        );
                    } else {
                        crate::orkestra_debug!(
                            "stage_execution",
                            "Saved extracted session ID for {}/{}: {}",
                            task_id,
                            stage,
                            session_id
                        );
                    }
                }
                Ok(None) => {
                    crate::orkestra_debug!(
                        "stage_execution",
                        "No stage session found for {}/{} to save extracted session ID",
                        task_id,
                        stage
                    );
                }
                Err(e) => {
                    crate::orkestra_debug!(
                        "stage_execution",
                        "Failed to load stage session for {}/{}: {}",
                        task_id,
                        stage,
                        e
                    );
                }
            }
        }
    }

    /// Poll active gate script executions (via `ScriptExecutionService`).
    fn poll_scripts(&self) -> Vec<ExecutionComplete> {
        self.script_service
            .poll_active_scripts()
            .into_iter()
            .filter_map(|poll_result| match poll_result {
                ScriptPollResult::Running => None,
                ScriptPollResult::Completed(completion) => {
                    let result = if completion.result.is_success() {
                        ExecutionResult::GateSuccess
                    } else {
                        ExecutionResult::GateFailed {
                            output: completion.result.output,
                            timed_out: completion.result.timed_out,
                        }
                    };
                    Some(ExecutionComplete {
                        task_id: completion.task_id,
                        stage: completion.stage,
                        result,
                    })
                }
                ScriptPollResult::Error {
                    task_id,
                    stage,
                    message,
                } => {
                    crate::orkestra_debug!("stage_execution", "Gate script poll error: {message}");
                    // Map OS-level poll errors to GateFailed (recoverable re-queue) rather than
                    // a terminal failure. This keeps the task in the normal gate failure path
                    // so the agent can retry, rather than permanently failing the task.
                    Some(ExecutionComplete {
                        task_id,
                        stage,
                        result: ExecutionResult::GateFailed {
                            output: message,
                            timed_out: false,
                        },
                    })
                }
            })
            .collect()
    }
}

// ============================================================================
// AgentKiller Implementation
// ============================================================================

impl crate::workflow::api::AgentKiller for StageExecutionService {
    fn kill_agent(&self, task_id: &str) -> Option<u32> {
        self.kill_active_agent(task_id)
    }

    fn kill_gate(&self, task_id: &str) -> Option<u32> {
        self.script_service.kill_gate(task_id)
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
    /// Error creating or managing session.
    SessionError(String),
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
            Self::SessionError(e) => write!(f, "Session error: {e}"),
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
}

/// Result of a completed execution.
pub enum ExecutionResult {
    /// Agent completed with structured output.
    AgentSuccess(StageOutput),
    /// Agent failed with error message.
    AgentFailed(String),
    /// Gate script passed.
    GateSuccess,
    /// Gate script failed.
    GateFailed {
        /// Output text from the gate (may contain error info).
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
