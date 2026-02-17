//! Script execution service for running script-based workflow stages.
//!
//! Tracks active script handles and delegates spawn + poll to interactions.

use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::{Arc, Mutex};

use crate::workflow::config::{ScriptStageConfig, StageConfig, WorkflowConfig};
use crate::workflow::domain::Task;
use crate::workflow::execution::{ScriptHandle, ScriptResult};
use crate::workflow::ports::WorkflowStore;

// ============================================================================
// Types
// ============================================================================

/// Handle for tracking a running script execution.
pub struct ActiveScript {
    /// Task being executed.
    #[allow(dead_code)]
    pub task_id: String,
    /// Stage being executed.
    pub stage: String,
    /// Command being run.
    #[allow(dead_code)]
    pub command: String,
    /// The script handle (owns the process).
    pub handle: ScriptHandle,
    /// Recovery stage to go to on failure (if configured).
    pub recovery_stage: Option<String>,
    /// Stage session ID for persisting log entries to the database.
    pub stage_session_id: String,
}

/// Result of polling an active script.
pub enum ScriptPollResult {
    /// Script is still running.
    Running,
    /// Script completed.
    Completed(ScriptCompletion),
    /// Error checking script status.
    Error(String),
}

/// Information about a completed script.
pub struct ScriptCompletion {
    /// Task ID.
    pub task_id: String,
    /// Stage name.
    pub stage: String,
    /// The script result.
    pub result: ScriptResult,
    /// Recovery stage if configured.
    pub recovery_stage: Option<String>,
}

/// Errors that can occur during script execution.
#[derive(Debug)]
pub enum ScriptError {
    /// No script configuration for stage.
    NoConfig(String),
    /// Failed to spawn script.
    SpawnFailed(String),
    /// Lock error.
    LockError,
    /// Log persistence error.
    LogError(String),
}

impl std::fmt::Display for ScriptError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::NoConfig(stage) => write!(f, "No script config for stage: {stage}"),
            Self::SpawnFailed(msg) => write!(f, "Failed to spawn script: {msg}"),
            Self::LockError => write!(f, "Lock error"),
            Self::LogError(msg) => write!(f, "Log error: {msg}"),
        }
    }
}

impl std::error::Error for ScriptError {}

// ============================================================================
// Script Execution Service
// ============================================================================

/// Service for managing script stage execution.
///
/// Tracks active script handles and delegates spawn/poll to interactions.
pub struct ScriptExecutionService {
    /// Workflow configuration.
    workflow: WorkflowConfig,
    /// Project root for resolving paths.
    project_root: PathBuf,
    /// Store for persisting log entries.
    store: Arc<dyn WorkflowStore>,
    /// Active script executions keyed by task ID.
    active_scripts: Mutex<HashMap<String, ActiveScript>>,
}

impl ScriptExecutionService {
    /// Create a new script execution service.
    pub fn new(
        workflow: WorkflowConfig,
        project_root: PathBuf,
        store: Arc<dyn WorkflowStore>,
    ) -> Self {
        Self {
            workflow,
            project_root,
            store,
            active_scripts: Mutex::new(HashMap::new()),
        }
    }

    // -- Config Queries --

    /// Check if a stage is a script stage.
    pub fn is_script_stage(&self, stage: &str) -> bool {
        self.workflow
            .stages
            .iter()
            .find(|s| s.name == stage)
            .is_some_and(StageConfig::is_script_stage)
    }

    /// Get the script configuration for a stage.
    pub fn get_script_config(&self, stage: &str) -> Option<&ScriptStageConfig> {
        self.workflow
            .stages
            .iter()
            .find(|s| s.name == stage)
            .and_then(|s| s.script.as_ref())
    }

    // -- Active Script Tracking --

    /// Check if a task has an active script execution.
    pub fn has_active_script(&self, task_id: &str) -> bool {
        self.active_scripts
            .lock()
            .map(|scripts| scripts.contains_key(task_id))
            .unwrap_or(false)
    }

    /// Get the number of active scripts.
    pub fn active_count(&self) -> usize {
        self.active_scripts.lock().map(|s| s.len()).unwrap_or(0)
    }

    /// Get the set of task IDs with active script executions.
    pub fn active_script_task_ids(&self) -> std::collections::HashSet<String> {
        self.active_scripts
            .lock()
            .map(|s| s.keys().cloned().collect())
            .unwrap_or_default()
    }

    // -- Spawn & Poll --

    /// Spawn a script for a task.
    ///
    /// Returns the process ID of the spawned script.
    pub fn spawn_script(
        &self,
        task: &Task,
        stage: &str,
        stage_session_id: Option<&str>,
    ) -> Result<u32, ScriptError> {
        let active_script = super::interactions::spawn_script::execute(
            self.store.as_ref(),
            &self.workflow,
            &self.project_root,
            task,
            stage,
            stage_session_id,
        )?;

        let pid = active_script.handle.pid();

        self.active_scripts
            .lock()
            .map_err(|_| ScriptError::LockError)?
            .insert(task.id.clone(), active_script);

        Ok(pid)
    }

