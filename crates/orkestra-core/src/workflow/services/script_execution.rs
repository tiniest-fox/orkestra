//! Script execution service for running script-based workflow stages.
//!
//! This service handles the lifecycle of script stages:
//! - Spawning scripts
//! - Tracking active executions
//! - Polling for completion
//! - Generating log entries

use std::collections::HashMap;
use std::fs::{self, File};
use std::io::Write;
use std::path::{Path, PathBuf};
use std::sync::Mutex;
use std::time::Duration;

use crate::workflow::config::{ScriptStageConfig, StageConfig, WorkflowConfig};
use crate::workflow::domain::{LogEntry, Task};
use crate::workflow::execution::{ScriptEnv, ScriptHandle, ScriptPollState, ScriptResult};

use super::log_service::LogService;

// ============================================================================
// Script Execution Handle
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
    /// Path to the log file for this script.
    pub log_path: PathBuf,
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

// ============================================================================
// Script Execution Service
// ============================================================================

/// Service for managing script stage execution.
///
/// This service encapsulates all script-related logic, keeping the orchestrator
/// focused on coordination rather than execution details.
pub struct ScriptExecutionService {
    /// Workflow configuration.
    workflow: WorkflowConfig,
    /// Project root for resolving paths.
    project_root: PathBuf,
    /// Active script executions keyed by task ID.
    active_scripts: Mutex<HashMap<String, ActiveScript>>,
}

impl ScriptExecutionService {
    /// Create a new script execution service.
    pub fn new(workflow: WorkflowConfig, project_root: PathBuf) -> Self {
        Self {
            workflow,
            project_root,
            active_scripts: Mutex::new(HashMap::new()),
        }
    }

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

    /// Get the working directory for a task.
    pub fn get_working_dir(&self, task: &Task) -> PathBuf {
        task.worktree_path
            .as_ref()
            .map_or_else(|| self.project_root.clone(), PathBuf::from)
    }

    /// Check if a task has an active script execution.
    pub fn has_active_script(&self, task_id: &str) -> bool {
        self.active_scripts
            .lock()
            .map(|scripts| scripts.contains_key(task_id))
            .unwrap_or(false)
    }

    /// Spawn a script for a task.
    ///
    /// Returns the process ID of the spawned script.
    pub fn spawn_script(&self, task: &Task, stage: &str) -> Result<u32, ScriptError> {
        self.spawn_script_with_primary_branch(task, stage, None)
    }

    /// Spawn a script for a task with an optional primary branch.
    ///
    /// The primary branch is used to set `ORKESTRA_PRIMARY_BRANCH` environment variable.
    /// If not provided, scripts can detect it themselves via git.
    ///
    /// Returns the process ID of the spawned script.
    pub fn spawn_script_with_primary_branch(
        &self,
        task: &Task,
        stage: &str,
        primary_branch: Option<&str>,
    ) -> Result<u32, ScriptError> {
        let script_config = self
            .get_script_config(stage)
            .ok_or_else(|| ScriptError::NoConfig(stage.to_string()))?;

        let command = script_config.command.clone();
        let timeout = Duration::from_secs(u64::from(script_config.timeout_seconds));
        let recovery_stage = script_config.on_failure.clone();
        let working_dir = self.get_working_dir(task);

        // Build environment variables for the script
        let env = self.build_script_env(task, primary_branch);

        // Create log file path
        let log_path = self.script_log_path(&task.id, stage);
        if let Some(parent) = log_path.parent() {
            fs::create_dir_all(parent).map_err(|e| ScriptError::LogError(e.to_string()))?;
        }

        // Write initial log entry
        self.write_log_entry(
            &log_path,
            &LogEntry::ScriptStart {
                command: command.clone(),
                stage: stage.to_string(),
            },
        )?;

        // Spawn the script with environment variables
        let handle = ScriptHandle::spawn_with_env(&command, &working_dir, timeout, &env)
            .map_err(|e| ScriptError::SpawnFailed(e.to_string()))?;

        let pid = handle.pid();

        let active_script = ActiveScript {
            task_id: task.id.clone(),
            stage: stage.to_string(),
            command,
            handle,
            recovery_stage,
            log_path,
        };

        // Track the script
        self.active_scripts
            .lock()
            .map_err(|_| ScriptError::LockError)?
            .insert(task.id.clone(), active_script);

        Ok(pid)
    }

