//! Stage-agnostic orchestrator loop.
//!
//! The orchestrator is a reconciliation loop that:
//! 1. Polls for tasks needing execution
//! 2. Spawns executions (agents or scripts) via `StageExecutionService`
//! 3. Processes output when executions complete
//!
//! It is driven by the workflow configuration and is stage-agnostic -
//! it doesn't know about specific stages like "planning" or "work".

use std::collections::{HashMap, HashSet};
use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::time::Duration;

use super::periodic::PeriodicScheduler;

use crate::orkestra_debug;
use crate::workflow::config::WorkflowConfig;
use crate::workflow::execution::StageOutput;
use crate::workflow::ports::{GitService, WorkflowError, WorkflowResult, WorkflowStore};
use crate::workflow::runtime::Phase;

use super::integration::{perform_git_integration, IntegrationParams};
use super::stage_execution::{ExecutionComplete, ExecutionResult, StageExecutionService};
use super::WorkflowApi;

// ============================================================================
// Orchestrator Events
// ============================================================================

/// Events emitted by the orchestrator loop.
#[derive(Debug, Clone)]
pub enum OrchestratorEvent {
    /// Agent was spawned for a task.
    AgentSpawned {
        task_id: String,
        stage: String,
        pid: u32,
    },
    /// Agent completed and output was processed.
    OutputProcessed {
        task_id: String,
        stage: String,
        output_type: String,
    },
    /// Error occurred during orchestration.
    Error {
        task_id: Option<String>,
        error: String,
    },
    /// Integration (merge to primary) started for a task.
    IntegrationStarted { task_id: String, branch: String },
    /// Integration completed successfully.
    IntegrationCompleted { task_id: String },
    /// Parent task advanced because all subtasks completed.
    ParentAdvanced {
        task_id: String,
        subtask_count: usize,
    },
    /// Integration failed (e.g., merge conflict).
    IntegrationFailed {
        task_id: String,
        error: String,
        conflict_files: Vec<String>,
    },
    /// Script was spawned for a task.
    ScriptSpawned {
        task_id: String,
        stage: String,
        command: String,
        pid: u32,
    },
    /// Script completed successfully.
    ScriptCompleted { task_id: String, stage: String },
    /// Script failed.
    ScriptFailed {
        task_id: String,
        stage: String,
        error: String,
        recovery_stage: Option<String>,
    },
}

// ============================================================================
// Orchestrator Error
// ============================================================================

/// Errors specific to the orchestrator.
#[derive(Debug, Clone)]
pub enum OrchestratorError {
    LockPoisoned,
    WorkflowError(String),
    ConfigError(String),
    SpawnError(String),
}

impl std::fmt::Display for OrchestratorError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::LockPoisoned => write!(f, "Lock poisoned"),
            Self::WorkflowError(msg) => write!(f, "Workflow error: {msg}"),
            Self::ConfigError(msg) => write!(f, "Config error: {msg}"),
            Self::SpawnError(msg) => write!(f, "Spawn error: {msg}"),
        }
    }
}

impl std::error::Error for OrchestratorError {}

// ============================================================================
// Orchestrator Loop
// ============================================================================

/// The main orchestration loop.
///
/// This orchestrator delegates all execution to `StageExecutionService`,
/// which handles both agent and script stages uniformly.
///
/// It handles scheduling and event routing.
pub struct OrchestratorLoop {
    api: Arc<Mutex<WorkflowApi>>,
    /// Unified stage execution service.
    stage_executor: Arc<StageExecutionService>,
    /// Git service for background integration threads (avoids holding API lock during git ops).
    git_service: Option<Arc<dyn GitService>>,
    /// Periodic scheduler for tick phases.
    scheduler: Mutex<PeriodicScheduler>,
    stop_flag: Arc<AtomicBool>,
    /// When true, operations that would normally run on background threads
    /// (e.g., git integration) run synchronously on the tick thread instead.
    /// Used by tests for deterministic control over execution order.
    sync_background: bool,
}

impl OrchestratorLoop {
    /// Create a new orchestrator loop.
    pub fn new(api: Arc<Mutex<WorkflowApi>>, stage_executor: Arc<StageExecutionService>) -> Self {
        let git_service = api.lock().ok().and_then(|a| a.git_service().cloned());

        let mut scheduler = PeriodicScheduler::new();

        // Core orchestration — runs every tick
        scheduler.register("setup_awaiting_tasks", Duration::ZERO);
        scheduler.register("check_parent_completions", Duration::ZERO);
        scheduler.register("process_completed_executions", Duration::ZERO);
        scheduler.register("start_new_executions", Duration::ZERO);
        scheduler.register("start_integrations", Duration::ZERO);

        // Maintenance — runs periodically
        scheduler.register("cleanup_worktrees", Duration::from_secs(60));

        Self {
            api,
            stage_executor,
            git_service,
            scheduler: Mutex::new(scheduler),
            stop_flag: Arc::new(AtomicBool::new(false)),
            sync_background: false,
        }
    }

