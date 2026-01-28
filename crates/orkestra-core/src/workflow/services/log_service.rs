//! Unified log reading service for agent and script stages.
//!
//! This service is the single source of truth for reading execution logs,
//! regardless of whether they come from Claude session files (agents) or
//! Orkestra's script log files.

use std::fs;
use std::path::PathBuf;

use crate::workflow::config::WorkflowConfig;
use crate::workflow::domain::{LogEntry, Task};

use super::session_logs::recover_session_logs;

/// Service for reading execution logs from agent and script stages.
///
/// Provides a unified interface for log reading, abstracting away the
/// different storage mechanisms (Claude session files vs Orkestra JSONL files).
pub struct LogService {
    workflow: WorkflowConfig,
    project_root: PathBuf,
}

impl LogService {
    /// Create a new log service.
    pub fn new(workflow: WorkflowConfig, project_root: PathBuf) -> Self {
        Self {
            workflow,
            project_root,
        }
    }

    /// Read logs for a task's stage.
    ///
    /// Dispatches to the appropriate reader based on stage type:
    /// - Script stages: reads from `.orkestra/script_logs/`
    /// - Agent stages: reads from Claude's session files
    ///
    /// # Arguments
    /// * `task` - The task to get logs for
    /// * `stage` - The stage name
    /// * `claude_session_id` - Claude session ID (required for agent stages)
    pub fn get_logs(
        &self,
        task: &Task,
        stage: &str,
        claude_session_id: Option<&str>,
    ) -> Vec<LogEntry> {
        if self.is_script_stage(stage) {
            self.read_script_logs(&task.id, stage)
        } else {
            self.read_agent_logs(task, claude_session_id)
        }
    }

    /// Check if a stage is a script stage.
    fn is_script_stage(&self, stage: &str) -> bool {
        self.workflow
            .stages
            .iter()
            .find(|s| s.name == stage)
            .is_some_and(super::super::config::StageConfig::is_script_stage)
    }

    /// Read script logs from `.orkestra/script_logs/`.
    ///
    /// Public for testing purposes. Prefer using `get_logs()` for the unified API.
    pub fn read_script_logs(&self, task_id: &str, stage: &str) -> Vec<LogEntry> {
        let log_path = self.script_log_path(task_id, stage);

        let Ok(content) = fs::read_to_string(&log_path) else {
            return Vec::new();
        };

        content
            .lines()
            .filter_map(|line| serde_json::from_str(line).ok())
            .collect()
    }

    /// Read agent logs from Claude's session file.
    fn read_agent_logs(&self, task: &Task, session_id: Option<&str>) -> Vec<LogEntry> {
        let Some(session_id) = session_id else {
            return Vec::new();
        };

        // Use worktree path if available, otherwise project root
        let cwd = task
            .worktree_path
            .as_ref()
            .map_or_else(|| self.project_root.clone(), PathBuf::from);

        recover_session_logs(session_id, &cwd).unwrap_or_default()
    }

    /// Get the path to a script's log file.
    ///
    /// This is the canonical location for script logs.
    pub fn script_log_path(&self, task_id: &str, stage: &str) -> PathBuf {
        self.project_root
            .join(".orkestra")
            .join("script_logs")
            .join(format!("{task_id}_{stage}.jsonl"))
    }

    /// Check if a stage has logs available.
    ///
    /// Returns true if:
    /// - Agent stage with a Claude session ID, OR
    /// - Script stage with an existing log file
    pub fn stage_has_logs(
        &self,
        task_id: &str,
        stage: &str,
        claude_session_id: Option<&str>,
    ) -> bool {
        // Agent stage: has Claude session ID
        if claude_session_id.is_some() {
            return true;
        }
        // Script stage: check if log file exists
        if self.is_script_stage(stage) {
            return self.script_log_path(task_id, stage).exists();
        }
        false
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::workflow::config::{IntegrationConfig, ScriptStageConfig, StageConfig};
    use tempfile::TempDir;

    fn test_workflow() -> WorkflowConfig {
        WorkflowConfig {
            version: 1,
            stages: vec![
                StageConfig::new("planning", "plan"),
                StageConfig::new("work", "summary"),
                StageConfig::new("checks", "check_results")
                    .with_script(ScriptStageConfig {
                        command: "echo test".into(),
                        timeout_seconds: 10,
                        on_failure: None,
                    }),
            ],
            integration: IntegrationConfig::default(),
        }
    }

    #[test]
    fn test_is_script_stage() {
        let temp_dir = TempDir::new().unwrap();
        let service = LogService::new(test_workflow(), temp_dir.path().to_path_buf());

        assert!(!service.is_script_stage("planning"));
        assert!(!service.is_script_stage("work"));
        assert!(service.is_script_stage("checks"));
    }

    #[test]
    fn test_script_log_path() {
        let temp_dir = TempDir::new().unwrap();
        let service = LogService::new(test_workflow(), temp_dir.path().to_path_buf());

        let path = service.script_log_path("task-123", "checks");
        assert!(path.ends_with("script_logs/task-123_checks.jsonl"));
    }

    #[test]
    fn test_read_script_logs_missing_file() {
        let temp_dir = TempDir::new().unwrap();
        let service = LogService::new(test_workflow(), temp_dir.path().to_path_buf());

        let logs = service.read_script_logs("nonexistent", "checks");
        assert!(logs.is_empty());
    }

    #[test]
    fn test_read_script_logs() {
        let temp_dir = TempDir::new().unwrap();
        let service = LogService::new(test_workflow(), temp_dir.path().to_path_buf());

        // Create script logs directory and file
        let log_dir = temp_dir.path().join(".orkestra/script_logs");
        fs::create_dir_all(&log_dir).unwrap();

        let log_content = r#"{"type":"script_start","command":"echo test","stage":"checks"}
{"type":"script_output","content":"test output"}
{"type":"script_exit","code":0,"success":true,"timed_out":false}"#;

        fs::write(log_dir.join("task-456_checks.jsonl"), log_content).unwrap();

        let logs = service.read_script_logs("task-456", "checks");
        assert_eq!(logs.len(), 3);
    }
}