    /// Poll all active scripts for completion.
    ///
    /// Returns a list of poll results. Incremental output is written to log files
    /// as it arrives, allowing real-time log viewing.
    pub fn poll_active_scripts(&self) -> Vec<ScriptPollResult> {
        let mut results = Vec::new();
        let mut completed_task_ids = Vec::new();

        // First pass: check for completions
        if let Ok(mut scripts) = self.active_scripts.lock() {
            for (task_id, script) in scripts.iter_mut() {
                match script.handle.try_wait() {
                    Ok(ScriptPollState::Completed(result)) => {
                        // Write final output if any (may contain remaining buffered output)
                        if !result.output.is_empty() {
                            let _ = self.write_log_entry(
                                &script.log_path,
                                &LogEntry::ScriptOutput {
                                    content: result.output.clone(),
                                },
                            );
                        }

                        let _ = self.write_log_entry(
                            &script.log_path,
                            &LogEntry::ScriptExit {
                                code: result.exit_code,
                                success: result.is_success(),
                                timed_out: result.timed_out,
                            },
                        );

                        completed_task_ids.push(task_id.clone());
                        results.push(ScriptPollResult::Completed(ScriptCompletion {
                            task_id: task_id.clone(),
                            stage: script.stage.clone(),
                            result,
                            recovery_stage: script.recovery_stage.clone(),
                        }));
                    }
                    Ok(ScriptPollState::Running { new_output }) => {
                        // Write incremental output to log file for real-time viewing
                        if let Some(output) = new_output {
                            if !output.is_empty() {
                                let _ = self.write_log_entry(
                                    &script.log_path,
                                    &LogEntry::ScriptOutput { content: output },
                                );
                            }
                        }
                        results.push(ScriptPollResult::Running);
                    }
                    Err(e) => {
                        completed_task_ids.push(task_id.clone());
                        results.push(ScriptPollResult::Error(format!(
                            "Script execution error for {task_id}: {e}"
                        )));
                    }
                }
            }

            // Remove completed scripts
            for task_id in completed_task_ids {
                scripts.remove(&task_id);
            }
        }

        results
    }

    /// Get the number of active scripts.
    pub fn active_count(&self) -> usize {
        self.active_scripts.lock().map(|s| s.len()).unwrap_or(0)
    }

    /// Build environment variables for script execution.
    ///
    /// These variables provide task context so scripts can make intelligent
    /// decisions (e.g., running only relevant checks based on what changed).
    ///
    /// Variables set:
    /// - `ORKESTRA_TASK_ID` - Unique task identifier
    /// - `ORKESTRA_TASK_TITLE` - Human-readable task title
    /// - `ORKESTRA_BRANCH` - Task's git branch (if set)
    /// - `ORKESTRA_WORKTREE_PATH` - Path to task's worktree (if set)
    /// - `ORKESTRA_PROJECT_ROOT` - Path to main project root
    /// - `ORKESTRA_PRIMARY_BRANCH` - Primary branch name (if provided)
    fn build_script_env(&self, task: &Task, primary_branch: Option<&str>) -> ScriptEnv {
        ScriptEnv::new()
            .with("ORKESTRA_TASK_ID", &task.id)
            .with("ORKESTRA_TASK_TITLE", &task.title)
            .with_opt("ORKESTRA_BRANCH", task.branch_name.as_ref())
            .with_opt("ORKESTRA_WORKTREE_PATH", task.worktree_path.as_ref())
            .with(
                "ORKESTRA_PROJECT_ROOT",
                self.project_root.to_string_lossy().as_ref(),
            )
            .with_opt("ORKESTRA_PRIMARY_BRANCH", primary_branch)
    }