    /// Run background operations synchronously on the tick thread.
    ///
    /// When enabled, operations like git integration that would normally run on
    /// background threads run inline instead. This gives tests deterministic
    /// control: each tick completes all its work before returning.
    pub fn set_sync_background(&mut self, sync: bool) {
        self.sync_background = sync;
    }

    /// Create with default components for a project.
    ///
    /// # Panics
    ///
    /// Panics if the API mutex is poisoned.
    pub fn for_project(
        api: Arc<Mutex<WorkflowApi>>,
        workflow: WorkflowConfig,
        project_root: PathBuf,
        store: Arc<dyn WorkflowStore>,
    ) -> Self {
        // Get iteration service from api to share with executor
        let iteration_service = api.lock().unwrap().iteration_service().clone();

        let stage_executor = Arc::new(StageExecutionService::new(
            workflow,
            project_root,
            store,
            iteration_service,
        ));

        Self::new(api, stage_executor)
    }

    /// Create with a custom stage executor (for testing).
    pub fn with_executor(
        api: Arc<Mutex<WorkflowApi>>,
        stage_executor: Arc<StageExecutionService>,
    ) -> Self {
        Self::new(api, stage_executor)
    }

    /// Get the stop flag for external control.
    pub fn stop_flag(&self) -> Arc<AtomicBool> {
        self.stop_flag.clone()
    }

    /// Signal the loop to stop.
    pub fn stop(&self) {
        self.stop_flag.store(true, Ordering::Relaxed);
    }

    /// Run all startup recovery steps (stale tasks, orphaned worktrees, stuck integrations).
    ///
    /// Called automatically at the start of `run()`, but also available for testing
    /// recovery behavior without starting the full orchestration loop.
    pub fn run_startup_recovery(&self) -> Vec<OrchestratorEvent> {
        // Recover stale setup tasks on startup (tasks stuck in SettingUp phase)
        self.recover_stale_setup_tasks();

        // Recover stale agent working tasks on startup (tasks stuck in AgentWorking phase)
        self.recover_stale_agent_working_tasks();

        // Clean up orphaned worktrees (from deleted tasks where git cleanup was deferred)
        self.cleanup_orphaned_worktrees();

        // Recover stale integrations on startup (tasks stuck in Integrating phase)
        self.recover_stale_integrations()
    }

    /// Run the orchestration loop.
    ///
    /// This blocks the current thread and runs until `stop()` is called.
    pub fn run<F>(&self, mut on_event: F)
    where
        F: FnMut(OrchestratorEvent) + Send,
    {
        for event in self.run_startup_recovery() {
            on_event(event);
        }

        while !self.stop_flag.load(Ordering::Relaxed) {
            match self.tick() {
                Ok(events) => {
                    for event in events {
                        on_event(event);
                    }
                }
                Err(e) => {
                    on_event(OrchestratorEvent::Error {
                        task_id: None,
                        error: e.to_string(),
                    });
                }
            }

            std::thread::sleep(Duration::from_millis(500));
        }
    }

    /// Run a single tick of the orchestration loop.
    ///
    /// Dispatches to phase methods based on which scheduled tasks are due.
    /// Registration order in the constructor defines execution order.
    pub fn tick(&self) -> WorkflowResult<Vec<OrchestratorEvent>> {
        let due = {
            let mut scheduler = self.scheduler.lock().map_err(|_| WorkflowError::Lock)?;
            scheduler.poll_due()
        };

        let mut events = Vec::new();

        // Track tasks that were just set up this tick, so start_new_executions
        // doesn't immediately spawn agents for them. This matters when setup
        // runs synchronously (sync_background mode) — the task transitions from
        // SettingUp to Idle within the same tick.
        let mut just_set_up = HashSet::new();

        for name in due {
            match name {
                "setup_awaiting_tasks" => {
                    just_set_up = self.setup_awaiting_tasks()?;
                }
                "check_parent_completions" => events.extend(self.check_parent_completions()?),
                "process_completed_executions" => {
                    events.extend(self.process_completed_executions()?);
                }
                "start_new_executions" => {
                    events.extend(self.start_new_executions(&just_set_up)?);
                }
                "start_integrations" => events.extend(self.start_integrations()?),
                "cleanup_worktrees" => self.cleanup_orphaned_worktrees(),
                _ => orkestra_debug!("orchestrator", "Unknown scheduled task: {name}"),
            }
        }

        // In sync mode, drain any active executions (scripts) so they complete
        // within this tick. Mock agents already complete synchronously; this
        // handles real script processes used in tests.
        if self.sync_background {
            for exec in self.stage_executor.drain_active() {
                events.push(self.handle_execution_complete(exec)?);
            }
        }

        Ok(events)
    }

