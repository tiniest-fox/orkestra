//! Process spawner port.
//!
//! This trait abstracts over process spawning, allowing the workflow system
//! to work with different process backends (real Claude CLI, mocks for testing).

use std::io::{BufRead, BufReader, Read, Write};
use std::path::Path;
use std::process::{ChildStderr, ChildStdin, ChildStdout};

use crate::process::ProcessGuard;

// ============================================================================
// Process Configuration
// ============================================================================

/// Configuration for spawning an agent process.
#[derive(Debug, Clone)]
pub struct ProcessConfig {
    /// Session ID (generated upfront). Always present for agent spawns.
    pub session_id: Option<String>,
    /// Whether this is a resume (use `--resume`) or first spawn (use `--session-id`).
    pub is_resume: bool,
    /// JSON schema for structured output (required).
    pub json_schema: String,
    /// Model identifier to pass via `--model` flag.
    /// If None, uses the provider's default model.
    pub model: Option<String>,
    /// System prompt to pass via `--system` flag.
    /// If None, no system prompt is provided.
    pub system_prompt: Option<String>,
    /// Tool patterns that the agent is not allowed to use.
    /// Providers that support tool restrictions will enforce these patterns;
    /// others will ignore them.
    pub disallowed_tools: Vec<String>,
}

impl ProcessConfig {
    /// Create a new process config with the required JSON schema.
    pub fn new(json_schema: impl Into<String>) -> Self {
        Self {
            session_id: None,
            is_resume: false,
            json_schema: json_schema.into(),
            model: None,
            system_prompt: None,
            disallowed_tools: Vec::new(),
        }
    }

    /// Set the session ID and whether it's a resume.
    #[must_use]
    pub fn with_session(mut self, session_id: impl Into<String>, is_resume: bool) -> Self {
        self.session_id = Some(session_id.into());
        self.is_resume = is_resume;
        self
    }

    /// Set the model identifier.
    #[must_use]
    pub fn with_model(mut self, model: impl Into<String>) -> Self {
        self.model = Some(model.into());
        self
    }

    /// Set the system prompt.
    #[must_use]
    pub fn with_system_prompt(mut self, prompt: impl Into<String>) -> Self {
        self.system_prompt = Some(prompt.into());
        self
    }

    /// Set the disallowed tool patterns.
    #[must_use]
    pub fn with_disallowed_tools(mut self, tools: Vec<String>) -> Self {
        self.disallowed_tools = tools;
        self
    }
}

// ============================================================================
// Process Handle
// ============================================================================

/// Handle to a spawned agent process.
///
/// Provides access to stdin/stdout for communication and ensures cleanup on drop.
pub struct ProcessHandle {
    /// Process ID.
    pub pid: u32,
    /// Stdin for writing prompts.
    stdin: Option<ChildStdin>,
    /// Stdout reader for reading output.
    stdout: BufReader<ChildStdout>,
    /// Stderr for error output (optional - may be captured separately).
    stderr: Option<ChildStderr>,
    /// Guard that kills process on drop if not disarmed.
    guard: ProcessGuard,
}

impl ProcessHandle {
    /// Create a new process handle.
    pub fn new(
        pid: u32,
        stdin: ChildStdin,
        stdout: ChildStdout,
        stderr: Option<ChildStderr>,
    ) -> Self {
        Self {
            pid,
            stdin: Some(stdin),
            stdout: BufReader::new(stdout),
            stderr,
            guard: ProcessGuard::new(pid),
        }
    }

    /// Write prompt to stdin and close it.
    pub fn write_prompt(&mut self, prompt: &str) -> std::io::Result<()> {
        if let Some(mut stdin) = self.stdin.take() {
            stdin.write_all(prompt.as_bytes())?;
            // stdin is dropped here, closing it
        }
        Ok(())
    }

    /// Read the next line from stdout.
    pub fn read_line(&mut self) -> std::io::Result<Option<String>> {
        let mut line = String::new();
        match self.stdout.read_line(&mut line) {
            Ok(0) => Ok(None), // EOF
            Ok(_) => Ok(Some(line)),
            Err(e) => Err(e),
        }
    }

    /// Get an iterator over stdout lines.
    pub fn lines(&mut self) -> impl Iterator<Item = std::io::Result<String>> + '_ {
        self.stdout.by_ref().lines()
    }

    /// Take stderr for separate handling.
    pub fn take_stderr(&mut self) -> Option<ChildStderr> {
        self.stderr.take()
    }

    /// Disarm the process guard (call when process exits normally).
    pub fn disarm(&self) {
        self.guard.disarm();
    }
}

// ============================================================================
// Process Error
// ============================================================================

