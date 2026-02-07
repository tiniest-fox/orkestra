//! Assistant service for managing project-level chat sessions.
//!
//! This service provides the core business logic for the assistant chat panel:
//! - Creating new chat sessions
//! - Spawning/resuming Claude Code processes
//! - Storing user messages and agent logs
//! - Stopping running processes
//! - Generating session titles
//! - Retrieving session history

use std::io::BufRead;
use std::path::PathBuf;
use std::sync::Arc;
use std::thread;

use crate::orkestra_debug;
use crate::process::{is_process_running, kill_process_tree, ProcessGuard};
use crate::title::{generate_fallback_title, generate_title_sync};
use crate::workflow::domain::{AssistantSession, LogEntry};
use crate::workflow::execution::{AgentParser, ProviderRegistry};
use crate::workflow::ports::{WorkflowResult, WorkflowStore};

// ============================================================================
// AssistantService
// ============================================================================

/// Service for managing assistant chat sessions.
///
/// This service encapsulates all assistant business logic:
/// - Session creation and lifecycle management
/// - Process spawning with session continuity
/// - Log storage via the store
/// - Title generation (after first response)
pub struct AssistantService {
    store: Arc<dyn WorkflowStore>,
    registry: Arc<ProviderRegistry>,
    project_root: PathBuf,
}

impl AssistantService {
    /// Create a new assistant service.
    pub fn new(
        store: Arc<dyn WorkflowStore>,
        registry: Arc<ProviderRegistry>,
        project_root: PathBuf,
    ) -> Self {
        Self {
            store,
            registry,
            project_root,
        }
    }

    /// Send a message to an assistant session.
    ///
    /// If `session_id` is None, creates a new session. Otherwise, loads the existing session.
    /// Stores the user message, spawns/resumes Claude Code, and streams log entries to the store.
    ///
    /// Returns the session (not an error) even if spawn fails — spawn failures are written
    /// as `LogEntry::Error` to the session's logs so the UI can display them.
    pub fn send_message(
        &self,
        session_id: Option<&str>,
        message: &str,
    ) -> WorkflowResult<AssistantSession> {
        let now = chrono::Utc::now().to_rfc3339();

        if message.trim().is_empty() {
            return Err(crate::workflow::ports::WorkflowError::InvalidState(
                "Message cannot be empty".to_string(),
            ));
        }

        // Load or create session
        let mut session = if let Some(id) = session_id {
            self.store.get_assistant_session(id)?.ok_or_else(|| {
                crate::workflow::ports::WorkflowError::InvalidState(format!(
                    "Assistant session not found: {id}"
                ))
            })?
        } else {
            let new_session_id = uuid::Uuid::new_v4().to_string();
            let claude_session_id = uuid::Uuid::new_v4().to_string();
            let mut session = AssistantSession::new(&new_session_id, &now);
            session.claude_session_id = Some(claude_session_id);
            self.store.save_assistant_session(&session)?;
            session
        };

        // Store the user message as a log entry
        self.store.append_assistant_log_entry(
            &session.id,
            &LogEntry::UserMessage {
                resume_type: "message".to_string(),
                content: message.to_string(),
            },
        )?;

        // Kill any running agent before spawning a new one
        if let Some(pid) = session.agent_pid {
            if is_process_running(pid) {
                orkestra_debug!("assistant", "Killing previous agent (pid={})", pid);
                let _ = kill_process_tree(pid);
            }
        }

        // Spawn the agent (or resume the session)
        let spawn_result = self.spawn_agent(&session, message);

        match spawn_result {
            Ok((pid, stdout, stderr)) => {
                // Capture spawn count before incrementing (for title generation check)
                let spawn_count_before = session.spawn_count;

                // Update session state
                session.agent_spawned(pid, &now);
                self.store.save_assistant_session(&session)?;

                // Spawn background thread to read agent output
                self.spawn_output_reader(&session, spawn_count_before, pid, stdout, stderr);
            }
            Err(e) => {
                // Write error to session logs instead of failing
                orkestra_debug!("assistant", "Agent spawn failed: {}", e);
                self.store.append_assistant_log_entry(
                    &session.id,
                    &LogEntry::Error {
                        message: format!("Failed to spawn agent: {e}"),
                    },
                )?;
            }
        }

        Ok(session)
    }

    /// Stop the running agent process for a session.
    pub fn stop_process(&self, session_id: &str) -> WorkflowResult<()> {
        let mut session = self
            .store
            .get_assistant_session(session_id)?
            .ok_or_else(|| {
                crate::workflow::ports::WorkflowError::InvalidState(format!(
                    "Assistant session not found: {session_id}"
                ))
            })?;

        if let Some(pid) = session.agent_pid {
            if is_process_running(pid) {
                orkestra_debug!("assistant", "Stopping agent (pid={})", pid);
                let _ = kill_process_tree(pid);
            }
        }

        let now = chrono::Utc::now().to_rfc3339();
        session.agent_finished(&now);
        self.store.save_assistant_session(&session)?;

        Ok(())
    }

    /// List all assistant sessions ordered by `created_at` DESC.
    pub fn list_sessions(&self) -> WorkflowResult<Vec<AssistantSession>> {
        self.store.list_assistant_sessions()
    }

    /// Get log entries for a session.
    pub fn get_session_logs(&self, session_id: &str) -> WorkflowResult<Vec<LogEntry>> {
        self.store.get_assistant_log_entries(session_id)
    }

    // ========================================================================
    // Internal helpers
    // ========================================================================