    /// Set up tasks in `AwaitingSetup` phase whose dependencies are satisfied.
    ///
    /// Handles both parent tasks and subtasks. For subtasks, setup is deferred
    /// from creation time to allow dependent subtasks to branch from the parent
    /// after predecessors' changes have been merged back. This ensures subtask B
    /// (which depends on A) sees A's code in its worktree.
    ///
    /// Parent tasks (no dependencies) and subtasks with no dependencies are set up
    /// on the first tick after creation.
    ///
    /// Returns the set of task IDs that were set up during this call.
    /// Used by `tick()` to prevent `start_new_executions` from immediately
    /// spawning agents for tasks that just completed synchronous setup.
    fn setup_awaiting_tasks(&self) -> WorkflowResult<HashSet<String>> {
        let api = self.api.lock().map_err(|_| WorkflowError::Lock)?;
        let all_tasks = api.store.list_tasks()?;

        // Build set of fully integrated task IDs for dependency checking.
        // Only Archived (integrated) tasks satisfy dependencies — not Done tasks
        // that are still awaiting integration. This ensures dependent subtasks
        // branch from the parent after predecessors' changes have been merged back.
        let integrated_ids: HashSet<String> = all_tasks
            .iter()
            .filter(|t| t.is_archived())
            .map(|t| t.id.clone())
            .collect();

        let mut just_set_up = HashSet::new();

        for task in &all_tasks {
            // Only tasks in AwaitingSetup phase
            if task.phase != Phase::AwaitingSetup {
                continue;
            }

            // For subtasks: check all dependencies are satisfied (fully integrated)
            if task.parent_id.is_some()
                && !task
                    .depends_on
                    .iter()
                    .all(|dep| integrated_ids.contains(dep))
            {
                continue;
            }

            orkestra_debug!(
                "orchestrator",
                "Setting up task {} (deps satisfied)",
                task.id
            );

            // Transition to SettingUp BEFORE spawning (prevents double-spawn)
            let mut task = task.clone();
            task.phase = Phase::SettingUp;
            api.store.save_task(&task)?;

            just_set_up.insert(task.id.clone());

            // Spawn setup (handles worktree creation and title generation)
            let needs_title = task.title.trim().is_empty() && !task.description.trim().is_empty();
            api.setup_service.spawn_setup(
                task.id.clone(),
                task.base_branch.clone(),
                if needs_title {
                    Some(task.description.clone())
                } else {
                    None
                },
            );
        }

        Ok(just_set_up)
    }

    /// Check if any `WaitingOnChildren` parents can advance because all subtasks are merged.
    fn check_parent_completions(&self) -> WorkflowResult<Vec<OrchestratorEvent>> {
        let mut events = Vec::new();
        let api = self.api.lock().map_err(|_| WorkflowError::Lock)?;

        let advanced = api.advance_completed_parents()?;
        for (task_id, subtask_count) in advanced {
            orkestra_debug!(
                "orchestrator",
                "Parent {} advanced: all {} subtasks done",
                task_id,
                subtask_count
            );
            events.push(OrchestratorEvent::ParentAdvanced {
                task_id,
                subtask_count,
            });
        }

        Ok(events)
    }

    /// Process completed executions (both agents and scripts) via the unified service.
    fn process_completed_executions(&self) -> WorkflowResult<Vec<OrchestratorEvent>> {
        let mut events = Vec::new();
        let completed = self.stage_executor.poll_active();

        for exec in completed {
            let event = self.handle_execution_complete(exec)?;
            events.push(event);
        }

        Ok(events)
    }

