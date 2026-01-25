//! Claude Code agent spawner adapter.
//!
//! This adapter implements the AgentSpawner trait for spawning
//! Claude Code processes to execute workflow stages.

use std::fs;
use std::io::BufRead;
use std::path::{Path, PathBuf};
use std::thread;

use crate::process::{spawn_claude_process, spawn_stderr_reader, write_prompt_to_stdin, ProcessGuard};
use crate::workflow::domain::Task;
use crate::workflow::execution::{
    AgentCompletionCallback, AgentSpawner, ResolvedAgentConfig, SpawnError, SpawnResult, StageOutput,
};

// ============================================================================
// Claude Agent Spawner
// ============================================================================

/// Spawner for Claude Code agents.
///
/// This adapter uses the `claude` CLI to spawn agent processes
/// that execute workflow stages.
pub struct ClaudeAgentSpawner {
    /// Directory for pending outputs (crash recovery).
    pending_outputs_dir: PathBuf,
}

impl ClaudeAgentSpawner {
    /// Create a new Claude agent spawner.
    ///
    /// # Arguments
    /// * `pending_outputs_dir` - Directory to store pending outputs for crash recovery.
    ///   Typically `.orkestra/pending-outputs/`.
    pub fn new(pending_outputs_dir: PathBuf) -> Self {
        Self { pending_outputs_dir }
    }

    /// Create from a project root directory.
    ///
    /// Uses `.orkestra/pending-outputs/` under the project root.
    pub fn from_project_root(project_root: &Path) -> Self {
        Self {
            pending_outputs_dir: project_root.join(".orkestra/pending-outputs"),
        }
    }

    /// Get the pending output file path for a task and stage.
    fn pending_output_path(&self, task_id: &str, stage: &str) -> PathBuf {
        self.pending_outputs_dir.join(format!("{task_id}_{stage}.json"))
    }

    /// Write pending output for crash recovery.
    fn write_pending_output(&self, task_id: &str, stage: &str, output: &str) -> std::io::Result<()> {
        // Ensure directory exists
        if !self.pending_outputs_dir.exists() {
            fs::create_dir_all(&self.pending_outputs_dir)?;
        }

        let path = self.pending_output_path(task_id, stage);
        fs::write(&path, output)?;
        Ok(())
    }

    /// Clear pending output after successful processing.
    pub fn clear_pending_output(&self, task_id: &str, stage: &str) -> std::io::Result<()> {
        let path = self.pending_output_path(task_id, stage);
        if path.exists() {
            fs::remove_file(&path)?;
        }
        Ok(())
    }

    /// List all pending outputs (for crash recovery).
    pub fn list_pending_outputs(&self) -> Vec<(String, String)> {
        if !self.pending_outputs_dir.exists() {
            return Vec::new();
        }

        let mut results = Vec::new();
        if let Ok(entries) = fs::read_dir(&self.pending_outputs_dir) {
            for entry in entries.flatten() {
                let path = entry.path();
                if path.extension().is_some_and(|e| e == "json") {
                    if let Some(stem) = path.file_stem().and_then(|s| s.to_str()) {
                        // Parse "taskid_stage.json" format
                        if let Some((task_id, stage)) = stem.rsplit_once('_') {
                            results.push((task_id.to_string(), stage.to_string()));
                        }
                    }
                }
            }
        }
        results
    }

    /// Read a pending output file.
    pub fn read_pending_output(&self, task_id: &str, stage: &str) -> Option<String> {
        let path = self.pending_output_path(task_id, stage);
        fs::read_to_string(path).ok()
    }

    /// Recover pending outputs from crash.
    ///
    /// Returns a list of (task_id, stage, StageOutput) for each recovered output.
    pub fn recover_pending_outputs(&self) -> Vec<(String, String, Result<StageOutput, String>)> {
        let mut results = Vec::new();

        for (task_id, stage) in self.list_pending_outputs() {
            if let Some(json) = self.read_pending_output(&task_id, &stage) {
                let parsed = StageOutput::parse(&json);
                let result = parsed.map_err(|e| e.to_string());
                results.push((task_id, stage, result));
            }
        }

        results
    }
}

