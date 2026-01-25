//! Agent spawner port.
//!
//! This module defines the `AgentSpawner` trait, which is the interface
//! for spawning agents in the workflow system. This is a "port" in
//! hexagonal architecture terms - adapters implement this trait.

use std::path::Path;

use crate::workflow::domain::Task;
use crate::workflow::execution::{ResolvedAgentConfig, StageOutput};

// ============================================================================
// Spawn Result
// ============================================================================

/// Result from spawning an agent.
#[derive(Debug)]
pub struct SpawnResult {
    /// Process ID of the spawned agent.
    pub pid: u32,
    /// Session ID for resuming (if available).
    pub session_id: Option<String>,
}

// ============================================================================
// Spawn Error
// ============================================================================

/// Errors that can occur when spawning an agent.
#[derive(Debug, Clone)]
pub enum SpawnError {
    /// Failed to spawn the process.
    ProcessSpawnFailed(String),
    /// Failed to write prompt to stdin.
    PromptWriteFailed(String),
    /// Failed to get session ID.
    SessionIdFailed(String),
    /// Invalid configuration.
    InvalidConfig(String),
}

impl std::fmt::Display for SpawnError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::ProcessSpawnFailed(msg) => write!(f, "Failed to spawn process: {msg}"),
            Self::PromptWriteFailed(msg) => write!(f, "Failed to write prompt: {msg}"),
            Self::SessionIdFailed(msg) => write!(f, "Failed to get session ID: {msg}"),
            Self::InvalidConfig(msg) => write!(f, "Invalid configuration: {msg}"),
        }
    }
}

impl std::error::Error for SpawnError {}

// ============================================================================
// Agent Completion Callback
// ============================================================================

/// Callback invoked when an agent completes.
///
/// This is called from a background thread when the agent process finishes.
/// The callback receives the task ID and the parsed output.
pub type AgentCompletionCallback = Box<dyn FnOnce(String, Result<StageOutput, String>) + Send>;

// ============================================================================
// Agent Spawner Trait
// ============================================================================

/// Trait for spawning agents.
///
/// This is the port that the orchestrator uses to spawn agents.
/// Different adapters can implement this for different agent backends.
pub trait AgentSpawner: Send + Sync {
    /// Spawn an agent for a task.
    ///
    /// # Arguments
    /// * `project_root` - Root directory of the project (for worktree path)
    /// * `task` - The task to spawn an agent for
    /// * `config` - Resolved agent configuration (prompt, schema, session type)
    /// * `resume_session` - Optional session ID to resume from
    /// * `on_complete` - Callback invoked when the agent completes
    ///
    /// # Returns
    /// * `Ok(SpawnResult)` - Agent was spawned successfully
    /// * `Err(SpawnError)` - Failed to spawn agent
    fn spawn(
        &self,
        project_root: &Path,
        task: &Task,
        config: ResolvedAgentConfig,
        resume_session: Option<&str>,
        on_complete: AgentCompletionCallback,
    ) -> Result<SpawnResult, SpawnError>;

    /// Spawn an agent synchronously, blocking until completion.
    ///
    /// This is useful for testing or CLI tools that don't need async.
    ///
    /// # Arguments
    /// * `project_root` - Root directory of the project
    /// * `task` - The task to spawn an agent for
    /// * `config` - Resolved agent configuration
    /// * `resume_session` - Optional session ID to resume from
    ///
    /// # Returns
    /// * `Ok((SpawnResult, StageOutput))` - Agent completed with output
    /// * `Err(SpawnError)` - Failed to spawn or run agent
    fn spawn_sync(
        &self,
        project_root: &Path,
        task: &Task,
        config: ResolvedAgentConfig,
        resume_session: Option<&str>,
    ) -> Result<(SpawnResult, StageOutput), SpawnError>;
}

// ============================================================================
// Mock Spawner for Testing
// ============================================================================

/// A mock agent spawner for testing.
///
/// This spawner doesn't actually spawn processes - it just records
/// the spawn calls and returns predetermined outputs.
#[cfg(any(test, feature = "testutil"))]
pub mod mock {
    use super::*;
    use std::collections::HashMap;
    use std::sync::{Arc, Mutex};

    /// Recorded spawn call.
    #[derive(Debug, Clone)]
    pub struct SpawnCall {
        pub task_id: String,
        pub session_type: String,
        pub resume_session: Option<String>,
    }

    /// Mock agent spawner.
    pub struct MockSpawner {
        calls: Arc<Mutex<Vec<SpawnCall>>>,
        outputs: Arc<Mutex<HashMap<String, StageOutput>>>,
        next_pid: Arc<Mutex<u32>>,
    }

    impl Default for MockSpawner {
        fn default() -> Self {
            Self::new()
        }
    }

    impl MockSpawner {
        /// Create a new mock spawner.
        pub fn new() -> Self {
            Self {
                calls: Arc::new(Mutex::new(Vec::new())),
                outputs: Arc::new(Mutex::new(HashMap::new())),
                next_pid: Arc::new(Mutex::new(1000)),
            }
        }