/// Errors that can occur when spawning processes.
#[derive(Debug, Clone)]
pub enum ProcessError {
    /// Failed to spawn the process.
    SpawnFailed(String),
    /// Failed to write to stdin.
    StdinWriteFailed(String),
    /// Failed to read from stdout.
    StdoutReadFailed(String),
    /// Process was not found or is unavailable.
    ProcessNotFound(String),
}

impl std::fmt::Display for ProcessError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::SpawnFailed(msg) => write!(f, "Failed to spawn process: {msg}"),
            Self::StdinWriteFailed(msg) => write!(f, "Failed to write to stdin: {msg}"),
            Self::StdoutReadFailed(msg) => write!(f, "Failed to read from stdout: {msg}"),
            Self::ProcessNotFound(msg) => write!(f, "Process not found: {msg}"),
        }
    }
}

impl std::error::Error for ProcessError {}

// ============================================================================
// Process Spawner Trait
// ============================================================================

/// Port for spawning agent processes.
///
/// This trait abstracts over the actual process spawning mechanism,
/// allowing different implementations:
/// - `ClaudeProcessSpawner`: Spawns real `claude` CLI processes
/// - `OpenCodeProcessSpawner`: Spawns real `opencode` CLI processes
/// - `MockProcessSpawner`: Returns canned output for testing
pub trait ProcessSpawner: Send + Sync {
    /// Spawn an agent process.
    ///
    /// # Arguments
    /// * `working_dir` - Working directory for the process
    /// * `config` - Process configuration (resume session, JSON schema)
    ///
    /// # Returns
    /// A handle to the spawned process with access to stdin/stdout.
    fn spawn(
        &self,
        working_dir: &Path,
        config: ProcessConfig,
    ) -> Result<ProcessHandle, ProcessError>;
}

// ============================================================================
// Mock Process Spawner (for testing)
// ============================================================================

#[cfg(any(test, feature = "testutil"))]
pub mod mock {
    use super::{Path, ProcessConfig, ProcessError, ProcessHandle, ProcessSpawner};
    use std::collections::VecDeque;
    use std::sync::{Arc, Mutex};

    /// Recorded spawn call.
    #[derive(Debug, Clone)]
    pub struct SpawnCall {
        pub working_dir: std::path::PathBuf,
        pub config: ProcessConfig,
    }

    /// Mock process spawner for testing.
    ///
    /// Doesn't spawn real processes - returns configured mock output.
    pub struct MockProcessSpawner {
        calls: Arc<Mutex<Vec<SpawnCall>>>,
        outputs: Arc<Mutex<VecDeque<String>>>,
        next_pid: Arc<Mutex<u32>>,
    }

    impl Default for MockProcessSpawner {
        fn default() -> Self {
            Self::new()
        }
    }

    impl MockProcessSpawner {
        /// Create a new mock spawner.
        pub fn new() -> Self {
            Self {
                calls: Arc::new(Mutex::new(Vec::new())),
                outputs: Arc::new(Mutex::new(VecDeque::new())),
                next_pid: Arc::new(Mutex::new(10000)),
            }
        }

        /// Add an output to return for the next spawn.
        pub fn add_output(&self, output: impl Into<String>) {
            self.outputs.lock().unwrap().push_back(output.into());
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

    impl ProcessSpawner for MockProcessSpawner {
        fn spawn(
            &self,
            working_dir: &Path,
            config: ProcessConfig,
        ) -> Result<ProcessHandle, ProcessError> {
            // Record the call
            self.calls.lock().unwrap().push(SpawnCall {
                working_dir: working_dir.to_path_buf(),
                config: config.clone(),
            });

            // Get next PID
            let pid = {
                let mut next = self.next_pid.lock().unwrap();
                let pid = *next;
                *next += 1;
                pid
            };

            // Get output (or empty string)
            let output = self.outputs.lock().unwrap().pop_front().unwrap_or_default();

            // Create mock handle
            // Note: This is a simplified mock - real implementation would need
            // proper mock streams. For now we return an error since we can't
            // easily mock ChildStdin/ChildStdout.
            Err(ProcessError::SpawnFailed(format!(
                "MockProcessSpawner cannot create real handles. PID would be {pid}, output: {output}"
            )))
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_process_config_builder() {
        let config = ProcessConfig::new(r#"{"type":"object"}"#).with_session("session-123", true);

        assert_eq!(config.session_id, Some("session-123".to_string()));
        assert!(config.is_resume);
        assert_eq!(config.json_schema, r#"{"type":"object"}"#);
    }

    #[test]
    fn test_process_error_display() {
        let err = ProcessError::SpawnFailed("test".into());
        assert!(err.to_string().contains("spawn"));

        let err = ProcessError::StdinWriteFailed("test".into());
        assert!(err.to_string().contains("stdin"));
    }
}