impl AgentSpawner for ClaudeAgentSpawner {
    fn spawn(
        &self,
        project_root: &Path,
        task: &Task,
        config: ResolvedAgentConfig,
        resume_session: Option<&str>,
        on_complete: AgentCompletionCallback,
    ) -> Result<SpawnResult, SpawnError> {
        let task_id = task.id.clone();
        let session_type = config.session_type.clone();
        let pending_dir = self.pending_outputs_dir.clone();

        // Determine working directory (worktree path if available)
        let working_dir = task
            .worktree_path
            .as_ref()
            .map(PathBuf::from)
            .unwrap_or_else(|| project_root.to_path_buf());

        // Prepare environment
        let path_env = crate::process::prepare_path_env();

        // Spawn the process
        let mut child = spawn_claude_process(
            &working_dir,
            &path_env,
            resume_session,
            config.json_schema.as_deref(),
        )
        .map_err(|e| SpawnError::ProcessSpawnFailed(e.to_string()))?;

        let pid = child.id();

        // Create process guard for cleanup
        let guard = ProcessGuard::new(pid);

        // Write prompt to stdin
        write_prompt_to_stdin(&mut child, &config.prompt)
            .map_err(|e| SpawnError::PromptWriteFailed(e.to_string()))?;

        // Capture stderr for logging
        let stderr_handle = spawn_stderr_reader(child.stderr.take());

        // Get stdout for reading output
        let stdout = child
            .stdout
            .take()
            .ok_or_else(|| SpawnError::ProcessSpawnFailed("No stdout".to_string()))?;

        // Spawn background thread to wait for completion
        let task_id_clone = task_id.clone();
        let session_type_clone = session_type.clone();

        thread::spawn(move || {
            // Read stdout until EOF
            let reader = std::io::BufReader::new(stdout);
            let mut full_output = String::new();
            let mut _session_id: Option<String> = None;

            for line in reader.lines() {
                match line {
                    Ok(json_line) => {
                        if json_line.trim().is_empty() {
                            continue;
                        }
                        full_output.push_str(&json_line);
                        full_output.push('\n');

                        // Try to extract session_id from init events
                        let parsed = crate::process::parse_stream_event(&json_line);
                        if let Some(sid) = parsed.session_id {
                            _session_id = Some(sid);
                        }
                    }
                    Err(e) => {
                        eprintln!("[agent] Error reading stdout: {e}");
                        break;
                    }
                }
            }

            // Wait for process to exit
            let _exit_status = child.wait();

            // Disarm the guard - process completed normally
            guard.disarm();

            // Log stderr if present
            if let Some(handle) = stderr_handle {
                if let Ok(lines) = handle.join() {
                    if !lines.is_empty() {
                        eprintln!("[agent {}] stderr: {}", task_id_clone, lines.join("\n"));
                    }
                }
            }

            // Write pending output for crash recovery
            let spawner = ClaudeAgentSpawner::new(pending_dir.clone());
            let _ = spawner.write_pending_output(&task_id_clone, &session_type_clone, &full_output);

            // Parse the output
            let result = parse_agent_output(&full_output);

            // Clear pending output on success
            if result.is_ok() {
                let _ = spawner.clear_pending_output(&task_id_clone, &session_type_clone);
            }

            // Call completion callback
            on_complete(task_id_clone, result);
        });

        // Return immediately with spawn result
        Ok(SpawnResult {
            pid,
            session_id: None, // Session ID is captured asynchronously
        })
    }

