//! Agent runner for executing agent processes.
//!
//! This module provides the execution layer for running agents. It handles:
//! - Provider resolution from model spec via `ProviderRegistry`
//! - Process spawning via the resolved provider's `ProcessSpawner`
//! - Prompt writing to stdin
//! - Output streaming and session ID extraction
//! - Output parsing to `StageOutput`
//!
//! The runner does NOT handle:
//! - Session management (caller's responsibility)
//! - Prompt building (receives prompt as input)

use std::path::PathBuf;
use std::sync::mpsc::{self, Receiver, Sender};
use std::sync::Arc;
use std::thread;

use crate::orkestra_debug;

use super::output::StageOutput;
use super::parser::parse_output_with_text_fallback;
use crate::workflow::domain::LogEntry;
use crate::workflow::ports::{ProcessConfig, ProcessError, ProcessSpawner};
use crate::workflow::services::stream_parser::{
    ClaudeStreamParser, OpenCodeStreamParser, StreamParser,
};

use super::provider_registry::ProviderRegistry;

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
// Run Events
// ============================================================================

/// Events emitted during async agent execution.
#[derive(Debug, Clone)]
pub enum RunEvent {
    /// A parsed log entry from the agent's stdout stream.
    LogLine(LogEntry),
    /// Agent completed with parsed output.
    Completed(Result<StageOutput, String>),
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
    /// Failed to parse the output.
    ParseFailed(String),
}

impl std::fmt::Display for RunError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::SpawnFailed(msg) => write!(f, "Failed to spawn agent: {msg}"),
            Self::PromptWriteFailed(msg) => write!(f, "Failed to write prompt: {msg}"),
            Self::OutputReadFailed(msg) => write!(f, "Failed to read output: {msg}"),
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
// Agent Runner Trait
// ============================================================================

/// Trait for running agents.
///
/// This abstraction allows for both real process execution and mock testing.
pub trait AgentRunnerTrait: Send + Sync {
    /// Run an agent synchronously (blocking).
    fn run_sync(&self, config: RunConfig) -> Result<RunResult, RunError>;

    /// Run an agent asynchronously with events.
    fn run_async(&self, config: RunConfig) -> Result<(u32, Receiver<RunEvent>), RunError>;
}

// ============================================================================
// Agent Runner (Production)
// ============================================================================

/// Runs agents to completion using the provider registry.
///
/// The runner is responsible for:
/// - Resolving the provider from the model spec via `ProviderRegistry`
/// - Spawning the process via the resolved provider's `ProcessSpawner`
/// - Writing the prompt to stdin
/// - Reading and parsing output
/// - Extracting session ID from stream events
///
/// The runner is NOT responsible for:
/// - Building prompts (receives them)
/// - Managing sessions (returns `session_id`)
/// - Task state updates (caller handles)
pub struct AgentRunner {
    registry: Arc<ProviderRegistry>,
}

impl AgentRunner {
    /// Create a new agent runner with the given provider registry.
    pub fn new_with_registry(registry: Arc<ProviderRegistry>) -> Self {
        Self { registry }
    }

    /// Create a new agent runner with a single process spawner (backward compat).
    ///
    /// Wraps the spawner in a registry as the default "claudecode" provider.
    pub fn new(spawner: Arc<dyn ProcessSpawner>) -> Self {
        use super::provider_registry::{claudecode_aliases, claudecode_capabilities};
        let mut registry = ProviderRegistry::new("claudecode");
        registry.register(
            "claudecode",
            spawner,
            claudecode_capabilities(),
            claudecode_aliases(),
        );
        Self {
            registry: Arc::new(registry),
        }
    }
}

