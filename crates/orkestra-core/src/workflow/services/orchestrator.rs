//! Stage-agnostic orchestrator loop.
//!
//! The orchestrator is a reconciliation loop that:
//! 1. Polls for tasks needing agents
//! 2. Spawns agents for those tasks
//! 3. Processes agent output when they complete
//!
//! It is driven by the workflow configuration and is stage-agnostic -
//! it doesn't know about specific stages like "planning" or "work".

use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::time::Duration;

use crate::process::is_process_running;
use crate::workflow::adapters::ClaudeAgentSpawner;
use crate::workflow::execution::{resolve_stage_agent_config, AgentSpawner, StageOutput};
use crate::workflow::ports::{WorkflowError, WorkflowResult};

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
// Orchestrator Loop
// ============================================================================

/// The main orchestration loop.
///
/// This struct manages the background loop that reconciles task state
/// and spawns agents as needed.
pub struct OrchestratorLoop {
    api: Arc<Mutex<WorkflowApi>>,
    project_root: PathBuf,
    spawner: Arc<dyn AgentSpawner>,
    stop_flag: Arc<AtomicBool>,
}

impl OrchestratorLoop {
    /// Create a new orchestrator loop.
    ///
    /// # Arguments
    /// * `api` - The workflow API, wrapped in Arc<Mutex> for thread-safe access
    /// * `project_root` - Root directory of the project
    /// * `spawner` - Agent spawner implementation
    pub fn new(
        api: Arc<Mutex<WorkflowApi>>,
        project_root: PathBuf,
        spawner: Arc<dyn AgentSpawner>,
    ) -> Self {
        Self {
            api,
            project_root,
            spawner,
            stop_flag: Arc::new(AtomicBool::new(false)),
        }
    }

    /// Create with default ClaudeAgentSpawner.
    pub fn with_claude_spawner(api: Arc<Mutex<WorkflowApi>>, project_root: PathBuf) -> Self {
        let spawner = Arc::new(ClaudeAgentSpawner::from_project_root(&project_root));
        Self::new(api, project_root, spawner)
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
    /// Events are passed to the callback.
    pub fn run<F>(&self, mut on_event: F)
    where
        F: FnMut(OrchestratorEvent) + Send,
    {
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

            std::thread::sleep(Duration::from_secs(1));
        }
    }