    fn spawn_sync(
        &self,
        project_root: &Path,
        task: &Task,
        config: ResolvedAgentConfig,
        resume_session: Option<&str>,
    ) -> Result<(SpawnResult, StageOutput), SpawnError> {
        let task_id = task.id.clone();
        let session_type = config.session_type.clone();

        // Determine working directory
        let working_dir = task
            .worktree_path
            .as_ref()
            .map(PathBuf::from)
            .unwrap_or_else(|| project_root.to_path_buf());

        // Prepare environment
        let path_env = crate::process::prepare_path_env();

        // Spawn the process
        let mut child = spawn_claude_process(
            &working_dir,
            &path_env,
            resume_session,
            config.json_schema.as_deref(),
        )
        .map_err(|e| SpawnError::ProcessSpawnFailed(e.to_string()))?;

        let pid = child.id();
        let guard = ProcessGuard::new(pid);

        // Write prompt to stdin
        write_prompt_to_stdin(&mut child, &config.prompt)
            .map_err(|e| SpawnError::PromptWriteFailed(e.to_string()))?;

        // Capture stderr
        let stderr_handle = spawn_stderr_reader(child.stderr.take());

        // Get stdout
        let stdout = child
            .stdout
            .take()
            .ok_or_else(|| SpawnError::ProcessSpawnFailed("No stdout".to_string()))?;

        // Read all output
        let reader = std::io::BufReader::new(stdout);
        let mut full_output = String::new();
        let mut session_id: Option<String> = None;

        for line in reader.lines() {
            match line {
                Ok(json_line) => {
                    if json_line.trim().is_empty() {
                        continue;
                    }
                    full_output.push_str(&json_line);
                    full_output.push('\n');

                    let parsed = crate::process::parse_stream_event(&json_line);
                    if let Some(sid) = parsed.session_id {
                        session_id = Some(sid);
                    }
                }
                Err(e) => {
                    eprintln!("[agent] Error reading stdout: {e}");
                    break;
                }
            }
        }

        // Wait for process
        let _ = child.wait();
        guard.disarm();

        // Log stderr
        if let Some(handle) = stderr_handle {
            if let Ok(lines) = handle.join() {
                if !lines.is_empty() {
                    eprintln!("[agent {}] stderr: {}", task_id, lines.join("\n"));
                }
            }
        }

        // Write pending output
        let _ = self.write_pending_output(&task_id, &session_type, &full_output);

        // Parse output
        let output = parse_agent_output(&full_output)
            .map_err(|e| SpawnError::InvalidConfig(e))?;

        // Clear pending on success
        let _ = self.clear_pending_output(&task_id, &session_type);

        Ok((
            SpawnResult { pid, session_id },
            output,
        ))
    }
}

// ============================================================================
// Output Parsing
// ============================================================================