    /// Handle a completed execution.
    fn handle_execution_complete(
        &self,
        exec: ExecutionComplete,
    ) -> WorkflowResult<OrchestratorEvent> {
        let api = self.api.lock().map_err(|_| WorkflowError::Lock)?;

        match exec.result {
            ExecutionResult::AgentSuccess(stage_output) => {
                let output_type = output_type_string(&stage_output);
                orkestra_debug!(
                    "orchestrator",
                    "process_agent_output {}/{}: type={}",
                    exec.task_id,
                    exec.stage,
                    output_type
                );
                match api.process_agent_output(&exec.task_id, stage_output) {
                    Ok(_) => Ok(OrchestratorEvent::OutputProcessed {
                        task_id: exec.task_id,
                        stage: exec.stage,
                        output_type,
                    }),
                    Err(e) => Ok(OrchestratorEvent::Error {
                        task_id: Some(exec.task_id),
                        error: e.to_string(),
                    }),
                }
            }
            ExecutionResult::AgentFailed(error) | ExecutionResult::PollError { error } => {
                let _ = api.process_agent_output(
                    &exec.task_id,
                    StageOutput::Failed {
                        error: format!("Agent error: {error}"),
                    },
                );
                Ok(OrchestratorEvent::Error {
                    task_id: Some(exec.task_id),
                    error,
                })
            }
            ExecutionResult::ScriptSuccess { output } => {
                match api.process_script_success(&exec.task_id, &output) {
                    Ok(_) => Ok(OrchestratorEvent::ScriptCompleted {
                        task_id: exec.task_id,
                        stage: exec.stage,
                    }),
                    Err(e) => Ok(OrchestratorEvent::Error {
                        task_id: Some(exec.task_id),
                        error: e.to_string(),
                    }),
                }
            }
            ExecutionResult::ScriptFailed { output, timed_out } => {
                let error_msg = if timed_out {
                    format!("Script timed out:\n{output}")
                } else {
                    format!("Script failed:\n{output}")
                };

                match api.process_script_failure(
                    &exec.task_id,
                    &error_msg,
                    exec.recovery_stage.as_deref(),
                ) {
                    Ok(_) => Ok(OrchestratorEvent::ScriptFailed {
                        task_id: exec.task_id,
                        stage: exec.stage,
                        error: error_msg,
                        recovery_stage: exec.recovery_stage,
                    }),
                    Err(e) => Ok(OrchestratorEvent::Error {
                        task_id: Some(exec.task_id),
                        error: e.to_string(),
                    }),
                }
            }
        }
    }

    /// Start new executions for tasks needing agents or scripts.
    fn start_new_executions(
        &self,
        skip_ids: &HashSet<String>,
    ) -> WorkflowResult<Vec<OrchestratorEvent>> {
        let mut events = Vec::new();

        let tasks = {
            let api = self.api.lock().map_err(|_| WorkflowError::Lock)?;
            api.get_tasks_needing_agents()?
        };

        if !tasks.is_empty() {
            orkestra_debug!(
                "orchestrator",
                "start_new_executions: {} tasks needing execution, {} active",
                tasks.len(),
                self.stage_executor.active_count()
            );
        }

        for task in tasks {
            // Skip tasks that were just set up this tick (sync setup completes
            // inline, so the task is Idle before start_new_executions runs).
            // Let the next tick start agents, so tests can inspect post-setup state.
            if skip_ids.contains(&task.id) {
                continue;
            }

            // Skip if we already have an active execution for this task
            if self.stage_executor.has_active_execution(&task.id) {
                continue;
            }

            let current_stage = task.current_stage().unwrap_or("unknown");
            orkestra_debug!(
                "orchestrator",
                "starting execution for {} in stage {:?}",
                task.id,
                task.current_stage()
            );

            // Get incoming context from active iteration (for agent stages).
            // If the trigger was already delivered to the agent on a previous spawn,
            // skip it so crash recovery uses "session interrupted" instead of replaying
            // stale context (e.g., script failure details the agent already received).
            let trigger = {
                let api = self.api.lock().map_err(|_| WorkflowError::Lock)?;
                api.store
                    .get_active_iteration(&task.id, current_stage)?
                    .and_then(|iter| {
                        if iter.trigger_delivered {
                            None
                        } else {
                            iter.incoming_context
                        }
                    })
            };

            // Mark task as working
            {
                let api = self.api.lock().map_err(|_| WorkflowError::Lock)?;
                api.agent_started(&task.id)?;
            }

            // Spawn via unified service
            match self.stage_executor.spawn(&task, trigger.as_ref()) {
                Ok(result) => {
                    if result.is_script {
                        events.push(OrchestratorEvent::ScriptSpawned {
                            task_id: result.task_id,
                            stage: result.stage,
                            command: result.command.unwrap_or_default(),
                            pid: result.pid,
                        });
                    } else {
                        events.push(OrchestratorEvent::AgentSpawned {
                            task_id: result.task_id,
                            stage: result.stage,
                            pid: result.pid,
                        });
                    }
                }
                Err(e) => {
                    let error_msg = format!("Spawn failed: {e}");
                    let api = self.api.lock().map_err(|_| WorkflowError::Lock)?;
                    let _ = api.process_agent_output(
                        &task.id,
                        StageOutput::Failed {
                            error: error_msg.clone(),
                        },
                    );
                    events.push(OrchestratorEvent::Error {
                        task_id: Some(task.id.clone()),
                        error: error_msg,
                    });
                }
            }
        }

        Ok(events)
    }