impl AgentRunnerTrait for AgentRunner {
    /// Run an agent synchronously (blocking).
    fn run_sync(&self, config: RunConfig) -> Result<RunResult, RunError> {
        orkestra_debug!(
            "runner",
            "run_sync: session_id={:?}, is_resume={}, model={:?}",
            config.session_id,
            config.is_resume,
            config.model
        );

        // Resolve provider from model spec
        let resolved = self
            .registry
            .resolve(config.model.as_deref())
            .map_err(|e| RunError::SpawnFailed(e.to_string()))?;

        // Create the appropriate stream parser based on provider
        let mut parser: Box<dyn StreamParser> = match resolved.provider_name.as_str() {
            "opencode" => Box::new(OpenCodeStreamParser::new()),
            _ => Box::new(ClaudeStreamParser::new()),
        };

        // Parse the schema for validation (before moving json_schema to process_config)
        let schema: Option<serde_json::Value> = serde_json::from_str(&config.json_schema).ok();

        // Build process config with resolved model ID
        let process_config = ProcessConfig {
            session_id: config.session_id,
            is_resume: config.is_resume,
            json_schema: config.json_schema,
            model: resolved.model_id,
        };

        // Spawn the process via the resolved provider's spawner
        let mut handle = resolved
            .spawner
            .spawn(&config.working_dir, process_config)
            .map_err(RunError::from)?;

        orkestra_debug!("runner", "run_sync: spawned process");

        // Capture stderr in a background thread so we can use it for error messages
        let stderr_handle = handle.take_stderr().map(|stderr| {
            thread::spawn(move || {
                use std::io::BufRead;
                let reader = std::io::BufReader::new(stderr);
                let mut lines = Vec::new();
                for line in reader.lines().map_while(Result::ok) {
                    lines.push(line);
                }
                lines
            })
        });

        // Write prompt to stdin
        handle
            .write_prompt(&config.prompt)
            .map_err(|e| RunError::PromptWriteFailed(e.to_string()))?;

        // Read all output, tracking last text entry for fallback parsing
        let mut full_output = String::new();
        let mut last_text: Option<String> = None;
        let mut line_count: usize = 0;

        for line_result in handle.lines() {
            match line_result {
                Ok(line) => {
                    if line.trim().is_empty() {
                        continue;
                    }
                    line_count += 1;
                    if let Some(error_msg) = extract_stream_error(&line) {
                        return Err(RunError::ParseFailed(error_msg));
                    }
                    for entry in parser.parse_line(&line) {
                        if let LogEntry::Text { ref content } = entry {
                            last_text = Some(content.clone());
                        }
                    }
                    full_output.push_str(&line);
                    full_output.push('\n');
                }
                Err(e) => {
                    return Err(RunError::OutputReadFailed(e.to_string()));
                }
            }
        }

        for entry in parser.finalize() {
            if let LogEntry::Text { ref content } = entry {
                last_text = Some(content.clone());
            }
        }

        // Process completed normally
        handle.disarm();

        // Collect stderr
        let stderr_lines = collect_stderr(stderr_handle);

        orkestra_debug!("runner", "run_sync: output_len={}", full_output.len());

        // If stdout produced nothing, the agent likely crashed. Use stderr for the error.
        if line_count == 0 {
            let error_msg = stderr_error_message(&stderr_lines);
            return Err(RunError::ParseFailed(error_msg));
        }

        // Parse output: tries raw JSONL first (Claude Code), falls back to last
        // text content (OpenCode where structured output is in text events).
        let parsed_output =
            parse_output_with_text_fallback(&full_output, last_text.as_deref(), schema.as_ref())
                .map_err(RunError::ParseFailed)?;

        orkestra_debug!("runner", "run_sync: parsed output successfully");

        Ok(RunResult {
            raw_output: full_output,
            parsed_output,
        })
    }