/// Parse the agent output from the full stdout.
///
/// Claude outputs JSON in two modes:
/// 1. Stream JSON: Multiple JSON objects per line (system events, assistant messages)
/// 2. Structured output: A final JSON object with `structured_output` field
fn parse_agent_output(full_output: &str) -> Result<StageOutput, String> {
    // Try to find structured_output in the last JSON object
    for line in full_output.lines().rev() {
        if line.trim().is_empty() {
            continue;
        }

        // Try to parse as JSON
        if let Ok(v) = serde_json::from_str::<serde_json::Value>(line) {
            // Check for structured_output
            if let Some(structured) = v.get("structured_output") {
                if !structured.is_null() {
                    // Convert to string for StageOutput parsing
                    let structured_str = structured.to_string();
                    return StageOutput::parse(&structured_str)
                        .map_err(|e| format!("Failed to parse structured_output: {e}"));
                }
            }

            // Check for result field (older format)
            if let Some(result) = v.get("result") {
                if let Some(result_str) = result.as_str() {
                    return StageOutput::parse(result_str)
                        .map_err(|e| format!("Failed to parse result: {e}"));
                }
            }
        }
    }

    // Fallback: try to parse the entire output as a single JSON
    StageOutput::parse(full_output.trim())
        .map_err(|e| format!("Failed to parse agent output: {e}"))
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::TempDir;

    fn create_test_spawner() -> (ClaudeAgentSpawner, TempDir) {
        let temp_dir = TempDir::new().unwrap();
        let spawner = ClaudeAgentSpawner::new(temp_dir.path().join("pending-outputs"));
        (spawner, temp_dir)
    }

    #[test]
    fn test_pending_output_path() {
        let (spawner, _temp) = create_test_spawner();
        let path = spawner.pending_output_path("task-1", "planning");
        assert!(path.to_string_lossy().contains("task-1_planning.json"));
    }

    #[test]
    fn test_write_and_read_pending_output() {
        let (spawner, _temp) = create_test_spawner();

        let output = r#"{"type": "completed", "summary": "Done"}"#;
        spawner.write_pending_output("task-1", "planning", output).unwrap();

        let read = spawner.read_pending_output("task-1", "planning");
        assert_eq!(read, Some(output.to_string()));
    }

    #[test]
    fn test_clear_pending_output() {
        let (spawner, _temp) = create_test_spawner();

        let output = r#"{"type": "completed", "summary": "Done"}"#;
        spawner.write_pending_output("task-1", "planning", output).unwrap();
        spawner.clear_pending_output("task-1", "planning").unwrap();

        let read = spawner.read_pending_output("task-1", "planning");
        assert!(read.is_none());
    }

    #[test]
    fn test_list_pending_outputs() {
        let (spawner, _temp) = create_test_spawner();

        spawner.write_pending_output("task-1", "planning", "{}").unwrap();
        spawner.write_pending_output("task-2", "work", "{}").unwrap();

        let pending = spawner.list_pending_outputs();
        assert_eq!(pending.len(), 2);
        assert!(pending.iter().any(|(t, s)| t == "task-1" && s == "planning"));
        assert!(pending.iter().any(|(t, s)| t == "task-2" && s == "work"));
    }

    #[test]
    fn test_parse_agent_output_structured() {
        let output = r#"{"type": "system", "subtype": "init", "session_id": "abc"}
{"structured_output": {"type": "completed", "summary": "Work done"}}"#;

        let result = parse_agent_output(output);
        assert!(result.is_ok());
        match result.unwrap() {
            StageOutput::Completed { summary } => assert_eq!(summary, "Work done"),
            _ => panic!("Expected Completed output"),
        }
    }

    #[test]
    fn test_parse_agent_output_artifact() {
        let output = r#"{"structured_output": {"type": "plan", "content": "The implementation plan"}}"#;

        let result = parse_agent_output(output);
        assert!(result.is_ok());
        match result.unwrap() {
            StageOutput::Artifact { content } => assert!(content.contains("implementation plan")),
            _ => panic!("Expected Artifact output"),
        }
    }

    #[test]
    fn test_parse_agent_output_direct_json() {
        let output = r#"{"type": "completed", "summary": "Done"}"#;

        let result = parse_agent_output(output);
        assert!(result.is_ok());
        match result.unwrap() {
            StageOutput::Completed { summary } => assert_eq!(summary, "Done"),
            _ => panic!("Expected Completed output"),
        }
    }

    #[test]
    fn test_recover_pending_outputs() {
        let (spawner, _temp) = create_test_spawner();

        let output1 = r#"{"type": "completed", "summary": "Task 1 done"}"#;
        let output2 = r#"{"type": "artifact", "content": "Plan content"}"#;

        spawner.write_pending_output("task-1", "planning", output1).unwrap();
        spawner.write_pending_output("task-2", "work", output2).unwrap();

        let recovered = spawner.recover_pending_outputs();
        assert_eq!(recovered.len(), 2);

        for (task_id, stage, result) in recovered {
            assert!(result.is_ok(), "Failed to parse output for {task_id}/{stage}");
        }
    }
}