    /// Poll all active scripts for completion.
    ///
    /// Returns a list of poll results. Incremental output is written to the
    /// database as it arrives, allowing real-time log viewing.
    pub fn poll_active_scripts(&self) -> Vec<ScriptPollResult> {
        let mut results = Vec::new();
        let mut completed_task_ids = Vec::new();

        if let Ok(mut scripts) = self.active_scripts.lock() {
            for (task_id, script) in scripts.iter_mut() {
                let result = super::interactions::poll_script::execute(self.store.as_ref(), script);
                match &result {
                    ScriptPollResult::Completed(_) | ScriptPollResult::Error(_) => {
                        completed_task_ids.push(task_id.clone());
                    }
                    ScriptPollResult::Running => {}
                }
                results.push(result);
            }

            // Remove completed scripts
            for task_id in completed_task_ids {
                scripts.remove(&task_id);
            }
        }

        results
    }
}

// ============================================================================
// Tests
// ============================================================================

#[cfg(test)]
mod tests {
    use super::*;
    use crate::workflow::adapters::InMemoryWorkflowStore;
    use crate::workflow::config::{IntegrationConfig, ScriptStageConfig, StageConfig};
    use crate::workflow::domain::LogEntry;
    use tempfile::TempDir;

    fn test_workflow_with_script() -> WorkflowConfig {
        WorkflowConfig {
            version: 1,
            stages: vec![
                StageConfig::new("work", "summary"),
                StageConfig::new("checks", "check_results")
                    .with_display_name("Automated Checks")
                    .with_inputs(vec!["summary".into()])
                    .with_script(ScriptStageConfig {
                        command: "echo 'hello'".into(),
                        timeout_seconds: 10,
                        on_failure: Some("work".into()),
                    }),
            ],
            integration: IntegrationConfig::new("work"),
            flows: indexmap::IndexMap::new(),
        }
    }

    fn create_service() -> (ScriptExecutionService, Arc<InMemoryWorkflowStore>) {
        let temp_dir = TempDir::new().unwrap();
        let store = Arc::new(InMemoryWorkflowStore::new());
        let service = ScriptExecutionService::new(
            test_workflow_with_script(),
            temp_dir.path().to_path_buf(),
            Arc::clone(&store) as Arc<dyn WorkflowStore>,
        );
        (service, store)
    }

    #[test]
    fn test_is_script_stage() {
        let (service, _store) = create_service();

        assert!(!service.is_script_stage("work"));
        assert!(service.is_script_stage("checks"));
        assert!(!service.is_script_stage("unknown"));
    }

    #[test]
    fn test_get_script_config() {
        let (service, _store) = create_service();

        assert!(service.get_script_config("work").is_none());

        let config = service.get_script_config("checks").unwrap();
        assert_eq!(config.command, "echo 'hello'");
        assert_eq!(config.timeout_seconds, 10);
        assert_eq!(config.on_failure, Some("work".into()));
    }

    #[test]
    fn test_append_and_read_logs() {
        let (_service, store) = create_service();

        let stage_session_id = "task-456-checks";

        // Write entries directly via store (testing log persistence)
        store
            .append_log_entry(
                stage_session_id,
                &LogEntry::ScriptStart {
                    command: "npm test".into(),
                    stage: "checks".into(),
                },
            )
            .unwrap();

        store
            .append_log_entry(
                stage_session_id,
                &LogEntry::ScriptOutput {
                    content: "All tests passed".into(),
                },
            )
            .unwrap();

        store
            .append_log_entry(
                stage_session_id,
                &LogEntry::ScriptExit {
                    code: 0,
                    success: true,
                    timed_out: false,
                },
            )
            .unwrap();

        // Read them back from the store
        let logs = store.get_log_entries(stage_session_id).unwrap();
        assert_eq!(logs.len(), 3);

        match &logs[0] {
            LogEntry::ScriptStart { command, stage } => {
                assert_eq!(command, "npm test");
                assert_eq!(stage, "checks");
            }
            _ => panic!("Expected ScriptStart"),
        }

        match &logs[1] {
            LogEntry::ScriptOutput { content } => {
                assert_eq!(content, "All tests passed");
            }
            _ => panic!("Expected ScriptOutput"),
        }

        match &logs[2] {
            LogEntry::ScriptExit {
                code,
                success,
                timed_out,
            } => {
                assert_eq!(*code, 0);
                assert!(*success);
                assert!(!*timed_out);
            }
            _ => panic!("Expected ScriptExit"),
        }
    }
}
