//! Stage-agnostic orchestrator loop.
//!
//! The orchestrator is a reconciliation loop that:
//! 1. Polls for tasks needing execution
//! 2. Spawns executions (agents or scripts) via `StageExecutionService`
//! 3. Processes output when executions complete
//!
//! It is driven by the workflow configuration and is stage-agnostic -
//! it doesn't know about specific stages like "planning" or "work".

use std::collections::HashSet;
use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::time::Duration;

use crate::orkestra_debug;
use crate::workflow::config::WorkflowConfig;
use crate::workflow::execution::StageOutput;
use crate::workflow::ports::{WorkflowError, WorkflowResult, WorkflowStore};
use crate::workflow::runtime::{Phase, Status};

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
    /// Task IDs that were Done at the START of the previous tick.
    /// Only these tasks are eligible for integration, implementing a one-tick delay.
    /// This prevents integrating a task in the same tick where it became Done.
    ready_for_integration: Mutex<HashSet<String>>,
    stop_flag: Arc<AtomicBool>,
}

impl OrchestratorLoop {
    /// Create a new orchestrator loop.
    pub fn new(api: Arc<Mutex<WorkflowApi>>, stage_executor: Arc<StageExecutionService>) -> Self {
        Self {
            api,
            stage_executor,
            ready_for_integration: Mutex::new(HashSet::new()),
            stop_flag: Arc::new(AtomicBool::new(false)),
        }
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
    pub fn run<F>(&self, mut on_event: F)
    where
        F: FnMut(OrchestratorEvent) + Send,
    {
        // Recover stale setup tasks on startup (tasks stuck in SettingUp phase)
        self.recover_stale_setup_tasks();

        // Recover stale agent working tasks on startup (tasks stuck in AgentWorking phase)
        self.recover_stale_agent_working_tasks();

        // Clean up orphaned worktrees (from deleted tasks where git cleanup was deferred)
        self.cleanup_orphaned_worktrees();

        // Recover stale integrations on startup (tasks stuck in Integrating phase)
        for event in self.recover_stale_integrations() {
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

            std::thread::sleep(Duration::from_millis(100));
        }
    }

    /// Run a single tick of the orchestration loop.
    pub fn tick(&self) -> WorkflowResult<Vec<OrchestratorEvent>> {
        let mut events = Vec::new();

        // Phase 1: Process completed executions (agents and scripts)
        events.extend(self.process_completed_executions()?);

        // Phase 2: Start new executions for tasks needing agents or scripts
        events.extend(self.start_new_executions()?);

        // Phase 3: Start integrations for Done tasks (that were Done at end of PREVIOUS tick)
        events.extend(self.start_integrations()?);

        // Snapshot Done tasks AFTER processing.
        // Tasks that became Done this tick will be eligible for integration
        // on the NEXT tick (one-tick delay).
        let current_done_tasks: HashSet<String> = {
            let api = self.api.lock().map_err(|_| WorkflowError::Lock)?;
            api.get_tasks_needing_integration()?
                .into_iter()
                .map(|t| t.id)
                .collect()
        };

        // Update ready_for_integration for next tick
        if let Ok(mut ready) = self.ready_for_integration.lock() {
            *ready = current_done_tasks;
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
            ExecutionResult::AgentFailed(error) => {
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
            ExecutionResult::PollError { error } => Ok(OrchestratorEvent::Error {
                task_id: Some(exec.task_id),
                error,
            }),
        }
    }

    /// Start new executions for tasks needing agents or scripts.
    fn start_new_executions(&self) -> WorkflowResult<Vec<OrchestratorEvent>> {
        let mut events = Vec::new();

        let tasks = {
            let api = self.api.lock().map_err(|_| WorkflowError::Lock)?;
            api.get_tasks_needing_agents()?
        };

        if !tasks.is_empty() || self.stage_executor.active_count() > 0 {
            orkestra_debug!(
                "orchestrator",
                "start_new_executions: {} tasks needing execution, {} active",
                tasks.len(),
                self.stage_executor.active_count()
            );
        }

        for task in tasks {
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

            // Get incoming context from active iteration (for agent stages)
            let trigger = {
                let api = self.api.lock().map_err(|_| WorkflowError::Lock)?;
                api.store
                    .get_active_iteration(&task.id, current_stage)?
                    .and_then(|iter| iter.incoming_context)
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
                    events.push(OrchestratorEvent::Error {
                        task_id: Some(task.id.clone()),
                        error: e.to_string(),
                    });
                }
            }
        }

        Ok(events)
    }

    /// Start integrations for Done tasks that need merging.
    ///
    /// Only processes one task per tick to avoid concurrent merge issues.
    /// Integration is synchronous but fast (~100ms for git merge).
    ///
    /// Uses a one-tick delay: only tasks that were Done at the END of the
    /// PREVIOUS tick are eligible. This prevents integrating a task in the
    /// same tick where it became Done.
    fn start_integrations(&self) -> WorkflowResult<Vec<OrchestratorEvent>> {
        let mut events = Vec::new();

        // Get tasks eligible for integration (were Done at end of previous tick)
        let ready = self
            .ready_for_integration
            .lock()
            .map_err(|_| WorkflowError::Lock)?;
        if ready.is_empty() {
            return Ok(events);
        }

        // Hold API lock for entire operation to ensure consistent state
        let api = self.api.lock().map_err(|_| WorkflowError::Lock)?;

        // Get current Done tasks and filter to those that were ready last tick
        let tasks: Vec<_> = api
            .get_tasks_needing_integration()?
            .into_iter()
            .filter(|t| ready.contains(&t.id))
            .collect();
        drop(ready); // Release ready lock, keep API lock

        // Only integrate one task per tick to avoid concurrent merge issues
        let Some(task) = tasks.first() else {
            return Ok(events);
        };

        let task_id = task.id.clone();
        let branch = task.branch_name.clone().unwrap_or_default();

        // Mark as integrating (prevents double-processing)
        if let Err(e) = api.mark_integrating(&task_id) {
            return Ok(vec![OrchestratorEvent::Error {
                task_id: Some(task_id),
                error: format!("Failed to mark task as integrating: {e}"),
            }]);
        }

        events.push(OrchestratorEvent::IntegrationStarted {
            task_id: task_id.clone(),
            branch: branch.clone(),
        });

        // Perform the integration (synchronous but fast)
        match api.integrate_task(&task_id) {
            Ok(_task) => {
                events.push(OrchestratorEvent::IntegrationCompleted {
                    task_id: task_id.clone(),
                });
            }
            Err(e) => {
                // integration_failed() is called internally by integrate_task on conflict,
                // so the task is already moved to recovery stage
                events.push(OrchestratorEvent::IntegrationFailed {
                    task_id: task_id.clone(),
                    error: e.to_string(),
                    conflict_files: vec![], // Conflict files are in the iteration record
                });
            }
        }

        Ok(events)
    }

    /// Recover tasks stuck in Integrating phase (from app crash during merge).
    ///
    /// Tasks that were being integrated when the app crashed will be stuck in Integrating.
    /// We re-attempt the integration since merge operations are idempotent (git handles
    /// already-merged branches gracefully).
    ///
    /// On failure, the task is moved back to recovery stage by `integration_failed()`.
    /// As a fallback, if that fails, we reset the phase to Idle so the task can be retried.
    fn recover_stale_integrations(&self) -> Vec<OrchestratorEvent> {
        let mut events = Vec::new();

        let Ok(api) = self.api.lock() else {
            orkestra_debug!("recovery", "Failed to acquire API lock for stale integration recovery");
            return events;
        };

        let Ok(tasks) = api.store.list_tasks() else {
            orkestra_debug!("recovery", "Failed to list tasks for stale integration recovery");
            return events;
        };

        for task in tasks {
            if task.phase == Phase::Integrating && task.is_done() {
                orkestra_debug!("recovery", "Found stale Integrating task: {}", task.id);

                // Re-attempt integration
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
                        orkestra_debug!("recovery", "Integration failed for {}: {}", task.id, e);

                        // integration_failed() should have moved task to recovery stage.
                        // Verify the task is no longer stuck in Integrating phase.
                        if let Ok(updated_task) = api.get_task(&task.id) {
                            if updated_task.phase == Phase::Integrating {
                                // Fallback: reset phase to Idle so orchestrator can retry later
                                orkestra_debug!("recovery", "Task {} still in Integrating phase, resetting to Idle", task.id);
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

        events
    }

    /// Recover tasks stuck in `SettingUp` phase (from app crash during setup).
    ///
    /// Tasks that were being set up when the app crashed will be stuck in `SettingUp`.
    /// We mark them as Failed since the setup was interrupted and cannot be resumed.
    /// Any partially-created worktrees are cleaned up.
    fn recover_stale_setup_tasks(&self) {
        let Ok(api) = self.api.lock() else {
            orkestra_debug!("recovery", "Failed to acquire API lock for stale setup recovery");
            return;
        };

        // Use store.list_tasks() directly to get ALL tasks including subtasks
        // (api.list_tasks() filters out subtasks)
        let Ok(tasks) = api.store.list_tasks() else {
            orkestra_debug!("recovery", "Failed to list tasks for stale setup recovery");
            return;
        };

        for task in tasks {
            if task.phase == Phase::SettingUp {
                orkestra_debug!("recovery", "Found stale SettingUp task: {}", task.id);

                // Only clean up worktrees for parent tasks (subtasks don't own worktrees)
                if task.parent_id.is_none() {
                    if let Some(ref git) = api.git_service {
                        // Try to remove worktree - it may or may not exist depending on when crash occurred
                        if let Err(e) = git.remove_worktree(&task.id, true) {
                            // This is expected if worktree wasn't created yet, only warn for unexpected errors
                            if !e.to_string().contains("not found")
                                && !e.to_string().contains("does not exist")
                            {
                                orkestra_debug!(
                                    "recovery",
                                    "WARNING: Failed to clean up worktree for {}: {}",
                                    task.id, e
                                );
                            }
                        }
                    }
                }

                let mut task = task;
                task.status = Status::Failed {
                    error: Some(
                        "Setup interrupted by app restart - please delete and recreate task".into(),
                    ),
                };
                task.phase = Phase::Idle;

                // Only clear worktree info for parent tasks that own their worktrees.
                // Subtasks inherit parent's worktree and shouldn't have it cleared.
                if task.parent_id.is_none() {
                    task.worktree_path = None;
                    task.branch_name = None;
                }

                if let Err(e) = api.store.save_task(&task) {
                    orkestra_debug!(
                        "recovery",
                        "Failed to mark stale task {} as failed: {}",
                        task.id, e
                    );
                }
            }
        }
    }

    /// Recover tasks stuck in `AgentWorking` phase (from app crash during agent run).
    ///
    /// Tasks that had an agent running when the app crashed will be stuck in `AgentWorking`.
    /// We reset them to Idle so the orchestrator can respawn the agent.
    fn recover_stale_agent_working_tasks(&self) {
        let Ok(api) = self.api.lock() else {
            orkestra_debug!("recovery", "Failed to acquire API lock for stale agent recovery");
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
                        task.id, e
                    );
                }
            }
        }
    }

    /// Clean up orphaned worktrees from deleted tasks.
    ///
    /// When tasks are deleted, only DB records are removed (fast path). Git worktrees
    /// are left on disk and cleaned up here on next startup. A worktree is orphaned
    /// if its directory name (task ID) has no matching task in the database.
    fn cleanup_orphaned_worktrees(&self) {
        let Ok(api) = self.api.lock() else {
            orkestra_debug!("recovery", "Failed to acquire API lock for orphaned worktree cleanup");
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
            orkestra_debug!("recovery", "Failed to list tasks for orphaned worktree cleanup");
            return;
        };

        let task_ids: HashSet<&str> = all_tasks.iter().map(|t| t.id.as_str()).collect();

        for name in &worktree_names {
            if !task_ids.contains(name.as_str()) {
                orkestra_debug!("recovery", "Cleaning up orphaned worktree: {name}");
                if let Err(e) = git.remove_worktree(name, true) {
                    orkestra_debug!("recovery", "Failed to clean up orphaned worktree {name}: {}", e);
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
        StageOutput::Restage { .. } => "restage".to_string(),
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