        /// Set the output for a task.
        pub fn set_output(&self, task_id: &str, output: StageOutput) {
            self.outputs
                .lock()
                .unwrap()
                .insert(task_id.to_string(), output);
        }

        /// Get recorded spawn calls.
        pub fn calls(&self) -> Vec<SpawnCall> {
            self.calls.lock().unwrap().clone()
        }

        /// Clear recorded calls.
        pub fn clear_calls(&self) {
            self.calls.lock().unwrap().clear();
        }
    }

    impl AgentSpawner for MockSpawner {
        fn spawn(
            &self,
            _project_root: &Path,
            task: &Task,
            config: ResolvedAgentConfig,
            resume_session: Option<&str>,
            on_complete: AgentCompletionCallback,
        ) -> Result<SpawnResult, SpawnError> {
            // Record the call
            self.calls.lock().unwrap().push(SpawnCall {
                task_id: task.id.clone(),
                session_type: config.session_type.clone(),
                resume_session: resume_session.map(String::from),
            });

            // Get PID
            let pid = {
                let mut next = self.next_pid.lock().unwrap();
                let pid = *next;
                *next += 1;
                pid
            };

            // Get output or default
            let output = self
                .outputs
                .lock()
                .unwrap()
                .remove(&task.id)
                .unwrap_or_else(|| StageOutput::Completed {
                    summary: "Mock completion".to_string(),
                });

            // Call completion callback immediately (simulating instant completion)
            let task_id = task.id.clone();
            std::thread::spawn(move || {
                on_complete(task_id, Ok(output));
            });

            Ok(SpawnResult {
                pid,
                session_id: Some(format!("mock-session-{pid}")),
            })
        }

        fn spawn_sync(
            &self,
            _project_root: &Path,
            task: &Task,
            config: ResolvedAgentConfig,
            resume_session: Option<&str>,
        ) -> Result<(SpawnResult, StageOutput), SpawnError> {
            // Record the call
            self.calls.lock().unwrap().push(SpawnCall {
                task_id: task.id.clone(),
                session_type: config.session_type.clone(),
                resume_session: resume_session.map(String::from),
            });

            // Get PID
            let pid = {
                let mut next = self.next_pid.lock().unwrap();
                let pid = *next;
                *next += 1;
                pid
            };

            // Get output or default
            let output = self
                .outputs
                .lock()
                .unwrap()
                .remove(&task.id)
                .unwrap_or_else(|| StageOutput::Completed {
                    summary: "Mock completion".to_string(),
                });

            Ok((
                SpawnResult {
                    pid,
                    session_id: Some(format!("mock-session-{pid}")),
                },
                output,
            ))
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::workflow::domain::Task;
    use crate::workflow::execution::StageOutput;

    fn create_test_task() -> Task {
        Task::new("test-1", "Test Task", "Test description", "planning", "now")
    }

    fn create_test_config() -> ResolvedAgentConfig {
        ResolvedAgentConfig {
            prompt: "Test prompt".to_string(),
            json_schema: None,
            session_type: "planning".to_string(),
        }
    }

    #[test]
    fn test_mock_spawner_records_calls() {
        use mock::MockSpawner;

        let spawner = MockSpawner::new();
        let task = create_test_task();
        let config = create_test_config();

        let (tx, _rx) = std::sync::mpsc::channel();
        let on_complete: AgentCompletionCallback = Box::new(move |_id, _output| {
            let _ = tx.send(());
        });

        let result = spawner.spawn(
            Path::new("/project"),
            &task,
            config,
            None,
            on_complete,
        );

        assert!(result.is_ok());
        let calls = spawner.calls();
        assert_eq!(calls.len(), 1);
        assert_eq!(calls[0].task_id, "test-1");
        assert_eq!(calls[0].session_type, "planning");
    }

    #[test]
    fn test_mock_spawner_sync() {
        use mock::MockSpawner;

        let spawner = MockSpawner::new();
        let task = create_test_task();
        let config = create_test_config();

        // Set a custom output
        spawner.set_output(
            "test-1",
            StageOutput::Artifact {
                content: "Test plan".to_string(),
            },
        );

        let result = spawner.spawn_sync(Path::new("/project"), &task, config, None);

        assert!(result.is_ok());
        let (spawn_result, output) = result.unwrap();
        assert!(spawn_result.session_id.is_some());

        match output {
            StageOutput::Artifact { content } => assert_eq!(content, "Test plan"),
            _ => panic!("Expected Artifact output"),
        }
    }

    #[test]
    fn test_spawn_error_display() {
        let err = SpawnError::ProcessSpawnFailed("test".into());
        assert!(err.to_string().contains("spawn process"));

        let err = SpawnError::PromptWriteFailed("test".into());
        assert!(err.to_string().contains("write prompt"));
    }
}