    /// Spawn the Claude Code agent process and return (pid, stdout, stderr).
    fn spawn_agent(
        &self,
        session: &AssistantSession,
        message: &str,
    ) -> std::io::Result<(u32, std::process::ChildStdout, std::process::ChildStderr)> {
        let path_env = crate::process::prepare_path_env();
        let is_resume = session.spawn_count > 0;

        // Load system prompt (placeholder until Subtask 5 is complete)
        let system_prompt = Self::load_system_prompt();

        let mut child = crate::process::spawn_claude_assistant_process(
            &self.project_root,
            &path_env,
            session.claude_session_id.as_deref(),
            is_resume,
            &system_prompt,
        )?;

        let pid = child.id();

        // Write the user message to stdin
        if let Some(mut stdin) = child.stdin.take() {
            use std::io::Write;
            stdin.write_all(message.as_bytes())?;
        }

        let stdout = child
            .stdout
            .take()
            .ok_or_else(|| std::io::Error::other("No stdout"))?;
        let stderr = child
            .stderr
            .take()
            .ok_or_else(|| std::io::Error::other("No stderr"))?;

        Ok((pid, stdout, stderr))
    }

    /// Load the assistant system prompt template.
    fn load_system_prompt() -> String {
        crate::prompts::ASSISTANT_SYSTEM_PROMPT.to_string()
    }

    /// Spawn a background thread to read agent output and write log entries.
    fn spawn_output_reader(
        &self,
        session: &AssistantSession,
        spawn_count_before_spawn: u32,
        pid: u32,
        stdout: std::process::ChildStdout,
        stderr: std::process::ChildStderr,
    ) {
        let store = Arc::clone(&self.store);
        let session_id = session.id.clone();

        // Create the parser for Claude Code output
        let parser = match self.registry.create_parser("claudecode") {
            Ok(p) => p,
            Err(e) => {
                orkestra_debug!("assistant", "Failed to create parser: {}", e);
                return;
            }
        };

        thread::spawn(move || {
            read_assistant_output(
                pid,
                &store,
                &session_id,
                spawn_count_before_spawn,
                parser,
                stdout,
                stderr,
            );
        });
    }
}

// ============================================================================
// Background thread for reading agent output
// ============================================================================

/// Read agent output, parse log entries, and write to the store.
///
/// This runs in a background thread. It:
/// 1. Reads stdout lines from the agent process
/// 2. Parses each line through the `AgentParser`
/// 3. Writes log entries to the store
/// 4. On completion, disarms the `ProcessGuard` and updates session state
/// 5. Triggers title generation if this was the first spawn
fn read_assistant_output(
    pid: u32,
    store: &Arc<dyn WorkflowStore>,
    session_id: &str,
    spawn_count_before_spawn: u32,
    mut parser: Box<dyn AgentParser>,
    stdout: std::process::ChildStdout,
    stderr: std::process::ChildStderr,
) {
    orkestra_debug!("assistant", "Output reader started for pid={}", pid);

    // Create ProcessGuard to ensure cleanup on panic/early return
    let guard = ProcessGuard::new(pid);

    // Drain stderr in background thread to prevent pipe deadlock
    // Claude Code outputs debug info on stderr when --verbose is passed
    let _stderr_handle = thread::spawn(move || {
        let reader = std::io::BufReader::new(stderr);
        for line in reader.lines().map_while(Result::ok) {
            orkestra_debug!("assistant", "stderr: {}", line);
        }
    });

    // Read stdout line by line
    let reader = std::io::BufReader::new(stdout);

    for line in reader.lines() {
        match line {
            Ok(line) => {
                if line.trim().is_empty() {
                    continue;
                }

                // Parse the line through the agent parser
                let update = parser.parse_line(&line);

                // Write each log entry to the store
                for entry in update.log_entries {
                    if let Err(e) = store.append_assistant_log_entry(session_id, &entry) {
                        orkestra_debug!("assistant", "Failed to append log entry: {}", e);
                    }
                }
            }
            Err(e) => {
                orkestra_debug!("assistant", "Error reading stdout: {}", e);
                break;
            }
        }
    }

    // Finalize the parser (flush any buffered entries)
    let finalized = parser.finalize();
    for entry in finalized {
        if let Err(e) = store.append_assistant_log_entry(session_id, &entry) {
            orkestra_debug!("assistant", "Failed to append finalized log entry: {}", e);
        }
    }

    // Mark agent as finished
    let now = chrono::Utc::now().to_rfc3339();
    if let Ok(Some(mut session)) = store.get_assistant_session(session_id) {
        session.agent_finished(&now);
        let _ = store.save_assistant_session(&session);

        // Trigger title generation if this was the first spawn and session has no title
        if spawn_count_before_spawn == 0 && session.title.is_none() {
            // Get the first user message from the logs
            if let Ok(logs) = store.get_assistant_log_entries(session_id) {
                if let Some(first_message) = logs.iter().find_map(|entry| match entry {
                    LogEntry::UserMessage { content, .. } => Some(content.clone()),
                    _ => None,
                }) {
                    generate_and_set_title(store, session, &first_message);
                }
            }
        }
    }

    guard.disarm();
    orkestra_debug!("assistant", "Output reader finished for pid={}", pid);
}

/// Generate a title for the session based on the first user message.
fn generate_and_set_title(
    store: &Arc<dyn WorkflowStore>,
    mut session: AssistantSession,
    first_message: &str,
) {
    let title = match generate_title_sync(first_message, 30) {
        Ok(t) => t,
        Err(e) => {
            orkestra_debug!(
                "assistant",
                "Title generation failed: {}, using fallback",
                e
            );
            generate_fallback_title(first_message)
        }
    };

    let now = chrono::Utc::now().to_rfc3339();
    session.set_title(title, &now);
    let _ = store.save_assistant_session(&session);
}
