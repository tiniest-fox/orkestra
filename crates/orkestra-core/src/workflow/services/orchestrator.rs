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
use crate::pr_description::PrDescriptionGenerator;
use crate::workflow::config::WorkflowConfig;
use crate::workflow::domain::{Task, TaskHeader, TickSnapshot};
use crate::workflow::ports::{GitService, PrService, WorkflowError, WorkflowResult, WorkflowStore};
use crate::workflow::runtime::Phase;

use super::integration::{perform_git_integration, IntegrationParams};
use super::stage_execution::{ExecutionComplete, ExecutionResult, StageExecutionService};
use super::WorkflowApi;

/// Parameters for a background commit job.
struct CommitJob {
    task: Task,
    /// The stage being committed (for simple commit message format).
    stage: String,
    /// Activity log from the iteration (for commit message body).
    activity_log: Option<String>,
    git: Arc<dyn GitService>,
}

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
    /// Agent output was processed and task advanced.
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
    /// PR creation started for a task.
    PrCreationStarted { task_id: String, branch: String },
    /// PR creation completed successfully.
    PrCreationCompleted { task_id: String, pr_url: String },
    /// PR creation failed.
    PrCreationFailed { task_id: String, error: String },
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

        // Maintenance — runs periodically (core phases run unconditionally every tick)
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
        // Load all task headers once for all recovery methods
        let headers = {
            let Ok(api) = self.api.lock() else {
                orkestra_debug!(
                    "recovery",
                    "Failed to acquire API lock for startup recovery"
                );
                return vec![];
            };
            match api.store.list_task_headers() {
                Ok(h) => h,
                Err(e) => {
                    orkestra_debug!(
                        "recovery",
                        "Failed to list task headers for startup recovery: {}",
                        e
                    );
                    return vec![];
                }
            }
        };

        // Recover stale setup tasks on startup (tasks stuck in SettingUp phase)
        self.recover_stale_setup_tasks(&headers);

        // Recover stale agent working tasks on startup (tasks stuck in AgentWorking phase)
        self.recover_stale_agent_working_tasks(&headers);

        // Recover stale committing tasks (background thread died — reset to Finishing)
        self.recover_stale_committing_tasks(&headers);

        // Clean up orphaned worktrees (from deleted tasks where git cleanup was deferred)
        self.cleanup_orphaned_worktrees();

        // Recover stale integrations on startup (tasks stuck in Integrating phase)
        self.recover_stale_integrations(&headers)
    }

    /// Run the orchestration loop.
    ///
    /// This blocks the current thread and runs until `stop()` is called.
    /// Uses adaptive sleep: 500ms when events occurred, 2000ms when idle.
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
                    let had_events = !events.is_empty();
                    for event in events {
                        on_event(event);
                    }
                    let sleep_ms = if had_events { 500 } else { 2000 };
                    std::thread::sleep(Duration::from_millis(sleep_ms));
                }
                Err(e) => {
                    on_event(OrchestratorEvent::Error {
                        task_id: None,
                        error: e.to_string(),
                    });
                    std::thread::sleep(Duration::from_millis(500));
                }
            }
        }
    }

    /// Run a single tick of the orchestration loop.
    ///
    /// Loads all task headers once, builds a `TickSnapshot`, and dispatches
    /// to phase methods that filter from the snapshot instead of querying
    /// the store independently.
    ///
    /// Phases that can create new candidates for later phases (e.g.,
    /// `advance_committed_stages` creating Done tasks for integration)
    /// trigger a snapshot refresh before those later phases run.
    pub fn tick(&self) -> WorkflowResult<Vec<OrchestratorEvent>> {
        let mut events = Vec::new();

        // Track tasks that should not have agents started this tick.
        // Includes tasks just set up (sync setup completes inline) and tasks
        // that just advanced via the commit pipeline (advance_committed_stages).
        // This gives the next tick a chance to inspect state before spawning.
        let mut defer_spawn_ids = HashSet::new();

        // Load + categorize once
        let snapshot = self.build_snapshot()?;

        // Core phases — run unconditionally every tick
        defer_spawn_ids.extend(self.setup_awaiting_tasks(&snapshot)?);
        events.extend(self.check_parent_completions(&snapshot)?);
        events.extend(self.process_completed_executions()?);

        // Commit pipeline: queries DB directly (not snapshot) because
        // process_completed_executions can create Finishing tasks, and
        // spawn_pending_commits bg threads create Finished tasks — both
        // after the snapshot was built.
        self.spawn_pending_commits()?;
        let advance_events = self.advance_committed_stages()?;
        let state_changed = !advance_events.is_empty();
        for event in &advance_events {
            if let OrchestratorEvent::OutputProcessed { task_id, .. } = event {
                defer_spawn_ids.insert(task_id.clone());
            }
        }
        events.extend(advance_events);

        // Refresh snapshot if the commit pipeline mutated state (e.g., tasks
        // became Done or Active), so later phases see the updated candidates.
        let snapshot = if state_changed {
            self.build_snapshot()?
        } else {
            snapshot
        };

        events.extend(self.start_new_executions(&snapshot, &defer_spawn_ids)?);
        events.extend(self.start_integrations(&snapshot)?);
        events.extend(self.start_pr_creations(&snapshot)?);

        // Periodic maintenance
        let due = {
            let mut scheduler = self.scheduler.lock().map_err(|_| WorkflowError::Lock)?;
            scheduler.poll_due()
        };
        for name in due {
            if name == "cleanup_worktrees" {
                self.cleanup_orphaned_worktrees();
            }
        }

        // In sync mode, drain any active executions (scripts) so they complete
        // within this tick. Mock agents already complete synchronously; this
        // handles real script processes used in tests.
        if self.sync_background {
            for exec in self.stage_executor.drain_active() {
                events.push(self.handle_execution_complete(exec)?);
            }
            // Drained executions may set tasks to Finishing (auto-advance) — run
            // the commit and advancement phases so the full pipeline completes in one tick.
            // These query the DB directly (not snapshot) so they see the latest state.
            // Note: integration is NOT run here — it stays in the main tick phases to
            // avoid advancing subtask pipelines faster than tests expect.
            self.spawn_pending_commits()?;
            events.extend(self.advance_committed_stages()?);
        }

        Ok(events)
    }

    /// Build a `TickSnapshot` from the current store state.
    fn build_snapshot(&self) -> WorkflowResult<TickSnapshot> {
        let api = self.api.lock().map_err(|_| WorkflowError::Lock)?;
        let headers = api.store.list_task_headers()?;
        Ok(TickSnapshot::build(headers))
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
    fn setup_awaiting_tasks(&self, snapshot: &TickSnapshot) -> WorkflowResult<HashSet<String>> {
        if snapshot.awaiting_setup.is_empty() {
            return Ok(HashSet::new());
        }

        let api = self.api.lock().map_err(|_| WorkflowError::Lock)?;
        let mut just_set_up = HashSet::new();

        for header in &snapshot.awaiting_setup {
            // For subtasks: check all dependencies are satisfied (fully integrated)
            if header.parent_id.is_some()
                && !header
                    .depends_on
                    .iter()
                    .all(|dep| snapshot.integrated_ids.contains(dep))
            {
                continue;
            }

            orkestra_debug!(
                "orchestrator",
                "Setting up task {} (deps satisfied)",
                header.id
            );

            // Load full task to save (save_task needs Task, not TaskHeader)
            let Some(mut task) = api.store.get_task(&header.id)? else {
                continue;
            };

            // Transition to SettingUp BEFORE spawning (prevents double-spawn)
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
    ///
    /// Uses snapshot data to filter subtasks by `parent_id` (eliminates N+1 query).
    fn check_parent_completions(
        &self,
        snapshot: &TickSnapshot,
    ) -> WorkflowResult<Vec<OrchestratorEvent>> {
        if snapshot.waiting_parents.is_empty() {
            return Ok(Vec::new());
        }

        let mut events = Vec::new();

        for parent in &snapshot.waiting_parents {
            // Find subtasks of this parent from the snapshot
            let subtasks: Vec<&_> = snapshot
                .all
                .iter()
                .filter(|t| t.parent_id.as_deref() == Some(&parent.id))
                .collect();

            if subtasks.is_empty() {
                continue;
            }

            // Subtasks must be Archived (merged back to parent branch), not just Done.
            // Failed subtasks can be retried independently, so parent stays in WaitingOnChildren.
            let all_archived = subtasks.iter().all(|t| t.is_archived());

            if all_archived {
                let subtask_count = subtasks.len();

                let api = self.api.lock().map_err(|_| WorkflowError::Lock)?;
                match api.advance_parent(&parent.id) {
                    Ok(_) => {
                        orkestra_debug!(
                            "orchestrator",
                            "Parent {} advanced: all {} subtasks done",
                            parent.id,
                            subtask_count
                        );
                        events.push(OrchestratorEvent::ParentAdvanced {
                            task_id: parent.id.clone(),
                            subtask_count,
                        });
                    }
                    Err(e) => {
                        orkestra_debug!(
                            "orchestrator",
                            "Failed to advance parent {}: {}",
                            parent.id,
                            e
                        );
                        events.push(OrchestratorEvent::Error {
                            task_id: Some(parent.id.clone()),
                            error: e.to_string(),
                        });
                    }
                }
            }
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
                let output_type = stage_output.type_label().to_string();
                orkestra_debug!(
                    "orchestrator",
                    "agent completed {}/{}: type={}, processing output",
                    exec.task_id,
                    exec.stage,
                    output_type
                );
                // Process output directly — sets AwaitingReview or Finishing
                // depending on auto-advance. If Finishing, the commit pipeline
                // runs on the next tick (or inline in sync mode).
                match api.process_agent_output(&exec.task_id, stage_output) {
                    Ok(_) => Ok(OrchestratorEvent::OutputProcessed {
                        task_id: exec.task_id,
                        stage: exec.stage,
                        output_type,
                    }),
                    Err(e) => {
                        orkestra_debug!(
                            "orchestrator",
                            "Failed to process agent output for {}: {}",
                            exec.task_id,
                            e
                        );
                        if let Err(fe) = api.fail_agent_execution(
                            &exec.task_id,
                            &format!("Output processing failed: {e}"),
                        ) {
                            orkestra_debug!(
                                "orchestrator",
                                "Failed to record output failure for {}: {}",
                                exec.task_id,
                                fe
                            );
                        }
                        Ok(OrchestratorEvent::Error {
                            task_id: Some(exec.task_id),
                            error: e.to_string(),
                        })
                    }
                }
            }
            ExecutionResult::AgentFailed(error) | ExecutionResult::PollError { error } => {
                // Failed agents don't need commits — process directly via dedicated failure path.
                if let Err(e) =
                    api.fail_agent_execution(&exec.task_id, &format!("Agent error: {error}"))
                {
                    orkestra_debug!(
                        "orchestrator",
                        "Failed to record agent failure for {}: {}",
                        exec.task_id,
                        e
                    );
                }
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
    ///
    /// Uses `snapshot.idle_active` (Idle + Active tasks) and `snapshot.done_ids`
    /// for dependency checking instead of calling `get_tasks_needing_agents()`.
    /// Loads the full task (with artifacts) only for tasks that will actually spawn.
    fn start_new_executions(
        &self,
        snapshot: &TickSnapshot,
        defer_spawn_ids: &HashSet<String>,
    ) -> WorkflowResult<Vec<OrchestratorEvent>> {
        if snapshot.idle_active.is_empty() {
            return Ok(Vec::new());
        }

        let mut events = Vec::new();

        // Filter candidates from snapshot (same logic as get_tasks_needing_agents)
        let candidates: Vec<&_> = snapshot
            .idle_active
            .iter()
            .filter(|h| {
                h.depends_on
                    .iter()
                    .all(|dep| snapshot.done_ids.contains(dep))
            })
            .collect();

        if !candidates.is_empty() {
            orkestra_debug!(
                "orchestrator",
                "start_new_executions: {} tasks needing execution, {} active",
                candidates.len(),
                self.stage_executor.active_count()
            );
        }

        for header in candidates {
            // Skip tasks that were just set up this tick (sync setup completes
            // inline, so the task is Idle before start_new_executions runs).
            // Let the next tick start agents, so tests can inspect post-setup state.
            if defer_spawn_ids.contains(&header.id) {
                continue;
            }

            // Skip if we already have an active execution for this task
            if self.stage_executor.has_active_execution(&header.id) {
                continue;
            }

            let current_stage = header.current_stage().unwrap_or("unknown");
            orkestra_debug!(
                "orchestrator",
                "starting execution for {} in stage {:?}",
                header.id,
                header.current_stage()
            );

            // Load full task (with artifacts) for spawning — needs artifacts for prompt building
            let task = {
                let api = self.api.lock().map_err(|_| WorkflowError::Lock)?;
                match api.store.get_task(&header.id)? {
                    Some(t) => t,
                    None => continue,
                }
            };

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
                    if let Err(e) = api.fail_agent_execution(&task.id, &error_msg) {
                        orkestra_debug!(
                            "orchestrator",
                            "Failed to record spawn failure for {}: {}",
                            task.id,
                            e
                        );
                    }
                    events.push(OrchestratorEvent::Error {
                        task_id: Some(task.id.clone()),
                        error: error_msg,
                    });
                }
            }
        }

        Ok(events)
    }

    /// Background integration logic. Performs git operations and records the result.
    /// Runs off the orchestrator's main thread.
    ///
    /// The Finishing → Committing → Finished pipeline already committed worktree
    /// changes. The safety-net `commit_worktree_changes` call here is a no-op in
    /// the normal case, but catches edge cases (e.g., manual recovery, direct
    /// `integrate_task` calls from tests).
    #[allow(clippy::needless_pass_by_value)]
    fn run_background_integration(git: Arc<dyn GitService>, api: Arc<Mutex<WorkflowApi>>, task: Task) {
        let task_id = task.id.clone();
        let has_worktree = task.worktree_path.is_some();

        // Safety-net commit — should be a no-op after the Finishing pipeline,
        // but catches stragglers from manual recovery or direct API calls.
        // Uses "integration-safety" as stage name since this is a fallback path.
        if let Err(e) = super::commit_worktree::commit_worktree_changes(
            git.as_ref(),
            &task,
            "integration-safety",
            None,
        ) {
            let error_msg = format!("Failed to commit pending changes: {e}");
            orkestra_debug!(
                "integration",
                "safety-net commit failed for {}: {}",
                task_id,
                error_msg
            );
            match api.lock() {
                Ok(api) => {
                    if let Err(e) = api.apply_integration_result(
                        &task_id,
                        super::integration::IntegrationGitResult::CommitError(error_msg),
                        has_worktree,
                    ) {
                        orkestra_debug!(
                            "integration",
                            "failed to record integration result for {}: {}",
                            task_id,
                            e
                        );
                    }
                }
                Err(_) => {
                    orkestra_debug!(
                        "integration",
                        "failed to acquire API lock after commit failure for {} — will be recovered on restart",
                        task_id
                    );
                }
            }
            return;
        }

        let params = IntegrationParams {
            task_id: task_id.clone(),
            branch_name: task.branch_name.clone().unwrap_or_default(),
            target_branch: task.base_branch.clone(),
            worktree_path: task.worktree_path.as_ref().map(PathBuf::from),
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

    /// Background PR creation logic. Performs git push and PR creation, records the result.
    /// Runs off the orchestrator's main thread.
    #[allow(clippy::needless_pass_by_value)]
    fn run_background_pr_creation(
        git: Arc<dyn GitService>,
        pr_service: Arc<dyn PrService>,
        pr_description_generator: Arc<dyn PrDescriptionGenerator>,
        api: Arc<Mutex<WorkflowApi>>,
        task: Task,
    ) {
        let task_id = task.id.clone();
        let branch = task.branch_name.clone().unwrap_or_default();
        let base_branch = task.base_branch.clone();

        // 1. Safety-net commit
        // Uses "pr-safety" as stage name since this is a fallback path.
        if let Err(e) = super::commit_worktree::commit_worktree_changes(
            git.as_ref(),
            &task,
            "pr-safety",
            None,
        ) {
            if let Ok(api) = api.lock() {
                let _ = api.pr_creation_failed(&task_id, &format!("Commit failed: {e}"));
            }
            return;
        }

        // 2. Push branch
        if let Err(e) = git.push_branch(&branch) {
            if let Ok(api) = api.lock() {
                let _ = api.pr_creation_failed(&task_id, &e.to_string());
            }
            return;
        }

        // 3. Generate PR description (with fallback on failure)
        let diff_summary = super::commit_worktree::build_diff_summary(git.as_ref(), &task);

        // Get plan artifact if available for richer PR body
        let plan_artifact = task.artifacts.get("plan").map(|a| a.content.as_str());

        let (pr_title, pr_body) = pr_description_generator
            .generate_pr_description(
                &task.title,
                &task.description,
                plan_artifact,
                &diff_summary,
                &base_branch,
            )
            .unwrap_or_else(|_| {
                // Fallback: use task title and basic body
                (
                    task.title.clone(),
                    format!(
                        "## Summary\n\n{}\n\n## Test plan\n\n- [ ] Verify changes",
                        task.description
                    ),
                )
            });

        // 4. Create PR (idempotent — checks for existing PR first)
        let repo_root = task
            .worktree_path
            .as_deref()
            .map_or_else(|| std::path::Path::new("."), std::path::Path::new);
        match pr_service.create_pull_request(repo_root, &branch, &base_branch, &pr_title, &pr_body)
        {
            Ok(pr_url) => {
                if let Ok(api) = api.lock() {
                    let _ = api.pr_creation_succeeded(&task_id, &pr_url);
                }
            }
            Err(e) => {
                if let Ok(api) = api.lock() {
                    let _ = api.pr_creation_failed(&task_id, &e.to_string());
                }
            }
        }
    }

    /// Spawn a background PR creation thread for a task that is already marked Integrating.
    pub fn spawn_pr_creation(&self, task: &Task) -> WorkflowResult<()> {
        let api = self.api.lock().map_err(|_| WorkflowError::Lock)?;
        let task = task.clone();
        let pr_description_generator = Arc::clone(&api.pr_description_generator);
        let pr_service = api
            .pr_service
            .clone()
            .ok_or_else(|| WorkflowError::GitError("No PR service configured".into()))?;
        drop(api);

        let git = self
            .git_service
            .clone()
            .ok_or_else(|| WorkflowError::GitError("No git service configured".into()))?;
        let api_clone = Arc::clone(&self.api);

        let run = move || {
            Self::run_background_pr_creation(
                git,
                pr_service,
                pr_description_generator,
                api_clone,
                task,
            );
        };

        if self.sync_background {
            run();
        } else {
            std::thread::spawn(run);
        }
        Ok(())
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
    fn start_integrations(
        &self,
        snapshot: &TickSnapshot,
    ) -> WorkflowResult<Vec<OrchestratorEvent>> {
        let mut events = Vec::new();

        // One integration at a time — skip if any task is already integrating
        if snapshot.has_integrating {
            return Ok(events);
        }

        // Check auto_merge config — when false, don't auto-integrate.
        // User must trigger merge or PR creation explicitly.
        {
            let api = self.api.lock().map_err(|_| WorkflowError::Lock)?;
            if !api.workflow.integration.auto_merge {
                return Ok(events);
            }
        }

        let Some(header) = snapshot.idle_done_with_worktree.first() else {
            return Ok(events);
        };

        let task_id = header.id.clone();
        let branch = header.branch_name.clone().unwrap_or_default();

        // Acquire lock to mark as integrating and read full task
        let api = self.api.lock().map_err(|_| WorkflowError::Lock)?;
        let Some(task) = api.store.get_task(&task_id)? else {
            return Ok(events);
        };

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
            if let Err(e) = api.store.save_task(&reset_task) {
                orkestra_debug!(
                    "integration",
                    "Failed to reset task {} phase: {}",
                    task_id,
                    e
                );
            }
            return Ok(vec![OrchestratorEvent::Error {
                task_id: Some(task_id),
                error: "Task has no base_branch set — cannot determine merge target".into(),
            }]);
        }

        // Gather inputs for background thread while holding lock
        let task = task.clone();

        // Release the API lock before spawning the background thread
        drop(api);

        events.push(OrchestratorEvent::IntegrationStarted {
            task_id: task_id.clone(),
            branch: branch.clone(),
        });

        let git = self.git_service.clone().expect("git_service checked above");
        let api_clone = Arc::clone(&self.api);

        let run_integration = move || {
            Self::run_background_integration(git, api_clone, task);
        };

        if self.sync_background {
            run_integration();
        } else {
            std::thread::spawn(run_integration);
        }

        Ok(events)
    }

    /// Start PR creations for Done tasks awaiting PR.
    ///
    /// Detects tasks in `Done+Integrating` with no `pr_url` and spawns background
    /// PR creation. The PR work runs on a background thread so the API lock is not
    /// held during gh CLI calls.
    ///
    /// Flow:
    /// 1. Filter snapshot for Done+Integrating tasks with no `pr_url`
    /// 2. Call `spawn_pr_creation()` (acquires lock, reads params, spawns bg thread)
    /// 3. Background thread calls gh CLI and records result
    fn start_pr_creations(
        &self,
        snapshot: &TickSnapshot,
    ) -> WorkflowResult<Vec<OrchestratorEvent>> {
        let mut events = Vec::new();

        // Find Done+Integrating tasks with no pr_url (awaiting PR creation)
        let candidates: Vec<_> = snapshot
            .all
            .iter()
            .filter(|h| h.is_done() && h.phase == Phase::Integrating && h.pr_url.is_none())
            .collect();

        if candidates.is_empty() {
            return Ok(events);
        }

        // Process first candidate (one at a time, like integrations)
        let header = candidates[0];
        let task_id = header.id.clone();
        let branch = header.branch_name.clone().unwrap_or_default();

        // Acquire lock to read full task
        let api = self.api.lock().map_err(|_| WorkflowError::Lock)?;
        let Some(task) = api.store.get_task(&task_id)? else {
            return Ok(events);
        };
        drop(api);

        // Spawn PR creation background thread
        events.push(OrchestratorEvent::PrCreationStarted {
            task_id: task_id.clone(),
            branch: branch.clone(),
        });

        if let Err(e) = self.spawn_pr_creation(&task) {
            events.push(OrchestratorEvent::PrCreationFailed {
                task_id: task_id.clone(),
                error: e.to_string(),
            });
        }

        Ok(events)
    }

    // ========================================================================
    // Finishing / Committing / Finished pipeline
    // ========================================================================

    /// Transition Finishing tasks to Committing and spawn background commit threads.
    ///
    /// Always goes through Committing — even if there are no changes, the
    /// background thread completes instantly (`commit_pending_changes` is a no-op
    /// when clean). This keeps the git status check off the tick thread.
    fn spawn_pending_commits(&self) -> WorkflowResult<()> {
        let jobs = self.collect_pending_commit_jobs()?;

        for job in jobs {
            let api_clone = Arc::clone(&self.api);
            let run_commit = move || {
                Self::run_background_commit(
                    job.git,
                    api_clone,
                    job.task,
                    job.stage,
                    job.activity_log,
                );
            };

            if self.sync_background {
                run_commit();
            } else {
                std::thread::spawn(run_commit);
            }
        }

        Ok(())
    }

    /// Find Finishing tasks, transition them to Committing (or Finished if no git),
    /// and return the commit jobs to spawn.
    fn collect_pending_commit_jobs(&self) -> WorkflowResult<Vec<CommitJob>> {
        let api = self.api.lock().map_err(|_| WorkflowError::Lock)?;
        let finishing: Vec<_> = api
            .store
            .list_task_headers()?
            .into_iter()
            .filter(|h| h.phase == Phase::Finishing)
            .collect();

        if finishing.is_empty() {
            return Ok(Vec::new());
        }

        let mut jobs = Vec::new();

        for header in &finishing {
            let Some(mut task) = api.store.get_task(&header.id)? else {
                continue;
            };
            if task.phase != Phase::Finishing {
                continue;
            }

            // Get stage and activity_log for simple commit message
            let stage = task.current_stage().unwrap_or("unknown").to_string();
            let activity_log = api
                .store
                .get_latest_iteration(&task.id, &stage)?
                .and_then(|iter| iter.activity_log);

            orkestra_debug!(
                "orchestrator",
                "spawn_pending_commits {}: → {}",
                task.id,
                if self.git_service.is_some() {
                    "Committing"
                } else {
                    "Finished"
                }
            );

            if let Some(g) = &self.git_service {
                // Git path: transition to Committing and queue background job
                task.phase = Phase::Committing;
                task.updated_at = chrono::Utc::now().to_rfc3339();
                api.store.save_task(&task)?;

                jobs.push(CommitJob {
                    task,
                    stage,
                    activity_log,
                    git: Arc::clone(g),
                });
            } else {
                // No git service — skip commit, go straight to Finished
                task.phase = Phase::Finished;
                task.updated_at = chrono::Utc::now().to_rfc3339();
                api.store.save_task(&task)?;
            }
        }

        Ok(jobs)
    }

    /// Background commit logic. Commits worktree changes and records result via `WorkflowApi`.
    #[allow(clippy::needless_pass_by_value)]
    fn run_background_commit(
        git: Arc<dyn GitService>,
        api: Arc<Mutex<WorkflowApi>>,
        task: Task,
        stage: String,
        activity_log: Option<String>,
    ) {
        let task_id = task.id.clone();

        let commit_result = super::commit_worktree::commit_worktree_changes(
            git.as_ref(),
            &task,
            &stage,
            activity_log.as_deref(),
        );

        let Ok(api) = api.lock() else {
            orkestra_debug!(
                "commit",
                "failed to acquire API lock after commit for {} — will be recovered on restart",
                task_id
            );
            return;
        };

        let result = match commit_result {
            Ok(()) => api.commit_succeeded(&task_id),
            Err(e) => api.commit_failed(&task_id, &format!("Failed to commit agent changes: {e}")),
        };

        if let Err(e) = result {
            orkestra_debug!(
                "commit",
                "commit result recording failed for {}: {}",
                task_id,
                e
            );
        }
    }

    /// Advance tasks in Finished phase to the next stage.
    ///
    /// The output was already processed inline (during `handle_execution_complete`
    /// or human approval). The commit pipeline just committed the worktree changes.
    /// Now we complete the stage advancement.
    fn advance_committed_stages(&self) -> WorkflowResult<Vec<OrchestratorEvent>> {
        // Query DB directly (not snapshot) because:
        // 1. process_completed_executions may have created Finishing tasks after snapshot
        // 2. spawn_pending_commits bg threads transition Committing → Finished after snapshot
        // Acquiring the lock also blocks until any in-flight commit threads complete.
        let api = self.api.lock().map_err(|_| WorkflowError::Lock)?;
        let finished: Vec<_> = api
            .store
            .list_task_headers()?
            .into_iter()
            .filter(|h| h.phase == Phase::Finished)
            .collect();

        if finished.is_empty() {
            return Ok(Vec::new());
        }

        let mut events = Vec::new();

        for header in &finished {
            let task_id = header.id.clone();
            let stage = header.current_stage().unwrap_or("unknown").to_string();

            orkestra_debug!(
                "orchestrator",
                "advance_committed_stages {}/{}: advancing stage",
                task_id,
                stage,
            );

            match api.finalize_stage_advancement(&task_id) {
                Ok(updated) => {
                    let output_type = if updated.is_done() {
                        "done"
                    } else if updated.status.is_waiting_on_children() {
                        "subtasks"
                    } else {
                        "advanced"
                    };
                    events.push(OrchestratorEvent::OutputProcessed {
                        task_id,
                        stage,
                        output_type: output_type.to_string(),
                    });
                }
                Err(e) => {
                    events.push(OrchestratorEvent::Error {
                        task_id: Some(task_id),
                        error: e.to_string(),
                    });
                }
            }
        }

        Ok(events)
    }

    // ========================================================================
    // Recovery
    // ========================================================================

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
    fn recover_stale_integrations(&self, headers: &[TaskHeader]) -> Vec<OrchestratorEvent> {
        let mut events = Vec::new();

        let Ok(api) = self.api.lock() else {
            orkestra_debug!(
                "recovery",
                "Failed to acquire API lock for stale integration recovery"
            );
            return events;
        };

        for header in headers {
            if header.phase == Phase::Integrating && header.is_done() {
                orkestra_debug!("recovery", "Found stale Integrating task: {}", header.id);

                // Load full task for integration recovery (needs artifacts, branch info)
                let Ok(Some(task)) = api.store.get_task(&header.id) else {
                    orkestra_debug!(
                        "recovery",
                        "Failed to load task {} for integration recovery",
                        header.id
                    );
                    continue;
                };
                events.push(Self::recover_stale_task(&api, &task));
            }
        }

        events
    }

    /// Attempt to recover a single task stuck in `Integrating` phase.
    fn recover_stale_task(api: &WorkflowApi, task: &Task) -> OrchestratorEvent {
        // First check if the branch is already merged (handles both regular merges and PRs)
        if Self::is_branch_already_merged(api, task) {
            return Self::archive_already_merged_task(api, task);
        }

        // auto_merge disabled — return to choice point for user to retry.
        // Covers both failed PR creation and failed manual merge attempts.
        if !api.workflow.integration.auto_merge {
            orkestra_debug!(
                "recovery",
                "Task {} stuck in Integrating (auto_merge=false) — resetting to Done+Idle for retry",
                task.id
            );
            let mut reset_task = task.clone();
            reset_task.phase = Phase::Idle;
            if let Err(e) = api.store.save_task(&reset_task) {
                orkestra_debug!(
                    "recovery",
                    "Failed to reset task {} to Idle: {}",
                    task.id,
                    e
                );
            }
            return OrchestratorEvent::Error {
                task_id: Some(task.id.clone()),
                error: "Task was stuck in Integrating phase — reset to Done+Idle".into(),
            };
        }

        // Otherwise, this is a regular merge attempt - retry integration
        Self::reattempt_integration(api, task)
    }

    /// Archive a task whose branch is already merged into the target.
    fn archive_already_merged_task(api: &WorkflowApi, task: &Task) -> OrchestratorEvent {
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
                OrchestratorEvent::IntegrationCompleted {
                    task_id: task.id.clone(),
                }
            }
            Err(e) => {
                orkestra_debug!(
                    "recovery",
                    "Failed to archive already-merged task {}: {}",
                    task.id,
                    e
                );
                OrchestratorEvent::IntegrationFailed {
                    task_id: task.id.clone(),
                    error: e.to_string(),
                    conflict_files: vec![],
                }
            }
        }
    }

    /// Re-attempt full integration for a task whose branch is not yet merged.
    fn reattempt_integration(api: &WorkflowApi, task: &Task) -> OrchestratorEvent {
        match api.integrate_task(&task.id) {
            Ok(_) => {
                orkestra_debug!(
                    "recovery",
                    "Successfully recovered integration for {}",
                    task.id
                );
                OrchestratorEvent::IntegrationCompleted {
                    task_id: task.id.clone(),
                }
            }
            Err(e) => {
                orkestra_debug!("recovery", "Integration failed for {}: {}", task.id, e);

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
                        if let Err(e) = api.store.save_task(&reset_task) {
                            orkestra_debug!(
                                "integration",
                                "Failed to reset task {} phase: {}",
                                task.id,
                                e
                            );
                        }
                    }
                }

                OrchestratorEvent::IntegrationFailed {
                    task_id: task.id.clone(),
                    error: e.to_string(),
                    conflict_files: vec![],
                }
            }
        }
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
    fn is_branch_already_merged(api: &WorkflowApi, task: &Task) -> bool {
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
    fn recover_stale_setup_tasks(&self, headers: &[TaskHeader]) {
        let Ok(api) = self.api.lock() else {
            orkestra_debug!(
                "recovery",
                "Failed to acquire API lock for stale setup recovery"
            );
            return;
        };

        for header in headers {
            if header.phase != Phase::SettingUp {
                continue;
            }

            orkestra_debug!("recovery", "Recovering stale setup task: {}", header.id);

            // Clean up any partial worktree/branch from interrupted setup
            if let Some(ref git) = api.git_service {
                if let Err(e) = git.remove_worktree(&header.id, true) {
                    // Expected if worktree wasn't created yet
                    if !e.to_string().contains("not found")
                        && !e.to_string().contains("does not exist")
                    {
                        orkestra_debug!(
                            "recovery",
                            "WARNING: Failed to clean up partial worktree for {}: {}",
                            header.id,
                            e
                        );
                    }
                }
            }

            // Load full task to modify and save
            let Ok(Some(mut task)) = api.store.get_task(&header.id) else {
                orkestra_debug!(
                    "recovery",
                    "Failed to load task {} for setup recovery",
                    header.id
                );
                continue;
            };

            // Transition back to AwaitingSetup - orchestrator will re-trigger
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
    fn recover_stale_agent_working_tasks(&self, headers: &[TaskHeader]) {
        let Ok(api) = self.api.lock() else {
            orkestra_debug!(
                "recovery",
                "Failed to acquire API lock for stale agent recovery"
            );
            return;
        };

        for header in headers {
            if header.phase == Phase::AgentWorking {
                orkestra_debug!("recovery", "Found stale AgentWorking task: {}", header.id);

                // Load full task to modify and save
                let Ok(Some(mut task)) = api.store.get_task(&header.id) else {
                    orkestra_debug!(
                        "recovery",
                        "Failed to load task {} for agent recovery",
                        header.id
                    );
                    continue;
                };

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

    /// Recover tasks stuck in Committing phase (background thread died).
    ///
    /// Reset to Finishing so the next tick re-checks for uncommitted changes
    /// and re-spawns the commit thread. The commit is idempotent.
    fn recover_stale_committing_tasks(&self, headers: &[TaskHeader]) {
        let Ok(api) = self.api.lock() else {
            orkestra_debug!(
                "recovery",
                "Failed to acquire API lock for stale committing recovery"
            );
            return;
        };

        for header in headers {
            if header.phase == Phase::Committing {
                orkestra_debug!("recovery", "Found stale Committing task: {}", header.id);

                // Load full task to modify and save
                let Ok(Some(mut task)) = api.store.get_task(&header.id) else {
                    orkestra_debug!(
                        "recovery",
                        "Failed to load task {} for committing recovery",
                        header.id
                    );
                    continue;
                };

                task.phase = Phase::Finishing;

                if let Err(e) = api.store.save_task(&task) {
                    orkestra_debug!(
                        "recovery",
                        "Failed to reset stale task {} to Finishing: {}",
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

        let Ok(all_headers) = api.store.list_task_headers() else {
            orkestra_debug!(
                "recovery",
                "Failed to list task headers for orphaned worktree cleanup"
            );
            return;
        };

        let headers_by_id: HashMap<&str, &TaskHeader> =
            all_headers.iter().map(|h| (h.id.as_str(), h)).collect();

        for name in &worktree_names {
            let should_remove = match headers_by_id.get(name.as_str()) {
                None => {
                    orkestra_debug!("recovery", "Cleaning up orphaned worktree: {name}");
                    true
                }
                Some(header) if header.status.is_archived() && header.phase == Phase::Idle => {
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
    fn test_orchestrator_error_display() {
        let err = OrchestratorError::LockPoisoned;
        assert_eq!(err.to_string(), "Lock poisoned");

        let err = OrchestratorError::WorkflowError("test".into());
        assert!(err.to_string().contains("test"));
    }
}