    /// Run an agent asynchronously with events.
    fn run_async(&self, config: RunConfig) -> Result<(u32, Receiver<RunEvent>), RunError> {
        orkestra_debug!(
            "runner",
            "run_async: session_id={:?}, is_resume={}, model={:?}",
            config.session_id,
            config.is_resume,
            config.model
        );

        // Resolve provider from model spec
        let resolved = self
            .registry
            .resolve(config.model.as_deref())
            .map_err(|e| RunError::SpawnFailed(e.to_string()))?;

        // Create the appropriate stream parser based on provider
        let parser: Box<dyn StreamParser> = match resolved.provider_name.as_str() {
            "opencode" => Box::new(OpenCodeStreamParser::new()),
            _ => Box::new(ClaudeStreamParser::new()),
        };

        // Build process config with resolved model ID
        let process_config = ProcessConfig {
            session_id: config.session_id.clone(),
            is_resume: config.is_resume,
            json_schema: config.json_schema.clone(),
            model: resolved.model_id,
        };

        // Spawn the process via the resolved provider's spawner
        let mut handle = resolved
            .spawner
            .spawn(&config.working_dir, process_config)
            .map_err(RunError::from)?;

        let pid = handle.pid;

        orkestra_debug!("runner", "run_async: spawned pid={}", pid);

        // Write prompt to stdin
        handle
            .write_prompt(&config.prompt)
            .map_err(|e| RunError::PromptWriteFailed(e.to_string()))?;

        // Create event channel
        let (tx, rx) = mpsc::channel();

        // Parse the schema for validation
        let schema: Option<serde_json::Value> = serde_json::from_str(&config.json_schema).ok();

        // Spawn background thread to read output and emit log events
        thread::spawn(move || {
            read_output_and_send_events(handle, &tx, schema.as_ref(), parser);
        });

        Ok((pid, rx))
    }
}

/// Check if a stream JSON line contains an error event from the agent.
///
/// Claude Code emits events with an `"error"` field when API calls fail
/// (e.g. model not found, rate limits). Without detection, the stop hook
/// retries infinitely. Returns the error message text if found.
fn extract_stream_error(line: &str) -> Option<String> {
    let v: serde_json::Value = serde_json::from_str(line).ok()?;

    // Only treat events with an explicit "error" field as errors
    v.get("error")?;

    // Extract the text content from the message for a useful error message
    let content = v
        .get("message")
        .and_then(|m| m.get("content"))
        .and_then(|c| c.as_array())
        .and_then(|arr| arr.first())
        .and_then(|item| item.get("text"))
        .and_then(|t| t.as_str())
        .unwrap_or("Unknown agent error");

    Some(content.to_string())
}

/// Join the stderr reader thread and return collected lines.
fn collect_stderr(handle: Option<thread::JoinHandle<Vec<String>>>) -> Vec<String> {
    let Some(handle) = handle else {
        return Vec::new();
    };
    match handle.join() {
        Ok(lines) => {
            if !lines.is_empty() {
                orkestra_debug!("runner", "stderr ({} lines):", lines.len());
                for line in &lines {
                    orkestra_debug!("runner", "  stderr: {}", line);
                }
            }
            lines
        }
        Err(_) => Vec::new(),
    }
}

/// Build an error message from stderr lines when the agent produced no stdout.
///
/// Looks for known error patterns (e.g. `Error:`, `throw new`, stack traces)
/// and returns the most useful line. Falls back to a generic message.
fn stderr_error_message(stderr_lines: &[String]) -> String {
    // Look for lines that contain an explicit error message
    for line in stderr_lines {
        let trimmed = line.trim();
        // OpenCode throws named errors like "ProviderModelNotFoundError: ..."
        if trimmed.contains("Error:") || trimmed.contains("error:") {
            return format!("Agent process failed: {trimmed}");
        }
    }
    // Fall back to joining all non-empty stderr as context
    let joined: String = stderr_lines
        .iter()
        .filter(|l| !l.trim().is_empty())
        .map(|l| l.trim().to_string())
        .collect::<Vec<_>>()
        .join(" | ");
    if joined.is_empty() {
        "Agent process exited without producing any output".to_string()
    } else {
        format!("Agent process failed: {joined}")
    }
}

