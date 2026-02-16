//! Process management types.

use std::io::{BufRead, BufReader, Read, Write};
use std::process::{ChildStderr, ChildStdin, ChildStdout};
use std::sync::atomic::{AtomicBool, Ordering};

// ============================================================================
// Process Guard
// ============================================================================

/// RAII guard that ensures a spawned process is killed when dropped.
/// This provides defense-in-depth: if code panics or takes an unexpected path,
/// the process will still be cleaned up.
///
/// Call `disarm()` when the process exits normally to prevent killing on drop.
pub struct ProcessGuard {
    pid: u32,
    disarmed: AtomicBool,
}

impl ProcessGuard {
    /// Create a new process guard for the given PID.
    pub fn new(pid: u32) -> Self {
        Self {
            pid,
            disarmed: AtomicBool::new(false),
        }
    }

    /// Disarm the guard to prevent killing the process on drop.
    /// Call this when the process exits normally.
    pub fn disarm(&self) {
        self.disarmed.store(true, Ordering::Relaxed);
    }
}

impl Drop for ProcessGuard {
    fn drop(&mut self) {
        if !self.disarmed.load(Ordering::Relaxed) {
            eprintln!(
                "[ProcessGuard] Killing orphaned process {} on drop",
                self.pid
            );
            let _ = crate::interactions::tree::kill::execute(self.pid);
        }
    }
}

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
// Parsed Stream Event
// ============================================================================

/// Result from parsing a stream event.
#[derive(Debug, Default)]
pub struct ParsedStreamEvent {
    /// Session ID if this event contains one (from system init).
    pub session_id: Option<String>,
    /// True if this event indicates new content was written to the session file.
    pub has_new_content: bool,
}

// ============================================================================
// Tests
// ============================================================================

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
