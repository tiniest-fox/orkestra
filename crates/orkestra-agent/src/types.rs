//! Core types for agent execution.
//!
//! Defines the request/response contract for `AgentRunner`: `RunConfig` (builder),
//! `RunResult`, `RunEvent`, and `RunError`.

use std::collections::HashMap;
use std::path::PathBuf;

use orkestra_parser::StageOutput;
use orkestra_process::ProcessError;
use orkestra_types::domain::LogEntry;
use orkestra_types::domain::PromptSection;

// ============================================================================
// Run Configuration
// ============================================================================

/// Configuration for running an agent.
#[derive(Debug, Clone)]
pub struct RunConfig {
    /// Working directory for the agent process.
    pub working_dir: PathBuf,
    /// The prompt to send to the agent.
    pub prompt: String,
    /// JSON schema for structured output (required).
    pub json_schema: String,
    /// Session ID (generated upfront, always present).
    pub session_id: Option<String>,
    /// Whether this is a resume (use --resume) or first spawn (use --session-id).
    pub is_resume: bool,
    /// Task ID (used by mock runner for output queue lookup).
    /// Not used by the real runner.
    pub task_id: Option<String>,
    /// Model identifier to pass to the process spawner (e.g., "claudecode/sonnet").
    /// If None, uses the provider's default model.
    pub model: Option<String>,
    /// System prompt to pass via CLI flag (if provider supports it).
    pub system_prompt: Option<String>,
    /// Tool patterns that the agent is not allowed to use.
    /// Threaded to `ProcessConfig` and ultimately to the CLI flag.
    pub disallowed_tools: Vec<String>,
    /// Resolved project environment. When `Some`, the spawner clears inherited
    /// env and uses this map as the base. When `None`, inherits the process env.
    pub env: Option<HashMap<String, String>>,
    /// Dynamic prompt sections to attach to the `UserMessage` log entry.
    /// Non-empty only for fresh spawns with dynamic context (feedback, conflicts, etc.).
    pub prompt_sections: Vec<PromptSection>,
}

impl RunConfig {
    /// Create a new run configuration.
    ///
    /// JSON schema is required - we always need structured output from agents.
    pub fn new(
        working_dir: impl Into<PathBuf>,
        prompt: impl Into<String>,
        json_schema: impl Into<String>,
    ) -> Self {
        Self {
            working_dir: working_dir.into(),
            prompt: prompt.into(),
            json_schema: json_schema.into(),
            session_id: None,
            is_resume: false,
            task_id: None,
            model: None,
            system_prompt: None,
            disallowed_tools: Vec::new(),
            env: None,
            prompt_sections: Vec::new(),
        }
    }

    /// Set the task ID (for mock runner output queue lookup).
    #[must_use]
    pub fn with_task_id(mut self, task_id: impl Into<String>) -> Self {
        self.task_id = Some(task_id.into());
        self
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

    /// Set the resolved project environment.
    #[must_use]
    pub fn with_env(mut self, env: HashMap<String, String>) -> Self {
        self.env = Some(env);
        self
    }

    /// Set dynamic prompt sections to attach to the `UserMessage` log entry.
    #[must_use]
    pub fn with_prompt_sections(mut self, sections: Vec<PromptSection>) -> Self {
        self.prompt_sections = sections;
        self
    }
}

// ============================================================================
// Run Result
// ============================================================================

/// Result of running an agent to completion.
#[derive(Debug, Clone)]
pub struct RunResult {
    /// The raw stdout output.
    pub raw_output: String,
    /// The parsed stage output.
    pub parsed_output: StageOutput,
}

// ============================================================================
// Agent Completion Error
// ============================================================================

/// Distinguishes how an agent execution failed.
#[derive(Debug, Clone)]
pub enum AgentCompletionError {
    /// Agent crashed (zero output, API error, stdout read failure).
    Crash(String),
    /// Agent produced output but it couldn't be parsed as structured output.
    MalformedOutput(String),
}

impl std::fmt::Display for AgentCompletionError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::Crash(msg) | Self::MalformedOutput(msg) => write!(f, "{msg}"),
        }
    }
}

// ============================================================================
// Run Events
// ============================================================================

/// Events emitted during async agent execution.
#[derive(Debug, Clone)]
pub enum RunEvent {
    /// A parsed log entry from the agent's stdout stream.
    LogLine(LogEntry),
    /// A session ID extracted from the stream (emitted once for providers like
    /// `OpenCode` that generate their own session IDs).
    SessionId(String),
    /// Agent completed with parsed output.
    Completed(Result<StageOutput, AgentCompletionError>),
}

// ============================================================================
// Run Error
// ============================================================================

/// Errors that can occur during agent execution.
#[derive(Debug, Clone)]
pub enum RunError {
    /// Failed to spawn the process.
    SpawnFailed(String),
    /// Failed to write prompt to stdin.
    PromptWriteFailed(String),
    /// Failed to read from stdout.
    OutputReadFailed(String),
    /// Agent produced output but no structured output could be extracted.
    ExtractionFailed(String),
    /// Failed to parse the output.
    ParseFailed(String),
}

impl std::fmt::Display for RunError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::SpawnFailed(msg) => write!(f, "Failed to spawn agent: {msg}"),
            Self::PromptWriteFailed(msg) => write!(f, "Failed to write prompt: {msg}"),
            Self::OutputReadFailed(msg) => write!(f, "Failed to read output: {msg}"),
            Self::ExtractionFailed(msg) => write!(f, "No structured output found: {msg}"),
            Self::ParseFailed(msg) => write!(f, "Failed to parse output: {msg}"),
        }
    }
}

impl std::error::Error for RunError {}

impl From<ProcessError> for RunError {
    fn from(err: ProcessError) -> Self {
        match err {
            ProcessError::SpawnFailed(msg) | ProcessError::ProcessNotFound(msg) => {
                Self::SpawnFailed(msg)
            }
            ProcessError::StdinWriteFailed(msg) => Self::PromptWriteFailed(msg),
            ProcessError::StdoutReadFailed(msg) => Self::OutputReadFailed(msg),
        }
    }
}

// ============================================================================
// Tests
// ============================================================================

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_run_config_builder() {
        let config = RunConfig::new("/tmp/work", "Do the thing", r#"{"type":"object"}"#)
            .with_session("session-123", true);

        assert_eq!(config.working_dir, PathBuf::from("/tmp/work"));
        assert_eq!(config.prompt, "Do the thing");
        assert_eq!(config.json_schema, r#"{"type":"object"}"#);
        assert_eq!(config.session_id, Some("session-123".to_string()));
        assert!(config.is_resume);
        assert_eq!(config.system_prompt, None);
    }

    #[test]
    fn test_system_prompt_threaded_to_process_config() {
        let config = RunConfig::new("/tmp/work", "User message", r#"{"type":"object"}"#)
            .with_system_prompt("System instructions here");

        assert_eq!(
            config.system_prompt,
            Some("System instructions here".to_string())
        );
    }

    #[test]
    fn test_run_error_display() {
        let err = RunError::SpawnFailed("test".into());
        assert!(err.to_string().contains("spawn"));

        let err = RunError::PromptWriteFailed("test".into());
        assert!(err.to_string().contains("prompt"));

        let err = RunError::ExtractionFailed("test".into());
        assert!(err.to_string().contains("structured output"));

        let err = RunError::ParseFailed("test".into());
        assert!(err.to_string().contains("parse"));
    }
}