/// Read output from process, parse stream lines, and send events.
fn read_output_and_send_events(
    mut handle: crate::workflow::ports::ProcessHandle,
    tx: &Sender<RunEvent>,
    schema: Option<&serde_json::Value>,
    mut parser: Box<dyn StreamParser>,
) {
    // Spawn a thread to collect stderr so we can log it on failure
    let stderr_handle = handle.take_stderr().map(|stderr| {
        thread::spawn(move || {
            use std::io::BufRead;
            let reader = std::io::BufReader::new(stderr);
            let mut lines = Vec::new();
            for line in reader.lines().map_while(Result::ok) {
                lines.push(line);
            }
            lines
        })
    });

    let mut full_output = String::new();
    let mut last_text: Option<String> = None;
    let mut line_count: usize = 0;
    let mut log_entry_count: usize = 0;

    for line_result in handle.lines() {
        match line_result {
            Ok(line) => {
                if line.trim().is_empty() {
                    continue;
                }
                line_count += 1;

                // Log raw lines for debugging stream format issues
                orkestra_debug!("runner", "stdout line {}: {}", line_count, line);

                // Detect error events from the agent (e.g. API 404, rate limits).
                // These have an "error" field at the top level of the JSON event.
                // Without this check, Claude Code loops forever retrying via stop hooks.
                if let Some(error_msg) = extract_stream_error(&line) {
                    orkestra_debug!("runner", "Agent error detected: {}", error_msg);
                    let _ = tx.send(RunEvent::Completed(Err(error_msg)));
                    return;
                }

                // Parse the line for log entries before accumulating
                let entries = parser.parse_line(&line);
                orkestra_debug!(
                    "runner",
                    "  parsed {} log entries from line {}",
                    entries.len(),
                    line_count
                );
                for entry in entries {
                    log_entry_count += 1;
                    if let LogEntry::Text { ref content } = entry {
                        last_text = Some(content.clone());
                    }
                    if tx.send(RunEvent::LogLine(entry)).is_err() {
                        orkestra_debug!("runner", "Channel closed while sending LogLine");
                        return;
                    }
                }

                full_output.push_str(&line);
                full_output.push('\n');
            }
            Err(e) => {
                orkestra_debug!("runner", "Error reading stdout: {}", e);
                // Send error completion so orchestrator knows something went wrong
                if tx
                    .send(RunEvent::Completed(Err(format!(
                        "Failed to read agent output: {e}"
                    ))))
                    .is_err()
                {
                    orkestra_debug!("runner", "Channel closed before read error could be sent");
                }
                return; // Exit - don't try to parse partial output
            }
        }
    }

    // Finalize the parser to flush any buffered entries
    for entry in parser.finalize() {
        if let LogEntry::Text { ref content } = entry {
            last_text = Some(content.clone());
        }
        if tx.send(RunEvent::LogLine(entry)).is_err() {
            orkestra_debug!("runner", "Channel closed while sending finalized LogLine");
            return;
        }
    }

    // Process completed normally
    handle.disarm();

    // Collect stderr
    let stderr_lines = collect_stderr(stderr_handle);

    orkestra_debug!(
        "runner",
        "stream ended: {} lines read, {} log entries produced, output_len={}",
        line_count,
        log_entry_count,
        full_output.len()
    );

    // If stdout produced nothing, the agent likely crashed. Use stderr for the error.
    if line_count == 0 {
        let error_msg = stderr_error_message(&stderr_lines);
        orkestra_debug!("runner", "Zero stdout lines — agent crashed: {}", error_msg);
        let _ = tx.send(RunEvent::Completed(Err(error_msg)));
        return;
    }

    // Parse output: tries raw JSONL first (Claude Code), falls back to last
    // text content (OpenCode where structured output is in text events).
    let result = parse_output_with_text_fallback(&full_output, last_text.as_deref(), schema);
    if tx.send(RunEvent::Completed(result)).is_err() {
        orkestra_debug!("runner", "Channel closed before completion could be sent");
    }
}

// ============================================================================
// Mock Agent Runner (for testing)
// ============================================================================

#[cfg(any(test, feature = "testutil"))]
pub mod mock {
    use super::{
        mpsc, thread, AgentRunnerTrait, Receiver, RunConfig, RunError, RunEvent, RunResult,
        StageOutput,
    };
    use std::collections::HashMap;
    use std::sync::atomic::{AtomicU32, Ordering};
    use std::sync::Mutex;