    /// Helper to generate commit message with fallback on error.
    /// Runs in the background thread to avoid blocking the orchestrator.
    fn generate_commit_message_with_fallback(
        commit_gen: &Arc<dyn crate::commit_message::CommitMessageGenerator>,
        task_title: &str,
        task_description: &str,
        diff_summary: &str,
        model_names: &[String],
        task_id: &str,
    ) -> String {
        match commit_gen.generate_commit_message(
            task_title,
            task_description,
            diff_summary,
            model_names,
        ) {
            Ok(message) => message,
            Err(e) => {
                orkestra_debug!(
                    "integration",
                    "Commit message generation failed for {}: {e}, using fallback",
                    task_id
                );
                crate::commit_message::fallback_commit_message(task_title, task_id)
            }
        }
    }

    /// Background integration logic. Generates commit message, performs git operations,
    /// and records the result. Runs off the orchestrator's main thread.
    #[allow(clippy::too_many_arguments, clippy::needless_pass_by_value)]
    fn run_background_integration(
        git: Arc<dyn GitService>,
        api: Arc<Mutex<WorkflowApi>>,
        commit_gen: Arc<dyn crate::commit_message::CommitMessageGenerator>,
        task_id: String,
        task_title: String,
        task_description: String,
        diff_summary: String,
        model_names: Vec<String>,
        branch: String,
        target_branch: String,
        worktree_path: Option<PathBuf>,
        has_worktree: bool,
    ) {
        // Generate commit message (may spawn subprocess with timeout)
        let commit_message = Self::generate_commit_message_with_fallback(
            &commit_gen,
            &task_title,
            &task_description,
            &diff_summary,
            &model_names,
            &task_id,
        );

        let params = IntegrationParams {
            task_id: task_id.clone(),
            branch_name: branch,
            target_branch,
            worktree_path,
            commit_message,
        };

        let git_result = perform_git_integration(git.as_ref(), &params);

        match api.lock() {
            Ok(api) => {
                if let Err(e) =
                    api.apply_integration_result(&params.task_id, git_result, has_worktree)
                {
                    orkestra_debug!(
                        "integration",
                        "integration failed for {}: {}",
                        params.task_id,
                        e
                    );
                }
            }
            Err(_) => {
                orkestra_debug!(
                    "integration",
                    "failed to acquire API lock after git work for {} — will be recovered on restart",
                    params.task_id
                );
            }
        }
    }

    /// Start integrations for Done tasks that need merging.
    ///
    /// Only one integration runs at a time — if any task is already in
    /// `Phase::Integrating`, this is a no-op. The git work runs on a
    /// background thread so the API lock is not held during rebase/merge.
    ///
    /// Flow:
    /// 1. Acquire lock, find candidate, mark `Phase::Integrating`, read params, release lock
    /// 2. Spawn background thread: git commit/rebase/merge (no lock)
    /// 3. Background thread acquires lock briefly to record result
    fn start_integrations(&self) -> WorkflowResult<Vec<OrchestratorEvent>> {
        let mut events = Vec::new();

        // Gather candidates and check for in-flight integration under a single lock
        let api = self.api.lock().map_err(|_| WorkflowError::Lock)?;
        let tasks = api.get_tasks_needing_integration()?;

        // One integration at a time — skip if any task is already integrating
        let all_tasks = api.store.list_tasks()?;
        if all_tasks.iter().any(|t| t.phase == Phase::Integrating) {
            return Ok(events);
        }

        let Some(task) = tasks.first() else {
            return Ok(events);
        };

        let task_id = task.id.clone();
        let branch = task.branch_name.clone().unwrap_or_default();

        // Mark as integrating (requires Phase::Idle, prevents double-processing)
        if let Err(e) = api.mark_integrating(&task_id) {
            return Ok(vec![OrchestratorEvent::Error {
                task_id: Some(task_id),
                error: format!("Failed to mark task as integrating: {e}"),
            }]);
        }

        // If no git service, record success immediately (no background work needed)
        if self.git_service.is_none() || task.branch_name.is_none() {
            orkestra_debug!(
                "integration",
                "no git service or no branch for {}, marking success immediately",
                task_id
            );
            let result = api.integration_succeeded(&task_id);
            match result {
                Ok(_) => events.push(OrchestratorEvent::IntegrationCompleted {
                    task_id: task_id.clone(),
                }),
                Err(e) => events.push(OrchestratorEvent::IntegrationFailed {
                    task_id: task_id.clone(),
                    error: e.to_string(),
                    conflict_files: vec![],
                }),
            }
            return Ok(events);
        }

        // Read params while we have the lock
        if task.base_branch.is_empty() {
            // Reset phase since we can't proceed
            let mut reset_task = api.get_task(&task_id)?;
            reset_task.phase = Phase::Idle;
            let _ = api.store.save_task(&reset_task);
            return Ok(vec![OrchestratorEvent::Error {
                task_id: Some(task_id),
                error: "Task has no base_branch set — cannot determine merge target".into(),
            }]);
        }

        // Gather inputs for commit message generation (will be done in background thread)
        let task_title = task.title.clone();
        let task_description = task.description.clone();
        let task_flow = task.flow.clone();
        let diff_summary = api.build_diff_summary(task);
        let model_names =
            crate::commit_message::collect_model_names(&api.workflow, task_flow.as_deref());
        let commit_gen = Arc::clone(&api.commit_message_generator);

        let target_branch = task.base_branch.clone();
        let worktree_path = task.worktree_path.as_ref().map(PathBuf::from);
        let has_worktree = task.worktree_path.is_some();

        // Release the API lock before spawning the background thread
        drop(api);

        events.push(OrchestratorEvent::IntegrationStarted {
            task_id: task_id.clone(),
            branch: branch.clone(),
        });

        let git = self.git_service.clone().unwrap(); // checked above
        let api_clone = Arc::clone(&self.api);

        let run_integration = move || {
            Self::run_background_integration(
                git,
                api_clone,
                commit_gen,
                task_id,
                task_title,
                task_description,
                diff_summary,
                model_names,
                branch,
                target_branch,
                worktree_path,
                has_worktree,
            );
        };

        if self.sync_background {
            run_integration();
        } else {
            std::thread::spawn(run_integration);
        }

        Ok(events)
    }