    /// Get the log file path for a script execution.
    ///
    /// Delegates to `LogService::script_log_path` to maintain a single source of truth
    /// for log file paths.
    fn script_log_path(&self, task_id: &str, stage: &str) -> PathBuf {
        let log_service = LogService::new(self.workflow.clone(), self.project_root.clone());
        log_service.script_log_path(task_id, stage)
    }

    /// Write a log entry to the script log file.
    #[allow(clippy::unused_self)] // Kept as method for API consistency
    fn write_log_entry(&self, log_path: &Path, entry: &LogEntry) -> Result<(), ScriptError> {
        let mut file = File::options()
            .create(true)
            .append(true)
            .open(log_path)
            .map_err(|e| ScriptError::LogError(e.to_string()))?;

        let json =
            serde_json::to_string(entry).map_err(|e| ScriptError::LogError(e.to_string()))?;

        writeln!(file, "{json}").map_err(|e| ScriptError::LogError(e.to_string()))?;

        Ok(())
    }
}

// ============================================================================
// Script Error
// ============================================================================

/// Errors that can occur during script execution.
#[derive(Debug)]
pub enum ScriptError {
    /// No script configuration for stage.
    NoConfig(String),
    /// Failed to spawn script.
    SpawnFailed(String),
    /// Lock error.
    LockError,
    /// Log file error.
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

#[cfg(test)]
mod tests {
    use super::*;
    use crate::workflow::config::{IntegrationConfig, StageConfig};
    use crate::workflow::services::LogService;
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
            integration: IntegrationConfig::default(),
        }
    }

    #[test]
    fn test_is_script_stage() {
        let temp_dir = TempDir::new().unwrap();
        let service =
            ScriptExecutionService::new(test_workflow_with_script(), temp_dir.path().to_path_buf());

        assert!(!service.is_script_stage("work"));
        assert!(service.is_script_stage("checks"));
        assert!(!service.is_script_stage("unknown"));
    }

    #[test]
    fn test_get_script_config() {
        let temp_dir = TempDir::new().unwrap();
        let service =
            ScriptExecutionService::new(test_workflow_with_script(), temp_dir.path().to_path_buf());

        assert!(service.get_script_config("work").is_none());

        let config = service.get_script_config("checks").unwrap();
        assert_eq!(config.command, "echo 'hello'");
        assert_eq!(config.timeout_seconds, 10);
        assert_eq!(config.on_failure, Some("work".into()));
    }

    #[test]
    fn test_script_log_path() {
        let temp_dir = TempDir::new().unwrap();
        let service =
            ScriptExecutionService::new(test_workflow_with_script(), temp_dir.path().to_path_buf());

        let path = service.script_log_path("task-123", "checks");
        assert!(path.ends_with("script_logs/task-123_checks.jsonl"));
    }

    #[test]
    fn test_write_and_read_logs() {
        let temp_dir = TempDir::new().unwrap();
        let workflow = test_workflow_with_script();
        let service =
            ScriptExecutionService::new(workflow.clone(), temp_dir.path().to_path_buf());

        let log_path = service.script_log_path("task-456", "checks");
        fs::create_dir_all(log_path.parent().unwrap()).unwrap();

        // Write some entries
        service
            .write_log_entry(
                &log_path,
                &LogEntry::ScriptStart {
                    command: "npm test".into(),
                    stage: "checks".into(),
                },
            )
            .unwrap();

        service
            .write_log_entry(
                &log_path,
                &LogEntry::ScriptOutput {
                    content: "All tests passed".into(),
                },
            )
            .unwrap();

        service
            .write_log_entry(
                &log_path,
                &LogEntry::ScriptExit {
                    code: 0,
                    success: true,
                    timed_out: false,
                },
            )
            .unwrap();

        // Read them back using LogService
        let log_service = LogService::new(workflow, temp_dir.path().to_path_buf());
        let logs = log_service.read_script_logs("task-456", "checks");
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
