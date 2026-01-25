//! Stage-agnostic orchestrator loop.
//!
//! The orchestrator is a reconciliation loop that:
//! 1. Polls for tasks needing agents
//! 2. Spawns agents for those tasks via TaskExecutionService
//! 3. Processes agent output when they complete
//!
//! It is driven by the workflow configuration and is stage-agnostic -
//! it doesn't know about specific stages like "planning" or "work".

use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::mpsc::TryRecvError;
use std::sync::{Arc, Mutex};
use std::time::Duration;

use crate::workflow::adapters::{ClaudeProcessSpawner, FsCrashRecoveryStore};
use crate::workflow::config::WorkflowConfig;
use crate::workflow::execution::{AgentRunner, RunEvent, StageOutput};
use crate::workflow::ports::{CrashRecoveryStore, ProcessSpawner, WorkflowError, WorkflowResult, WorkflowStore};

use super::task_execution::{ExecutionHandle, TaskExecutionService};
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
    /// Session ID was captured from agent output.
    SessionIdCaptured {
        task_id: String,
        stage: String,
        session_id: String,
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
    stop_flag: Arc<AtomicBool>,
}

impl OrchestratorLoop {
    /// Create a new orchestrator loop.
    pub fn new(api: Arc<Mutex<WorkflowApi>>, executor: Arc<TaskExecutionService>) -> Self {
        Self {
            api,
            executor,
            active_executions: Mutex::new(Vec::new()),
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
        events.extend(self.process_active_executions()?);

        // Phase 2: Clean up completed executions
        self.cleanup_completed();

        // Phase 3: Start new executions for tasks needing agents
        events.extend(self.start_new_executions()?);

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
            RunEvent::SessionIdCaptured(ref session_id) => {
                let session_id = session_id.clone();
                self.executor.handle_event(task_id, stage, event)?;
                Ok(Some(OrchestratorEvent::SessionIdCaptured {
                    task_id: task_id.to_string(),
                    stage: stage.to_string(),
                    session_id,
                }))
            }
            RunEvent::RawOutputReady(_) => {
                self.executor.handle_event(task_id, stage, event)?;
                Ok(None)
            }
            RunEvent::Completed(ref result) => {
                let is_err = result.is_err();
                let err_msg = result.as_ref().err().cloned();

                let output = self.executor.handle_event(task_id, stage, event)?;

                if let Some(output) = output {
                    let output_type = output_type_string(&output);
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
                        let _ = api.process_agent_output(
                            task_id,
                            StageOutput::Failed {
                                error: format!("Agent error: {error}"),
                            },
                        );
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
        if let Ok(mut executions) = self.active_executions.lock() {
            executions.retain(|h| !h.is_complete());
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

        for task in tasks {
            // Skip if we already have an active execution for this task
            if active_task_ids.contains(&task.id) {
                continue;
            }

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

                    if let Ok(mut executions) = self.active_executions.lock() {
                        executions.push(handle);
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

    /// Recover pending outputs from crash.
    fn recover_pending(&self) -> Vec<OrchestratorEvent> {
        let mut events = Vec::new();

        for recovered in self.executor.recover_pending() {
            match recovered.result {
                Ok(output) => {
                    if let Ok(api) = self.api.lock() {
                        match api.process_agent_output(&recovered.task_id, output) {
                            Ok(_) => {
                                self.executor.clear_pending(&recovered.task_id, &recovered.stage);
                                events.push(OrchestratorEvent::RecoveredPending {
                                    task_id: recovered.task_id,
                                    stage: recovered.stage,
                                });
                            }
                            Err(e) => {
                                events.push(OrchestratorEvent::Error {
                                    task_id: Some(recovered.task_id),
                                    error: format!("Failed to process recovered output: {e}"),
                                });
                            }
                        }
                    }
                }
                Err(e) => {
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
        StageOutput::Completed { .. } => "completed".to_string(),
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
        assert_eq!(output_type_string(&StageOutput::Completed { summary: "done".into() }), "completed");
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