    /// Recover tasks stuck in Integrating phase (from app crash during merge).
    ///
    /// Tasks that were being integrated when the app crashed will be stuck in Integrating.
    ///
    /// First checks if the branch was already merged into the target. This handles
    /// the common case where the merge succeeded but the app was killed before
    /// the DB was updated to Archived (e.g., merge triggers a rebuild that restarts
    /// the app). In this case, the task is archived directly without re-merging.
    ///
    /// If the branch is NOT merged, falls back to re-attempting the full integration.
    fn recover_stale_integrations(&self) -> Vec<OrchestratorEvent> {
        let mut events = Vec::new();

        let Ok(api) = self.api.lock() else {
            orkestra_debug!(
                "recovery",
                "Failed to acquire API lock for stale integration recovery"
            );
            return events;
        };

        let Ok(tasks) = api.store.list_tasks() else {
            orkestra_debug!(
                "recovery",
                "Failed to list tasks for stale integration recovery"
            );
            return events;
        };

        for task in tasks {
            if task.phase == Phase::Integrating && task.is_done() {
                orkestra_debug!("recovery", "Found stale Integrating task: {}", task.id);

                if Self::is_branch_already_merged(&api, &task) {
                    // Branch is already merged — archive directly
                    orkestra_debug!(
                        "recovery",
                        "Branch already merged for {}, archiving directly",
                        task.id
                    );

                    // Clean up worktree if it still exists on disk
                    if task.worktree_path.is_some() {
                        if let Some(ref git) = api.git_service {
                            if let Err(e) = git.remove_worktree(&task.id, true) {
                                orkestra_debug!(
                                    "recovery",
                                    "Failed to remove worktree for {} (non-critical): {}",
                                    task.id,
                                    e
                                );
                            }
                        }
                    }

                    match api.integration_succeeded(&task.id) {
                        Ok(_) => {
                            orkestra_debug!("recovery", "Archived already-merged task {}", task.id);
                            events.push(OrchestratorEvent::IntegrationCompleted {
                                task_id: task.id.clone(),
                            });
                        }
                        Err(e) => {
                            orkestra_debug!(
                                "recovery",
                                "Failed to archive already-merged task {}: {}",
                                task.id,
                                e
                            );
                            events.push(OrchestratorEvent::IntegrationFailed {
                                task_id: task.id.clone(),
                                error: e.to_string(),
                                conflict_files: vec![],
                            });
                        }
                    }
                } else {
                    // Branch is NOT merged — re-attempt full integration
                    match api.integrate_task(&task.id) {
                        Ok(_) => {
                            orkestra_debug!(
                                "recovery",
                                "Successfully recovered integration for {}",
                                task.id
                            );
                            events.push(OrchestratorEvent::IntegrationCompleted {
                                task_id: task.id.clone(),
                            });
                        }
                        Err(e) => {
                            orkestra_debug!(
                                "recovery",
                                "Integration failed for {}: {}",
                                task.id,
                                e
                            );

                            // integration_failed() should have moved task to recovery stage.
                            // Verify the task is no longer stuck in Integrating phase.
                            if let Ok(updated_task) = api.get_task(&task.id) {
                                if updated_task.phase == Phase::Integrating {
                                    // Fallback: reset phase to Idle so orchestrator can retry later
                                    orkestra_debug!(
                                        "recovery",
                                        "Task {} still in Integrating phase, resetting to Idle",
                                        task.id
                                    );
                                    let mut reset_task = updated_task;
                                    reset_task.phase = Phase::Idle;
                                    let _ = api.store.save_task(&reset_task);
                                }
                            }

                            events.push(OrchestratorEvent::IntegrationFailed {
                                task_id: task.id.clone(),
                                error: e.to_string(),
                                conflict_files: vec![],
                            });
                        }
                    }
                }
            }
        }

        events
    }