    /// Mock agent runner for testing.
    ///
    /// Allows setting expected outputs for tasks without spawning real processes.
    /// Outputs are queued per task and consumed in order.
    pub struct MockAgentRunner {
        /// Queue of outputs per `task_id`. Each spawn consumes the next output.
        outputs: Mutex<HashMap<String, Vec<StageOutput>>>,
        /// Next PID to assign.
        next_pid: AtomicU32,
        /// Recorded calls.
        calls: Mutex<Vec<RunConfig>>,
    }

    impl Default for MockAgentRunner {
        fn default() -> Self {
            Self::new()
        }
    }

    impl MockAgentRunner {
        /// Create a new mock agent runner.
        pub fn new() -> Self {
            Self {
                outputs: Mutex::new(HashMap::new()),
                next_pid: AtomicU32::new(10000),
                calls: Mutex::new(Vec::new()),
            }
        }

        /// Set the output for the next agent spawn for a task.
        /// Can be called multiple times to queue multiple outputs.
        pub fn set_output(&self, task_id: &str, output: StageOutput) {
            self.outputs
                .lock()
                .unwrap()
                .entry(task_id.to_string())
                .or_default()
                .push(output);
        }

        /// Get recorded calls.
        pub fn calls(&self) -> Vec<RunConfig> {
            self.calls.lock().unwrap().clone()
        }

        /// Clear recorded calls.
        pub fn clear_calls(&self) {
            self.calls.lock().unwrap().clear();
        }

        /// Extract `task_id` from the prompt (looks for "Task ID: xxx" pattern).
        fn extract_task_id(prompt: &str) -> Option<String> {
            for line in prompt.lines() {
                if line.contains("Task ID") {
                    // Try to extract the ID after the colon
                    if let Some(id) = line.split(':').nth(1) {
                        let id = id.trim().trim_matches('*').trim();
                        if !id.is_empty() {
                            return Some(id.to_string());
                        }
                    }
                }
            }
            None
        }
    }

    impl AgentRunnerTrait for MockAgentRunner {
        fn run_sync(&self, config: RunConfig) -> Result<RunResult, RunError> {
            // Record the call
            self.calls.lock().unwrap().push(config.clone());

            // Use task_id from config, or extract from prompt as fallback
            let task_id = config
                .task_id
                .clone()
                .or_else(|| Self::extract_task_id(&config.prompt))
                .ok_or_else(|| RunError::SpawnFailed("Could not determine task_id".into()))?;

            // Get and remove the next configured output (consume from queue)
            let output = self
                .outputs
                .lock()
                .unwrap()
                .get_mut(&task_id)
                .and_then(|queue| {
                    if queue.is_empty() {
                        None
                    } else {
                        Some(queue.remove(0))
                    }
                })
                .ok_or_else(|| {
                    RunError::SpawnFailed(format!("No output configured for task {task_id}"))
                })?;

            // Generate fake raw output
            let raw_output = serde_json::to_string(&serde_json::json!({
                "structured_output": output_to_json(&output)
            }))
            .unwrap();

            Ok(RunResult {
                raw_output,
                parsed_output: output,
            })
        }

        fn run_async(&self, config: RunConfig) -> Result<(u32, Receiver<RunEvent>), RunError> {
            // Record the call
            self.calls.lock().unwrap().push(config.clone());

            let pid = self.next_pid.fetch_add(1, Ordering::Relaxed);
            let (tx, rx) = mpsc::channel();

            // Use task_id from config, or extract from prompt as fallback
            let task_id = config
                .task_id
                .clone()
                .or_else(|| Self::extract_task_id(&config.prompt));

            // Get and remove the next configured output (consume from queue)
            let output = task_id.as_ref().and_then(|id| {
                self.outputs.lock().unwrap().get_mut(id).and_then(|queue| {
                    if queue.is_empty() {
                        None
                    } else {
                        Some(queue.remove(0))
                    }
                })
            });

            // Spawn thread to send events
            let task_id_for_error = task_id.clone();
            thread::spawn(move || {
                // Small delay to simulate async behavior
                thread::sleep(std::time::Duration::from_millis(10));

                if let Some(output) = output {
                    // Send completion
                    let _ = tx.send(RunEvent::Completed(Ok(output)));
                } else {
                    let err_msg = match task_id_for_error {
                        Some(id) => format!("No output configured for task {id}"),
                        None => "No output configured (task_id unknown)".to_string(),
                    };
                    let _ = tx.send(RunEvent::Completed(Err(err_msg)));
                }
            });

            Ok((pid, rx))
        }
    }

