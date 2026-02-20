//! Stage-agnostic orchestrator loop.
//!
//! The orchestrator is a thin sequencer that runs a reconciliation loop:
//! 1. Dispatches to domain interactions for business logic decisions
//! 2. Handles I/O plumbing: lock management, thread spawning, event collection
//! 3. Does not contain business logic itself — that lives in interactions
//!
//! Each tick phase delegates to an interaction in the appropriate domain:
//! - `task::setup_awaiting` — set up tasks whose deps are satisfied
//! - `stage::check_parent_completions` — advance parents when subtasks done
//! - `agent::dispatch_completion` — route completed executions
//! - `stage::collect_commit_jobs` / `advance_all_committed` — commit pipeline
//! - `task::find_spawn_candidates` — filter tasks ready for agents
//! - `integration::find_next_candidate` — pick next task to integrate

mod commit_pipeline;
mod recovery;

use std::collections::HashSet;
use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::time::Duration;

use super::periodic::PeriodicScheduler;

use crate::orkestra_debug;
use crate::workflow::agent::interactions as agent_interactions;
use crate::workflow::api::WorkflowApi;
use crate::workflow::config::WorkflowConfig;
use crate::workflow::domain::{Task, TaskHeader, TickSnapshot};
use crate::workflow::integration::interactions as integration_interactions;
use crate::workflow::ports::{GitService, WorkflowError, WorkflowResult, WorkflowStore};
use crate::workflow::runtime::TaskState;
use crate::workflow::stage::interactions as stage_interactions;
use crate::workflow::stage::service::StageExecutionService;
use crate::workflow::task::interactions as task_interactions;

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
/// A thin sequencer that dispatches to domain interactions for decisions
/// and handles I/O plumbing: lock management, thread spawning, event collection.
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
    /// Each phase delegates to a domain interaction for business logic,
    /// then the orchestrator handles I/O plumbing (locks, threads, events).
    pub fn tick(&self) -> WorkflowResult<Vec<OrchestratorEvent>> {
        let mut events = Vec::new();
        let mut defer_spawn_ids = HashSet::new();

        // Load + categorize once
        let snapshot = self.build_snapshot()?;

        // Setup tasks whose dependencies are satisfied
        {
            let api = self.api.lock().map_err(|_| WorkflowError::Lock)?;
            defer_spawn_ids.extend(task_interactions::setup_awaiting::execute(
                api.store.as_ref(),
                &api.setup_service,
                &snapshot,
            )?);
        }

        // Advance parents whose subtasks all completed
        {
            let api = self.api.lock().map_err(|_| WorkflowError::Lock)?;
            events.extend(stage_interactions::check_parent_completions::execute(
                &api, &snapshot,
            )?);
        }

        // Process completed agent/script executions
        for exec in self.stage_executor.poll_active() {
            let api = self.api.lock().map_err(|_| WorkflowError::Lock)?;
            events.push(agent_interactions::dispatch_completion::execute(
                &api, exec,
            )?);
        }

        // Commit pipeline: queries DB directly (not snapshot) because
        // process_completed_executions can create Finishing tasks after snapshot
        self.spawn_pending_commits()?;
        let advance_events = {
            let api = self.api.lock().map_err(|_| WorkflowError::Lock)?;
            stage_interactions::advance_all_committed::execute(&api, api.store.as_ref())?
        };
        let state_changed = !advance_events.is_empty();
        for event in &advance_events {
            if let OrchestratorEvent::OutputProcessed { task_id, .. } = event {
                defer_spawn_ids.insert(task_id.clone());
            }
        }
        events.extend(advance_events);

        // Refresh snapshot if the commit pipeline mutated state
        let snapshot = if state_changed {
            self.build_snapshot()?
        } else {
            snapshot
        };

        // Start agents/scripts for ready tasks
        let active_task_ids = self.stage_executor.active_task_ids();
        let candidates = task_interactions::find_spawn_candidates::execute(
            &snapshot,
            &defer_spawn_ids,
            &active_task_ids,
        );
        self.spawn_executions(&candidates, &mut events)?;

        // Integrate next done task (one at a time)
        let auto_merge = {
            let api = self.api.lock().map_err(|_| WorkflowError::Lock)?;
            api.workflow.integration.auto_merge
        };
        if let Some(candidate) =
            integration_interactions::find_next_candidate::execute(&snapshot, auto_merge)
        {
            self.start_integration(candidate, &mut events)?;
        }

        // Periodic maintenance
        let due = {
            let mut scheduler = self.scheduler.lock().map_err(|_| WorkflowError::Lock)?;
            scheduler.poll_due()
        };
        for name in due {
            if name == "cleanup_worktrees" {
                let Some(git) = self.git_service.clone() else {
                    continue;
                };
                let store = {
                    let api = self.api.lock().map_err(|_| WorkflowError::Lock)?;
                    Arc::clone(&api.store)
                }; // mutex released — git subprocesses run off the lock

                let run = move || {
                    task_interactions::cleanup_orphaned_worktrees::execute(
                        store.as_ref(),
                        git.as_ref(),
                    );
                };

                if self.sync_background {
                    run();
                } else {
                    std::thread::spawn(run);
                }
            }
        }

        // In sync mode, drain any active executions so they complete within this tick
        if self.sync_background {
            for exec in self.stage_executor.drain_active() {
                let api = self.api.lock().map_err(|_| WorkflowError::Lock)?;
                events.push(agent_interactions::dispatch_completion::execute(
                    &api, exec,
                )?);
            }
            self.spawn_pending_commits()?;
            let api = self.api.lock().map_err(|_| WorkflowError::Lock)?;
            events.extend(stage_interactions::advance_all_committed::execute(
                &api,
                api.store.as_ref(),
            )?);
        }

        Ok(events)
    }

    /// Get count of active executions.
    pub fn active_count(&self) -> usize {
        self.stage_executor.active_count()
    }

    // -- Plumbing --

    /// Build a `TickSnapshot` from the current store state.
    fn build_snapshot(&self) -> WorkflowResult<TickSnapshot> {
        let api = self.api.lock().map_err(|_| WorkflowError::Lock)?;
        let headers = api.store.list_task_headers()?;
        Ok(TickSnapshot::build(headers))
    }

    /// Spawn executions for ready candidates.
    ///
    /// Loads full tasks, marks them as working, and spawns via the stage executor.
    fn spawn_executions(
        &self,
        candidates: &[&TaskHeader],
        events: &mut Vec<OrchestratorEvent>,
    ) -> WorkflowResult<()> {
        if candidates.is_empty() {
            return Ok(());
        }

        orkestra_debug!(
            "orchestrator",
            "start_new_executions: {} tasks needing execution, {} active",
            candidates.len(),
            self.stage_executor.active_count()
        );

        for header in candidates {
            let current_stage = header.current_stage().unwrap_or("unknown");
            orkestra_debug!(
                "orchestrator",
                "starting execution for {} in stage {:?}",
                header.id,
                header.current_stage()
            );

            // Load full task (with artifacts) for spawning
            let task = {
                let api = self.api.lock().map_err(|_| WorkflowError::Lock)?;
                match api.store.get_task(&header.id)? {
                    Some(t) => t,
                    None => continue,
                }
            };

            // Get incoming context from active iteration
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

        Ok(())
    }

    // -- PR Creation --

    /// Spawn a background PR creation thread for a task that is already marked Integrating.
    pub fn spawn_pr_creation(&self, task: &Task) -> WorkflowResult<()> {
        let api = self.api.lock().map_err(|_| WorkflowError::Lock)?;
        let task = task.clone();
        let pr_description_generator = Arc::clone(&api.pr_description_generator);
        let pr_service = api
            .pr_service
            .clone()
            .ok_or_else(|| WorkflowError::GitError("No PR service configured".into()))?;

        let model_names =
            crate::commit_message::collect_model_names(&api.workflow, task.flow.as_deref());
        drop(api);

        let git = self
            .git_service
            .clone()
            .ok_or_else(|| WorkflowError::GitError("No git service configured".into()))?;
        let api_clone = Arc::clone(&self.api);

        let run = move || {
            crate::workflow::integration::pr_creation::run_pr_creation(
                git,
                pr_service,
                pr_description_generator,
                api_clone,
                task,
                model_names,
            );
        };

        if self.sync_background {
            run();
        } else {
            std::thread::spawn(run);
        }
        Ok(())
    }

    // -- Integration --

    /// Start integration for a candidate task.
    ///
    /// Marks the task as integrating, then either records immediate success
    /// (no git) or spawns a background thread for git merge.
    fn start_integration(
        &self,
        header: &TaskHeader,
        events: &mut Vec<OrchestratorEvent>,
    ) -> WorkflowResult<()> {
        let task_id = header.id.clone();
        let branch = header.branch_name.clone().unwrap_or_default();

        // Acquire lock to mark as integrating and read full task
        let api = self.api.lock().map_err(|_| WorkflowError::Lock)?;
        let Some(task) = api.store.get_task(&task_id)? else {
            return Ok(());
        };

        // Mark as integrating (requires TaskState::Done, prevents double-processing)
        if let Err(e) = api.mark_integrating(&task_id) {
            events.push(OrchestratorEvent::Error {
                task_id: Some(task_id),
                error: format!("Failed to mark task as integrating: {e}"),
            });
            return Ok(());
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
            return Ok(());
        }

        if task.base_branch.is_empty() {
            let mut reset_task = api.get_task(&task_id)?;
            reset_task.state = TaskState::Done;
            if let Err(e) = api.store.save_task(&reset_task) {
                orkestra_debug!(
                    "integration",
                    "Failed to reset task {} state: {}",
                    task_id,
                    e
                );
            }
            events.push(OrchestratorEvent::Error {
                task_id: Some(task_id),
                error: "Task has no base_branch set — cannot determine merge target".into(),
            });
            return Ok(());
        }

        // Gather inputs for background thread while holding lock
        let task = task.clone();
        let workflow = api.workflow.clone();
        let commit_message_generator = Arc::clone(&api.commit_message_generator);

        // Release the API lock before spawning the background thread
        drop(api);

        events.push(OrchestratorEvent::IntegrationStarted {
            task_id: task_id.clone(),
            branch: branch.clone(),
        });

        let git = self.git_service.clone().expect("git_service checked above");
        let api_clone = Arc::clone(&self.api);

        let run_integration = move || {
            crate::workflow::integration::merge::run_integration(
                git,
                api_clone,
                commit_message_generator,
                task,
                workflow,
            );
        };

        if self.sync_background {
            run_integration();
        } else {
            std::thread::spawn(run_integration);
        }

        Ok(())
    }
}

// ============================================================================
// Tests
// ============================================================================

#[cfg(test)]
mod tests {
    use super::*;
    use crate::workflow::adapters::InMemoryWorkflowStore;
    use crate::workflow::config::StageConfig;

    fn test_workflow() -> WorkflowConfig {
        WorkflowConfig::new(vec![
            StageConfig::new("planning", "plan"),
            StageConfig::new("work", "summary"),
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