    /// Check if a task's branch is already merged into its target branch.
    ///
    /// Returns `true` if:
    /// - No git service configured (nothing to merge)
    /// - No branch name on the task (nothing to merge)
    /// - The branch no longer exists (already cleaned up after merge)
    /// - The branch's commits are all reachable from the target
    ///
    /// Returns `false` if the branch has unmerged commits or if the check fails.
    fn is_branch_already_merged(api: &WorkflowApi, task: &crate::workflow::domain::Task) -> bool {
        let Some(ref git) = api.git_service else {
            return true; // No git = nothing to merge
        };

        let Some(ref branch_name) = task.branch_name else {
            return true; // No branch = nothing to merge
        };

        if task.base_branch.is_empty() {
            // No base_branch means we can't determine the merge target.
            // Treat as not merged so integration can surface the error.
            return false;
        }

        match git.is_branch_merged(branch_name, &task.base_branch) {
            Ok(merged) => merged,
            Err(e) => {
                orkestra_debug!(
                    "recovery",
                    "Failed to check merge status for {}: {}, assuming not merged",
                    task.id,
                    e
                );
                false // Err on side of caution: attempt re-integration
            }
        }
    }

    /// Recover tasks stuck in `SettingUp` phase (from app crash during setup).
    ///
    /// Tasks stuck in `SettingUp` from a previous crash are transitioned back to
    /// `AwaitingSetup`. The orchestrator will pick them up on the next tick.
    /// Cleans up any partial worktree/branch before transitioning.
    fn recover_stale_setup_tasks(&self) {
        let Ok(api) = self.api.lock() else {
            orkestra_debug!(
                "recovery",
                "Failed to acquire API lock for stale setup recovery"
            );
            return;
        };

        // Use store.list_tasks() directly to get ALL tasks including subtasks
        // (api.list_tasks() filters out subtasks)
        let Ok(tasks) = api.store.list_tasks() else {
            orkestra_debug!("recovery", "Failed to list tasks for stale setup recovery");
            return;
        };

        for task in &tasks {
            if task.phase != Phase::SettingUp {
                continue;
            }

            orkestra_debug!("recovery", "Recovering stale setup task: {}", task.id);

            // Clean up any partial worktree/branch from interrupted setup
            if let Some(ref git) = api.git_service {
                if let Err(e) = git.remove_worktree(&task.id, true) {
                    // Expected if worktree wasn't created yet
                    if !e.to_string().contains("not found")
                        && !e.to_string().contains("does not exist")
                    {
                        orkestra_debug!(
                            "recovery",
                            "WARNING: Failed to clean up partial worktree for {}: {}",
                            task.id,
                            e
                        );
                    }
                }
            }

            // Transition back to AwaitingSetup - orchestrator will re-trigger
            let mut task = task.clone();
            task.phase = Phase::AwaitingSetup;
            task.worktree_path = None;
            task.branch_name = None;
            if let Err(e) = api.store.save_task(&task) {
                orkestra_debug!(
                    "recovery",
                    "Failed to transition task {} to AwaitingSetup: {}",
                    task.id,
                    e
                );
            }
        }
    }

    /// Recover tasks stuck in `AgentWorking` phase (from app crash during agent run).
    ///
    /// Tasks that had an agent running when the app crashed will be stuck in `AgentWorking`.
    /// We reset them to Idle so the orchestrator can respawn the agent.
    fn recover_stale_agent_working_tasks(&self) {
        let Ok(api) = self.api.lock() else {
            orkestra_debug!(
                "recovery",
                "Failed to acquire API lock for stale agent recovery"
            );
            return;
        };

        let Ok(tasks) = api.store.list_tasks() else {
            orkestra_debug!("recovery", "Failed to list tasks for stale agent recovery");
            return;
        };

        for task in tasks {
            if task.phase == Phase::AgentWorking {
                orkestra_debug!("recovery", "Found stale AgentWorking task: {}", task.id);

                let mut task = task;
                task.phase = Phase::Idle;
                // Keep same status - orchestrator will respawn agent

                if let Err(e) = api.store.save_task(&task) {
                    orkestra_debug!(
                        "recovery",
                        "Failed to reset stale task {} to Idle: {}",
                        task.id,
                        e
                    );
                }
            }
        }
    }