    /// Convert `StageOutput` to JSON value for mock raw output.
    fn output_to_json(output: &StageOutput) -> serde_json::Value {
        match output {
            StageOutput::Artifact { content } => serde_json::json!({
                "type": "artifact",
                "content": content
            }),
            StageOutput::Questions { questions } => serde_json::json!({
                "type": "questions",
                "questions": questions
            }),
            StageOutput::Approval { decision, content } => serde_json::json!({
                "type": "approval",
                "decision": decision,
                "content": content
            }),
            StageOutput::Subtasks {
                content,
                subtasks,
                skip_reason,
            } => {
                let mut json = serde_json::json!({
                    "type": "subtasks",
                    "content": content,
                    "subtasks": subtasks
                });
                if let Some(reason) = skip_reason {
                    json["skip_reason"] = serde_json::json!(reason);
                }
                json
            }
            StageOutput::Failed { error } => serde_json::json!({
                "type": "failed",
                "error": error
            }),
            StageOutput::Blocked { reason } => serde_json::json!({
                "type": "blocked",
                "reason": reason
            }),
        }
    }
}

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
    }

    #[test]
    fn test_run_error_display() {
        let err = RunError::SpawnFailed("test".into());
        assert!(err.to_string().contains("spawn"));

        let err = RunError::PromptWriteFailed("test".into());
        assert!(err.to_string().contains("prompt"));

        let err = RunError::ParseFailed("test".into());
        assert!(err.to_string().contains("parse"));
    }

    // Note: parse_agent_output tests are in parser.rs

    #[cfg(any(test, feature = "testutil"))]
    mod mock_tests {
        use super::*;
        use mock::MockAgentRunner;

        const TEST_SCHEMA: &str = r#"{"type":"object"}"#;

        #[test]
        fn test_mock_runner_sync() {
            let runner = MockAgentRunner::new();
            runner.set_output(
                "task-1",
                StageOutput::Artifact {
                    content: "Done".into(),
                },
            );

            let config = RunConfig::new("/tmp", "**Task ID**: task-1\nDo the work", TEST_SCHEMA);
            let result = runner.run_sync(config).unwrap();

            assert!(matches!(result.parsed_output, StageOutput::Artifact { .. }));
        }

        #[test]
        fn test_mock_runner_async() {
            let runner = MockAgentRunner::new();
            runner.set_output(
                "task-2",
                StageOutput::Artifact {
                    content: "Plan".into(),
                },
            );

            let config = RunConfig::new("/tmp", "**Task ID**: task-2\nPlan this", TEST_SCHEMA);
            let (pid, rx) = runner.run_async(config).unwrap();

            assert!(pid >= 10000);

            // Collect events
            let mut events = Vec::new();
            while let Ok(event) = rx.recv_timeout(std::time::Duration::from_millis(100)) {
                events.push(event);
            }

            assert!(events
                .iter()
                .any(|e| matches!(e, RunEvent::Completed(Ok(_)))));
        }

        #[test]
        fn test_mock_runner_records_calls() {
            let runner = MockAgentRunner::new();
            runner.set_output(
                "task-1",
                StageOutput::Artifact {
                    content: "Done".into(),
                },
            );

            let config = RunConfig::new("/tmp", "**Task ID**: task-1\nDo work", TEST_SCHEMA);
            let _ = runner.run_sync(config);

            let calls = runner.calls();
            assert_eq!(calls.len(), 1);
            assert!(calls[0].prompt.contains("task-1"));
        }
    }
}
