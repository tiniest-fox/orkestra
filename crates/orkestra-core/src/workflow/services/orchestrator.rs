//! Stage-agnostic orchestrator loop.
//!
//! The orchestrator is a reconciliation loop that:
//! 1. Polls for tasks needing agents
//! 2. Spawns agents for those tasks via TaskExecutionService
//! 3. Processes agent output when they complete
//!
//! It is driven by the workflow configuration and is stage-agnostic -
//! it doesn't know about specific stages like "planning" or "work".

use std::collections::HashSet;
use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::mpsc::TryRecvError;
use std::sync::{Arc, Mutex};
use std::time::Duration;

use crate::orkestra_debug;
use crate::workflow::adapters::{ClaudeProcessSpawner, FsCrashRecoveryStore};
use crate::workflow::config::WorkflowConfig;
use crate::workflow::execution::{AgentRunner, RunEvent, StageOutput};
use crate::workflow::ports::{CrashRecoveryStore, ProcessSpawner, WorkflowError, WorkflowResult, WorkflowStore};
use crate::workflow::runtime::{Phase, Status};

use super::task_execution::{ExecutionHandle, TaskExecutionService};
use super::{workflow_error, WorkflowApi};

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
    /// Pending output was recovered from crash.
    RecoveredPending {
        task_id: String,
        stage: String,
    },
    /// Error occurred during orchestration.
    Error {
        task_id: Option<String>,
        error: String,
    },
    /// Integration (merge to primary) started for a task.
    IntegrationStarted {
        task_id: String,
        branch: String,
    },
    /// Integration completed successfully.
    IntegrationCompleted {
        task_id: String,
    },
    /// Integration failed (e.g., merge conflict).
    IntegrationFailed {
        task_id: String,
        error: String,
        conflict_files: Vec<String>,
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
/// This orchestrator delegates all execution to TaskExecutionService.
/// It handles scheduling and event routing.
pub struct OrchestratorLoop {
    api: Arc<Mutex<WorkflowApi>>,
    executor: Arc<TaskExecutionService>,
    active_executions: Mutex<Vec<ExecutionHandle>>,
    /// Task IDs that were Done at the START of the previous tick.
    /// Only these tasks are eligible for integration, implementing a one-tick delay.
    /// This prevents integrating a task in the same tick where it became Done.
    ready_for_integration: Mutex<HashSet<String>>,
    stop_flag: Arc<AtomicBool>,
}

impl OrchestratorLoop {
    /// Create a new orchestrator loop.
    pub fn new(api: Arc<Mutex<WorkflowApi>>, executor: Arc<TaskExecutionService>) -> Self {
        Self {
            api,
            executor,
            active_executions: Mutex::new(Vec::new()),
            ready_for_integration: Mutex::new(HashSet::new()),
            stop_flag: Arc::new(AtomicBool::new(false)),
        }
    }

    /// Create with default components for a project.
    pub fn for_project(
        api: Arc<Mutex<WorkflowApi>>,
        workflow: WorkflowConfig,
        project_root: PathBuf,
        store: Arc<dyn WorkflowStore>,
    ) -> Self {
        let spawner: Arc<dyn ProcessSpawner> = Arc::new(ClaudeProcessSpawner::new());
        let runner = Arc::new(AgentRunner::new(spawner));
        let crash_recovery: Arc<dyn CrashRecoveryStore> =
            Arc::new(FsCrashRecoveryStore::from_project_root(&project_root));

        let executor = Arc::new(TaskExecutionService::new(
            runner,
            store,
            crash_recovery,
            workflow,
            project_root,
        ));

        Self::new(api, executor)
    }

    /// Create with a custom executor (for testing).
    pub fn with_executor(
        api: Arc<Mutex<WorkflowApi>>,
        executor: Arc<TaskExecutionService>,
    ) -> Self {
        Self::new(api, executor)
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

        // Recover stale integrations on startup (tasks stuck in Integrating phase)
        for event in self.recover_stale_integrations() {
            on_event(event);
        }

        // Recover pending outputs on startup
        for event in self.recover_pending() {
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

        // Phase 1: Process events from active executions
        // (This may transition tasks to Done)
        events.extend(self.process_active_executions()?);

        // Phase 2: Clean up completed executions
        self.cleanup_completed();

        // Phase 3: Start new executions for tasks needing agents
        events.extend(self.start_new_executions()?);

        // Phase 4: Start integrations for Done tasks (that were Done at end of PREVIOUS tick)
        events.extend(self.start_integrations()?);

        // Snapshot Done tasks AFTER agent processing.
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

    /// Process events from active executions.
    fn process_active_executions(&self) -> WorkflowResult<Vec<OrchestratorEvent>> {
        let mut events = Vec::new();
        let executions = self.active_executions.lock().map_err(|_| WorkflowError::Lock)?;

        for handle in executions.iter() {
            loop {
                match handle.events.try_recv() {
                    Ok(event) => {
                        // Handle errors per-task, don't let one task's error stop others
                        match self.handle_execution_event(
                            &handle.task_id,
                            &handle.stage,
                            event,
                        ) {
                            Ok(Some(e)) => events.push(e),
                            Ok(None) => {}
                            Err(e) => {
                                // Convert error to error event instead of propagating
                                events.push(OrchestratorEvent::Error {
                                    task_id: Some(handle.task_id.clone()),
                                    error: e.to_string(),
                                });
                            }
                        }
                    }
                    Err(TryRecvError::Empty) => break,
                    Err(TryRecvError::Disconnected) => break,
                }
            }
        }

        Ok(events)
    }

    /// Handle an event from an execution.
    fn handle_execution_event(
        &self,
        task_id: &str,
        stage: &str,
        event: RunEvent,
    ) -> WorkflowResult<Option<OrchestratorEvent>> {
        match event {
            RunEvent::RawOutputReady(_) => {
                self.executor.handle_event(task_id, stage, event)?;
                Ok(None)
            }
            RunEvent::Completed(ref result) => {
                let is_err = result.is_err();
                let err_msg = result.as_ref().err().cloned();

                orkestra_debug!(
                    "orchestrator",
                    "handle_execution_event {}/{}: completed, is_err={}",
                    task_id,
                    stage,
                    is_err
                );

                let output = self.executor.handle_event(task_id, stage, event)?;

                if let Some(output) = output {
                    let output_type = output_type_string(&output);
                    orkestra_debug!(
                        "orchestrator",
                        "process_agent_output {}/{}: type={}",
                        task_id,
                        stage,
                        output_type
                    );
                    let api = self.api.lock().map_err(|_| WorkflowError::Lock)?;
                    match api.process_agent_output(task_id, output) {
                        Ok(_) => Ok(Some(OrchestratorEvent::OutputProcessed {
                            task_id: task_id.to_string(),
                            stage: stage.to_string(),
                            output_type,
                        })),
                        Err(e) => {
                            // Handle invalid output gracefully (e.g., invalid restage)
                            Ok(Some(OrchestratorEvent::Error {
                                task_id: Some(task_id.to_string()),
                                error: e.to_string(),
                            }))
                        }
                    }
                } else if is_err {
                    let error = err_msg.unwrap_or_else(|| "Unknown error".to_string());
                    // Try to mark task as failed, but don't propagate errors.
                    // Even if this fails, we still want to report the error event.
                    if let Ok(api) = self.api.lock() {
                        if let Err(e) = api.process_agent_output(
                            task_id,
                            StageOutput::Failed {
                                error: format!("Agent error: {error}"),
                            },
                        ) {
                            eprintln!("[orkestra] ERROR: Failed to mark task {} as failed: {}", task_id, e);
                        }
                    }
                    Ok(Some(OrchestratorEvent::Error {
                        task_id: Some(task_id.to_string()),
                        error,
                    }))
                } else {
                    Ok(None)
                }
            }
        }
    }

    /// Clean up completed executions.
    fn cleanup_completed(&self) {
        match self.active_executions.lock() {
            Ok(mut executions) => {
                executions.retain(|h| !h.is_complete());
            }
            Err(_) => {
                workflow_error!("Failed to lock active_executions during cleanup (mutex poisoned)");
            }
        }
    }

    /// Start new executions for tasks needing agents.
    fn start_new_executions(&self) -> WorkflowResult<Vec<OrchestratorEvent>> {
        let mut events = Vec::new();

        let active_task_ids: Vec<String> = {
            let executions = self.active_executions.lock().map_err(|_| WorkflowError::Lock)?;
            executions.iter().map(|h| h.task_id.clone()).collect()
        };

        let tasks = {
            let api = self.api.lock().map_err(|_| WorkflowError::Lock)?;
            api.get_tasks_needing_agents()?
        };

        orkestra_debug!(
            "orchestrator",
            "start_new_executions: {} tasks needing agents, {} active",
            tasks.len(),
            active_task_ids.len()
        );

        for task in tasks {
            // Skip if we already have an active execution for this task
            if active_task_ids.contains(&task.id) {
                continue;
            }

            orkestra_debug!(
                "orchestrator",
                "starting execution for {} in stage {:?}",
                task.id,
                task.current_stage()
            );

            {
                let api = self.api.lock().map_err(|_| WorkflowError::Lock)?;
                api.agent_started(&task.id)?;
            }

            match self.executor.execute_stage(&task, None, None) {
                Ok(handle) => {
                    let event = OrchestratorEvent::AgentSpawned {
                        task_id: handle.task_id.clone(),
                        stage: handle.stage.clone(),
                        pid: handle.pid,
                    };

                    match self.active_executions.lock() {
                        Ok(mut executions) => {
                            executions.push(handle);
                        }
                        Err(_) => {
                            workflow_error!(
                                "Failed to track execution for {}/{} (mutex poisoned) - agent process will be orphaned",
                                handle.task_id, handle.stage
                            );
                        }
                    }

                    events.push(event);
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
        let ready = self.ready_for_integration.lock().map_err(|_| WorkflowError::Lock)?;
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
            eprintln!("[recovery] Failed to acquire API lock for stale integration recovery");
            return events;
        };

        let Ok(tasks) = api.store.list_tasks() else {
            eprintln!("[recovery] Failed to list tasks for stale integration recovery");
            return events;
        };

        for task in tasks {
            if task.phase == Phase::Integrating && task.is_done() {
                eprintln!("[recovery] Found stale Integrating task: {}", task.id);

                // Re-attempt integration
                match api.integrate_task(&task.id) {
                    Ok(_) => {
                        eprintln!("[recovery] Successfully recovered integration for {}", task.id);
                        events.push(OrchestratorEvent::IntegrationCompleted {
                            task_id: task.id.clone(),
                        });
                    }
                    Err(e) => {
                        eprintln!("[recovery] Integration failed for {}: {}", task.id, e);

                        // integration_failed() should have moved task to recovery stage.
                        // Verify the task is no longer stuck in Integrating phase.
                        if let Ok(updated_task) = api.get_task(&task.id) {
                            if updated_task.phase == Phase::Integrating {
                                // Fallback: reset phase to Idle so orchestrator can retry later
                                eprintln!("[recovery] Task {} still in Integrating phase, resetting to Idle", task.id);
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

    /// Recover tasks stuck in SettingUp phase (from app crash during setup).
    ///
    /// Tasks that were being set up when the app crashed will be stuck in SettingUp.
    /// We mark them as Failed since the setup was interrupted and cannot be resumed.
    /// Any partially-created worktrees are cleaned up.
    fn recover_stale_setup_tasks(&self) {
        let Ok(api) = self.api.lock() else {
            eprintln!("[recovery] Failed to acquire API lock for stale setup recovery");
            return;
        };

        // Use store.list_tasks() directly to get ALL tasks including subtasks
        // (api.list_tasks() filters out subtasks)
        let Ok(tasks) = api.store.list_tasks() else {
            eprintln!("[recovery] Failed to list tasks for stale setup recovery");
            return;
        };

        for task in tasks {
            if task.phase == Phase::SettingUp {
                eprintln!("[recovery] Found stale SettingUp task: {}", task.id);

                // Only clean up worktrees for parent tasks (subtasks don't own worktrees)
                if task.parent_id.is_none() {
                    if let Some(ref git) = api.git_service {
                        // Try to remove worktree - it may or may not exist depending on when crash occurred
                        if let Err(e) = git.remove_worktree(&task.id, true) {
                            // This is expected if worktree wasn't created yet, only warn for unexpected errors
                            if !e.to_string().contains("not found") && !e.to_string().contains("does not exist") {
                                eprintln!("[recovery] WARNING: Failed to clean up worktree for {}: {}", task.id, e);
                            }
                        }
                    }
                }

                let mut task = task;
                task.status = Status::Failed {
                    error: Some("Setup interrupted by app restart - please delete and recreate task".into()),
                };
                task.phase = Phase::Idle;

                // Only clear worktree info for parent tasks that own their worktrees.
                // Subtasks inherit parent's worktree and shouldn't have it cleared.
                if task.parent_id.is_none() {
                    task.worktree_path = None;
                    task.branch_name = None;
                }

                if let Err(e) = api.store.save_task(&task) {
                    eprintln!("[recovery] Failed to mark stale task {} as failed: {}", task.id, e);
                }
            }
        }
    }

    /// Recover pending outputs from crash.
    fn recover_pending(&self) -> Vec<OrchestratorEvent> {
        let mut events = Vec::new();

        let pending = self.executor.recover_pending();
        orkestra_debug!("recovery", "recover_pending: found {} pending outputs", pending.len());

        for recovered in pending {
            orkestra_debug!(
                "recovery",
                "recovering {}_{}: result_is_ok={}",
                recovered.task_id,
                recovered.stage,
                recovered.result.is_ok()
            );

            match recovered.result {
                Ok(output) => {
                    if let Ok(api) = self.api.lock() {
                        match api.process_agent_output(&recovered.task_id, output) {
                            Ok(_) => {
                                orkestra_debug!(
                                    "recovery",
                                    "recovered {}_{}: success",
                                    recovered.task_id,
                                    recovered.stage
                                );
                                if let Err(e) = self.executor.clear_pending(&recovered.task_id, &recovered.stage) {
                                    eprintln!("[orkestra] WARNING: Failed to clear pending for {}/{}: {}", recovered.task_id, recovered.stage, e);
                                }
                                events.push(OrchestratorEvent::RecoveredPending {
                                    task_id: recovered.task_id,
                                    stage: recovered.stage,
                                });
                            }
                            Err(e) => {
                                orkestra_debug!(
                                    "recovery",
                                    "recovered {}_{}: process_agent_output failed: {}",
                                    recovered.task_id,
                                    recovered.stage,
                                    e
                                );
                                events.push(OrchestratorEvent::Error {
                                    task_id: Some(recovered.task_id),
                                    error: format!("Failed to process recovered output: {e}"),
                                });
                            }
                        }
                    }
                }
                Err(e) => {
                    orkestra_debug!(
                        "recovery",
                        "recovered {}_{}: parse failed: {}",
                        recovered.task_id,
                        recovered.stage,
                        e
                    );
                    events.push(OrchestratorEvent::Error {
                        task_id: Some(recovered.task_id),
                        error: format!("Failed to parse recovered output: {e}"),
                    });
                }
            }
        }

        events
    }

    /// Get count of active executions.
    pub fn active_count(&self) -> usize {
        self.active_executions
            .lock()
            .map(|e| e.len())
            .unwrap_or(0)
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
    use crate::workflow::ports::InMemoryCrashRecoveryStore;

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
            Arc::new(InMemoryWorkflowStore::new()),
        )));

        let spawner: Arc<dyn ProcessSpawner> = Arc::new(ClaudeProcessSpawner::new());
        let runner = Arc::new(AgentRunner::new(spawner));
        let crash_recovery: Arc<dyn CrashRecoveryStore> = Arc::new(InMemoryCrashRecoveryStore::new());
        let executor = Arc::new(TaskExecutionService::new(
            runner,
            store,
            crash_recovery,
            workflow,
            PathBuf::from("/tmp"),
        ));

        OrchestratorLoop::new(api, executor)
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
        assert_eq!(output_type_string(&StageOutput::Failed { error: "err".into() }), "failed");
        assert_eq!(output_type_string(&StageOutput::Artifact { content: "test".into() }), "artifact");
    }

    #[test]
    fn test_orchestrator_error_display() {
        let err = OrchestratorError::LockPoisoned;
        assert_eq!(err.to_string(), "Lock poisoned");

        let err = OrchestratorError::WorkflowError("test".into());
        assert!(err.to_string().contains("test"));
    }
}