    /// Clean up worktrees that are no longer needed.
    ///
    /// Removes worktrees in two cases:
    /// 1. **Orphaned**: The task was deleted from the DB but the worktree remains on disk.
    /// 2. **Archived**: The task was integrated but crashed before worktree cleanup.
    ///
    /// Other terminal states (Done, Failed, Blocked) keep their worktrees:
    /// Done tasks still need theirs for integration, and Failed/Blocked tasks
    /// can be retried.
    fn cleanup_orphaned_worktrees(&self) {
        let Ok(api) = self.api.lock() else {
            orkestra_debug!(
                "recovery",
                "Failed to acquire API lock for orphaned worktree cleanup"
            );
            return;
        };

        let Some(ref git) = api.git_service else {
            return; // No git service configured
        };

        let worktree_names = match git.list_worktree_names() {
            Ok(names) => names,
            Err(e) => {
                orkestra_debug!("recovery", "Failed to list worktree dirs: {}", e);
                return;
            }
        };

        if worktree_names.is_empty() {
            return;
        }

        let Ok(all_tasks) = api.store.list_tasks() else {
            orkestra_debug!(
                "recovery",
                "Failed to list tasks for orphaned worktree cleanup"
            );
            return;
        };

        let tasks_by_id: HashMap<&str, &crate::workflow::domain::Task> =
            all_tasks.iter().map(|t| (t.id.as_str(), t)).collect();

        for name in &worktree_names {
            let should_remove = match tasks_by_id.get(name.as_str()) {
                None => {
                    orkestra_debug!("recovery", "Cleaning up orphaned worktree: {name}");
                    true
                }
                Some(task) if task.status.is_archived() && task.phase == Phase::Idle => {
                    orkestra_debug!("recovery", "Cleaning up worktree for archived task: {name}");
                    true
                }
                _ => false,
            };

            if should_remove {
                if let Err(e) = git.remove_worktree(name, true) {
                    orkestra_debug!("recovery", "Failed to clean up worktree {name}: {}", e);
                }
            }
        }
    }

    /// Get count of active executions.
    pub fn active_count(&self) -> usize {
        self.stage_executor.active_count()
    }
}

/// Get a string representation of the output type.
fn output_type_string(output: &StageOutput) -> String {
    match output {
        StageOutput::Artifact { .. } => "artifact".to_string(),
        StageOutput::Questions { .. } => "questions".to_string(),
        StageOutput::Subtasks { .. } => "subtasks".to_string(),
        StageOutput::Approval { .. } => "approval".to_string(),
        StageOutput::Failed { .. } => "failed".to_string(),
        StageOutput::Blocked { .. } => "blocked".to_string(),
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

    fn create_test_orchestrator() -> OrchestratorLoop {
        let workflow = test_workflow();
        let store: Arc<dyn WorkflowStore> = Arc::new(InMemoryWorkflowStore::new());
        let api = Arc::new(Mutex::new(WorkflowApi::new(
            workflow.clone(),
            Arc::clone(&store),
        )));

        let iteration_service = api.lock().unwrap().iteration_service().clone();
        let project_root = PathBuf::from("/tmp");

        let stage_executor = Arc::new(StageExecutionService::new(
            workflow,
            project_root,
            store,
            iteration_service,
        ));

        OrchestratorLoop::new(api, stage_executor)
    }

    #[test]
    fn test_stop_flag() {
        let orchestrator = create_test_orchestrator();

        assert!(!orchestrator.stop_flag.load(Ordering::Relaxed));
        orchestrator.stop();
        assert!(orchestrator.stop_flag.load(Ordering::Relaxed));
    }

    #[test]
    fn test_active_count() {
        let orchestrator = create_test_orchestrator();
        assert_eq!(orchestrator.active_count(), 0);
    }

    #[test]
    fn test_output_type_string() {
        assert_eq!(
            output_type_string(&StageOutput::Failed {
                error: "err".into()
            }),
            "failed"
        );
        assert_eq!(
            output_type_string(&StageOutput::Artifact {
                content: "test".into()
            }),
            "artifact"
        );
    }

    #[test]
    fn test_orchestrator_error_display() {
        let err = OrchestratorError::LockPoisoned;
        assert_eq!(err.to_string(), "Lock poisoned");

        let err = OrchestratorError::WorkflowError("test".into());
        assert!(err.to_string().contains("test"));
    }
}