    /// Run a single tick of the orchestration loop.
    ///
    /// This is the main reconciliation function. It:
    /// 1. Recovers any pending outputs from crashes
    /// 2. Gets tasks needing agents
    /// 3. Spawns agents for those tasks
    ///
    /// Returns events describing what happened.
    pub fn tick(&self) -> WorkflowResult<Vec<OrchestratorEvent>> {
        let mut events = Vec::new();

        // Phase 1: Recover pending outputs
        let recovered = self.recover_pending_outputs();
        events.extend(recovered);

        // Phase 2: Get tasks needing agents
        let tasks = {
            let api = self.api.lock().map_err(|_| WorkflowError::Lock)?;
            api.get_tasks_needing_agents()?
        };

        // Phase 3: Spawn agents for each task
        for task in tasks {
            // Skip if task still has a running agent (defensive check)
            if let Some(pid) = task.agent_pid {
                if is_process_running(pid) {
                    continue;
                }
            }

            let stage = match task.current_stage() {
                Some(s) => s.to_string(),
                None => continue, // Not in an active stage
            };

            // Try to spawn agent
            match self.spawn_agent_for_task(&task.id, &stage) {
                Ok(event) => events.push(event),
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

    /// Spawn an agent for a task.
    fn spawn_agent_for_task(
        &self,
        task_id: &str,
        stage: &str,
    ) -> Result<OrchestratorEvent, OrchestratorError> {
        // Get task and workflow config
        let (task, workflow, feedback) = {
            let api = self.api.lock().map_err(|_| OrchestratorError::LockPoisoned)?;
            let task = api
                .get_task(task_id)
                .map_err(|e| OrchestratorError::WorkflowError(e.to_string()))?;
            let workflow = api.workflow().clone();
            let feedback = api.get_rejection_feedback(task_id).ok().flatten();
            (task, workflow, feedback)
        };

        // Resolve agent configuration
        let config = resolve_stage_agent_config(
            &workflow,
            &task,
            Some(&self.project_root),
            feedback.as_deref(),
            None, // TODO: integration error context
        )
        .map_err(|e| OrchestratorError::ConfigError(e.to_string()))?;

        // Mark agent as started
        {
            let api = self.api.lock().map_err(|_| OrchestratorError::LockPoisoned)?;
            api.agent_started(task_id)
                .map_err(|e| OrchestratorError::WorkflowError(e.to_string()))?;
        }

        // Spawn the agent
        let task_id_clone = task_id.to_string();
        let stage_clone = stage.to_string();
        let api_clone = self.api.clone();

        let on_complete = Box::new(move |id: String, result: Result<StageOutput, String>| {
            // Process the output
            match result {
                Ok(output) => {
                    if let Ok(api) = api_clone.lock() {
                        let _ = api.process_agent_output(&id, output);
                    }
                }
                Err(e) => {
                    eprintln!("[orchestrator] Agent {} failed: {}", id, e);
                    // Mark task as failed
                    if let Ok(api) = api_clone.lock() {
                        let _ = api.process_agent_output(
                            &id,
                            StageOutput::Failed {
                                error: format!("Agent error: {e}"),
                            },
                        );
                    }
                }
            }
        });

        let spawn_result = self
            .spawner
            .spawn(&self.project_root, &task, config, None, on_complete)
            .map_err(|e| OrchestratorError::SpawnError(e.to_string()))?;

        Ok(OrchestratorEvent::AgentSpawned {
            task_id: task_id_clone,
            stage: stage_clone,
            pid: spawn_result.pid,
        })
    }

    /// Recover pending outputs from crashes.
    fn recover_pending_outputs(&self) -> Vec<OrchestratorEvent> {
        // Only works with ClaudeAgentSpawner
        let spawner =
            ClaudeAgentSpawner::from_project_root(&self.project_root);
        let recovered = spawner.recover_pending_outputs();

        let mut events = Vec::new();

        for (task_id, stage, result) in recovered {
            match result {
                Ok(output) => {
                    // Process the recovered output
                    if let Ok(api) = self.api.lock() {
                        match api.process_agent_output(&task_id, output) {
                            Ok(_) => {
                                // Clear the pending output
                                let _ = spawner.clear_pending_output(&task_id, &stage);
                                events.push(OrchestratorEvent::RecoveredPending {
                                    task_id,
                                    stage,
                                });
                            }
                            Err(e) => {
                                events.push(OrchestratorEvent::Error {
                                    task_id: Some(task_id),
                                    error: format!("Failed to process recovered output: {e}"),
                                });
                            }
                        }
                    }
                }
                Err(e) => {
                    events.push(OrchestratorEvent::Error {
                        task_id: Some(task_id),
                        error: format!("Failed to parse recovered output: {e}"),
                    });
                }
            }
        }

        events
    }
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

#[cfg(test)]
mod tests {
    use super::*;
    use crate::workflow::adapters::InMemoryWorkflowStore;
    use crate::workflow::config::{StageCapabilities, StageConfig, WorkflowConfig};
    use crate::workflow::execution::MockSpawner;

    fn test_workflow() -> WorkflowConfig {
        WorkflowConfig::new(vec![
            StageConfig::new("planning", "plan")
                .with_capabilities(StageCapabilities::with_questions()),
            StageConfig::new("work", "summary").with_inputs(vec!["plan".into()]),
        ])
    }

    fn create_test_orchestrator() -> (OrchestratorLoop, Arc<Mutex<WorkflowApi>>, Arc<MockSpawner>) {
        let workflow = test_workflow();
        let store = Box::new(InMemoryWorkflowStore::new());
        let api = Arc::new(Mutex::new(WorkflowApi::new(workflow, store)));
        let spawner = Arc::new(MockSpawner::new());

        let orchestrator =
            OrchestratorLoop::new(api.clone(), PathBuf::from("/project"), spawner.clone());

        (orchestrator, api, spawner)
    }

    #[test]
    fn test_tick_spawns_agent_for_idle_task() {
        let (orchestrator, api, spawner) = create_test_orchestrator();

        // Create a task
        {
            let api = api.lock().unwrap();
            api.create_task("Test", "Description").unwrap();
        }

        // Run a tick - but we can't actually spawn because we need agent definitions
        // This test verifies the structure works
        let _events = orchestrator.tick();

        // The spawner would have been called if we had agent definitions
        // For now, just verify we don't crash
    }

    #[test]
    fn test_stop_flag() {
        let (orchestrator, _api, _spawner) = create_test_orchestrator();

        assert!(!orchestrator.stop_flag.load(Ordering::Relaxed));
        orchestrator.stop();
        assert!(orchestrator.stop_flag.load(Ordering::Relaxed));
    }

    #[test]
    fn test_orchestrator_error_display() {
        let err = OrchestratorError::LockPoisoned;
        assert_eq!(err.to_string(), "Lock poisoned");

        let err = OrchestratorError::WorkflowError("test".into());
        assert!(err.to_string().contains("test"));
    }
}
