//! Assistant service for managing project-level and task-scoped chat sessions.
//!
//! This service provides the core business logic for the assistant chat panel:
//! - Creating new chat sessions (project-level and task-scoped)
//! - Spawning/resuming Claude Code processes
//! - Storing user messages and agent logs
//! - Stopping running processes
//! - Generating session titles
//! - Retrieving session history

#[cfg(unix)]
use libc;
use std::io::BufRead;
use std::path::{Path, PathBuf};
use std::sync::Arc;
use std::thread;

use crate::orkestra_debug;
use crate::title::{generate_fallback_title, generate_title_sync};
use crate::workflow::domain::{AssistantSession, LogEntry, Task};
use crate::workflow::execution::{AgentParser, ProviderRegistry};
use crate::workflow::ports::{WorkflowError, WorkflowResult, WorkflowStore};
use orkestra_agent::interactions::spawner::cli_path::prepare_path_env;
use orkestra_agent::resolve_agent_env;
use orkestra_process::{is_process_running, kill_process_tree, ProcessGuard};
use orkestra_types::domain::SessionType;

// ============================================================================
// Constants
// ============================================================================

/// Disallowed tools for the read-only assistant: restricts file modification.
const ASSISTANT_DISALLOWED_TOOLS: &str =
    "EnterPlanMode,ExitPlanMode,Edit,Write,NotebookEdit,AskUserQuestion";

/// Disallowed tools for the interactive session: only platform invariants.
const INTERACTIVE_DISALLOWED_TOOLS: &str = "EnterPlanMode,ExitPlanMode";

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
                if let Err(e) = kill_process_tree(pid) {
                    orkestra_debug!("assistant", "Failed to kill agent (pid={}): {}", pid, e);
                }
            }
        }

        // Spawn the agent (or resume the session)
        let system_prompt = Self::load_system_prompt();
        let spawn_result = self.spawn_agent_in(
            &session,
            message,
            &self.project_root.clone(),
            &system_prompt,
            ASSISTANT_DISALLOWED_TOOLS,
        );

        self.handle_spawn_result(&mut session, spawn_result, &now)?;

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
                if let Err(e) = kill_process_tree(pid) {
                    orkestra_debug!("assistant", "Failed to stop agent (pid={}): {}", pid, e);
                }
            }
        }

        let now = chrono::Utc::now().to_rfc3339();
        session.agent_finished(&now);
        self.store.save_assistant_session(&session)?;

        Ok(())
    }

    /// Send a message to the task-scoped assistant session for `task_id`.
    ///
    /// Creates a new session if none exists for this task, or reuses the existing one.
    /// Spawns Claude Code in the task's worktree for task-specific context.
    ///
    /// Returns the session even if spawn fails — spawn failures are written as
    /// `LogEntry::Error` to the session's logs so the UI can display them.
    pub fn send_task_message(
        &self,
        task_id: &str,
        message: &str,
    ) -> WorkflowResult<AssistantSession> {
        self.send_task_scoped_message(
            task_id,
            message,
            SessionType::Assistant,
            Self::build_task_system_prompt,
            ASSISTANT_DISALLOWED_TOOLS,
        )
    }

    /// Send a message to the interactive session for `task_id`.
    ///
    /// The interactive session runs with full file-editing capabilities (no tool restrictions
    /// beyond the platform invariants). The session type is `SessionType::Interactive`.
    /// Creates a new interactive session if none exists for this task.
    ///
    /// Returns the session even if spawn fails — spawn failures are written as
    /// `LogEntry::Error` to the session's logs so the UI can display them.
    pub fn send_interactive_task_message(
        &self,
        task_id: &str,
        message: &str,
    ) -> WorkflowResult<AssistantSession> {
        self.send_task_scoped_message(
            task_id,
            message,
            SessionType::Interactive,
            Self::build_interactive_system_prompt,
            INTERACTIVE_DISALLOWED_TOOLS,
        )
    }

    /// Shared logic for task-scoped message sending (assistant and interactive).
    ///
    /// Handles the full lifecycle: empty check, task load, session get-or-create,
    /// worktree validation, kill previous agent, store user message, spawn agent.
    fn send_task_scoped_message(
        &self,
        task_id: &str,
        message: &str,
        session_type: SessionType,
        build_prompt: fn(&Task) -> String,
        disallowed_tools: &str,
    ) -> WorkflowResult<AssistantSession> {
        let now = chrono::Utc::now().to_rfc3339();

        if message.trim().is_empty() {
            return Err(WorkflowError::InvalidState(
                "Message cannot be empty".to_string(),
            ));
        }

        // Load the task — must exist
        let task = self
            .store
            .get_task(task_id)?
            .ok_or_else(|| WorkflowError::InvalidState(format!("Task not found: {task_id}")))?;

        // Build the new session upfront so it's ready for atomic get-or-create
        let new_session_id = uuid::Uuid::new_v4().to_string();
        let claude_session_id = uuid::Uuid::new_v4().to_string();
        let mut new_session = AssistantSession::new(&new_session_id, &now).with_task(task_id);
        if session_type == SessionType::Interactive {
            new_session = new_session.with_interactive_type();
        }
        new_session.claude_session_id = Some(claude_session_id);

        // Atomically get the existing session or create a new one
        let mut session = self.store.get_or_create_assistant_session_for_task(
            task_id,
            &session_type,
            &new_session,
        )?;

        // Validate worktree exists
        let worktree_path = task.worktree_path.as_deref().and_then(|p| {
            let path = std::path::Path::new(p);
            if path.exists() {
                Some(path.to_path_buf())
            } else {
                None
            }
        });

        let Some(worktree) = worktree_path else {
            self.store.append_assistant_log_entry(
                &session.id,
                &LogEntry::UserMessage {
                    resume_type: "message".to_string(),
                    content: message.to_string(),
                },
            )?;
            self.store.append_assistant_log_entry(
                &session.id,
                &LogEntry::Error {
                    message: "Task worktree not available — the task may have been integrated or cleaned up".to_string(),
                },
            )?;
            return Ok(session);
        };

        // Kill any running agent before spawning a new one
        if let Some(pid) = session.agent_pid {
            if is_process_running(pid) {
                orkestra_debug!("assistant", "Killing previous agent (pid={})", pid);
                if let Err(e) = kill_process_tree(pid) {
                    orkestra_debug!("assistant", "Failed to kill agent (pid={}): {}", pid, e);
                }
            }
        }

        // Store the user message as a log entry
        self.store.append_assistant_log_entry(
            &session.id,
            &LogEntry::UserMessage {
                resume_type: "message".to_string(),
                content: message.to_string(),
            },
        )?;

        // Spawn the agent
        let system_prompt = build_prompt(&task);
        let spawn_result = self.spawn_agent_in(
            &session,
            message,
            &worktree,
            &system_prompt,
            disallowed_tools,
        );

        self.handle_spawn_result(&mut session, spawn_result, &now)?;

        Ok(session)
    }

    /// List project-level assistant sessions (excludes task-scoped sessions).
    pub fn list_project_sessions(&self) -> WorkflowResult<Vec<AssistantSession>> {
        self.store.list_project_assistant_sessions()
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
    ///
    /// Used by `send_message` (project-level) and `send_task_scoped_message` (task-scoped).
    /// The caller provides the working directory, system prompt, and disallowed tools string.
    #[allow(clippy::unused_self)]
    fn spawn_agent_in(
        &self,
        session: &AssistantSession,
        message: &str,
        working_dir: &Path,
        system_prompt: &str,
        disallowed_tools: &str,
    ) -> std::io::Result<(u32, std::process::ChildStdout, std::process::ChildStderr)> {
        let shell = std::env::var("SHELL").ok();
        let env = resolve_agent_env(working_dir, shell.as_deref());
        let is_resume = session.spawn_count > 0;

        let mut child = spawn_claude_process(
            working_dir,
            env,
            session.claude_session_id.as_deref(),
            is_resume,
            system_prompt,
            disallowed_tools,
        )?;

        let pid = child.id();

        // Write the user message to stdin and close it
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

    /// Handle the result of a spawn attempt.
    ///
    /// On success: records spawn in session state, saves session, and starts the output reader.
    /// On failure: writes a `LogEntry::Error` to the session logs instead of propagating.
    fn handle_spawn_result(
        &self,
        session: &mut AssistantSession,
        spawn_result: std::io::Result<(u32, std::process::ChildStdout, std::process::ChildStderr)>,
        now: &str,
    ) -> WorkflowResult<()> {
        match spawn_result {
            Ok((pid, stdout, stderr)) => {
                // Capture spawn count before incrementing (for title generation check)
                let spawn_count_before = session.spawn_count;

                // Update session state
                session.agent_spawned(pid, now);
                self.store.save_assistant_session(session)?;

                // Spawn background thread to read agent output
                self.spawn_output_reader(session, spawn_count_before, pid, stdout, stderr);
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
        Ok(())
    }

    /// Build the task-specific system prompt with task context interpolated.
    fn build_task_system_prompt(task: &Task) -> String {
        let artifacts_text = if task.artifacts.is_empty() {
            "No artifacts yet.".to_string()
        } else {
            task.artifacts
                .all()
                .map(|a| format!("### {}\n\n{}", a.name, a.content))
                .collect::<Vec<_>>()
                .join("\n\n---\n\n")
        };

        crate::prompts::TASK_ASSISTANT_SYSTEM_PROMPT
            .replace("{task_id}", &task.id)
            .replace("{task_title}", &task.title)
            .replace("{task_description}", &task.description)
            .replace("{current_stage}", &task.state.to_string())
            .replace("{artifacts}", &artifacts_text)
    }

    /// Build the interactive-mode system prompt with task context interpolated.
    fn build_interactive_system_prompt(task: &Task) -> String {
        crate::prompts::INTERACTIVE_SYSTEM_PROMPT
            .replace("{task_id}", &task.id)
            .replace("{task_title}", &task.title)
            .replace("{task_description}", &task.description)
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

    // Append ProcessExit log entry so frontend knows agent is done
    if let Err(e) =
        store.append_assistant_log_entry(session_id, &LogEntry::ProcessExit { code: None })
    {
        orkestra_debug!("assistant", "Failed to append ProcessExit log entry: {}", e);
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

// ============================================================================
// Claude assistant process spawning
// ============================================================================

/// Spawns a Claude process for assistant or interactive sessions.
///
/// The caller passes `disallowed_tools` to control capability restrictions:
/// - Assistant (read-only): use `ASSISTANT_DISALLOWED_TOOLS`
/// - Interactive (edit-capable): use `INTERACTIVE_DISALLOWED_TOOLS`
fn spawn_claude_process(
    working_dir: &std::path::Path,
    env: Option<std::collections::HashMap<String, String>>,
    session_id: Option<&str>,
    is_resume: bool,
    system_prompt: &str,
    disallowed_tools: &str,
) -> std::io::Result<std::process::Child> {
    use std::process::{Command, Stdio};

    #[cfg(unix)]
    use std::os::unix::process::CommandExt;

    let mut cmd = Command::new("claude");

    if let Some(sid) = session_id {
        if is_resume {
            cmd.args(["--resume", sid]);
        } else {
            cmd.args(["--session-id", sid]);
        }
    }

    cmd.args(["--print", "--verbose"]);
    cmd.args(["--output-format", "stream-json"]);
    cmd.args(["--dangerously-skip-permissions"]);
    cmd.args(["--disallowedTools", disallowed_tools]);

    if !is_resume {
        cmd.args(["--system-prompt", system_prompt]);
    }

    if let Some(env_map) = env {
        cmd.env_clear();
        cmd.envs(env_map);
        cmd.env("CLAUDE_CODE_DISABLE_BACKGROUND_TASKS", "1");
    } else {
        cmd.env("PATH", prepare_path_env())
            .env("CLAUDE_CODE_DISABLE_BACKGROUND_TASKS", "1");
    }

    cmd.current_dir(working_dir)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());

    #[cfg(unix)]
    // setsid() creates a new session with no controlling terminal, preventing
    // SIGTTOU when zsh -i calls tcsetpgrp() from a background process group.
    unsafe {
        cmd.pre_exec(|| {
            libc::setsid();
            Ok(())
        });
    }

    cmd.spawn()
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::workflow::adapters::InMemoryWorkflowStore;
    use crate::workflow::execution::{
        claudecode_aliases, claudecode_capabilities, ProviderRegistry,
    };
    use crate::workflow::ports::MockProcessSpawner;

    fn create_test_service() -> (AssistantService, Arc<InMemoryWorkflowStore>) {
        let store = Arc::new(InMemoryWorkflowStore::new());

        // Create minimal registry with mock spawner (spawn calls will fail
        // but AssistantService gracefully handles spawn failures by writing
        // LogEntry::Error to the session logs)
        let mut registry = ProviderRegistry::new("claudecode");
        registry.register(
            "claudecode",
            Arc::new(MockProcessSpawner::new()) as Arc<dyn crate::workflow::ports::ProcessSpawner>,
            claudecode_capabilities(),
            claudecode_aliases(),
        );

        let service = AssistantService::new(
            Arc::clone(&store) as Arc<dyn crate::workflow::ports::WorkflowStore>,
            Arc::new(registry),
            std::env::temp_dir(), // project_root (not used in pure logic tests)
        );
        (service, store)
    }

    #[test]
    fn test_send_message_creates_new_session() {
        let (service, store) = create_test_service();

        // Call send_message with no session ID
        let session = service.send_message(None, "hello").unwrap();

        // Assert the returned session has a non-empty id
        assert!(!session.id.is_empty());

        // Assert claude_session_id is Some(...)
        assert!(session.claude_session_id.is_some());

        // Assert the session is saved in the store
        let loaded_session = store.get_assistant_session(&session.id).unwrap();
        assert!(loaded_session.is_some());
        assert_eq!(loaded_session.unwrap().id, session.id);
    }

    #[test]
    fn test_send_message_loads_existing_session() {
        let (service, store) = create_test_service();

        // Pre-create a session with a known ID
        let known_id = "known-session-id";
        let claude_session_id = "claude-session-123";
        let now = chrono::Utc::now().to_rfc3339();
        let mut session = AssistantSession::new(known_id, &now);
        session.claude_session_id = Some(claude_session_id.to_string());
        store.save_assistant_session(&session).unwrap();

        // Call send_message with the known ID
        let returned_session = service.send_message(Some(known_id), "hello").unwrap();

        // Assert the returned session has the same ID as the pre-created one
        assert_eq!(returned_session.id, known_id);
        assert_eq!(
            returned_session.claude_session_id.as_deref(),
            Some(claude_session_id)
        );
    }

    #[test]
    fn test_send_message_session_not_found() {
        let (service, _store) = create_test_service();

        // Call send_message with a nonexistent session ID
        let result = service.send_message(Some("nonexistent"), "hello");

        // Assert it returns an error
        assert!(result.is_err());

        // Assert the error message contains "not found"
        let err_msg = result.unwrap_err().to_string();
        assert!(
            err_msg.to_lowercase().contains("not found"),
            "Expected error message to contain 'not found', got: {err_msg}"
        );
    }

    #[test]
    fn test_send_message_stores_user_message() {
        let (service, store) = create_test_service();

        // Call send_message
        let session = service.send_message(None, "test message").unwrap();

        // Query logs from store
        let logs = store.get_assistant_log_entries(&session.id).unwrap();

        // Assert the first log entry is UserMessage
        assert!(!logs.is_empty(), "Expected at least one log entry");
        match &logs[0] {
            LogEntry::UserMessage { content, .. } => {
                assert_eq!(content, "test message");
            }
            _ => panic!(
                "Expected first log entry to be UserMessage, got: {:?}",
                logs[0]
            ),
        }
    }

    #[test]
    fn test_send_message_empty_message_rejected() {
        let (service, store) = create_test_service();

        // Test empty string
        let result1 = service.send_message(None, "");
        assert!(result1.is_err(), "Expected empty string to be rejected");

        // Test whitespace only
        let result2 = service.send_message(None, "   ");
        assert!(
            result2.is_err(),
            "Expected whitespace string to be rejected"
        );

        // Test newlines and tabs
        let result3 = service.send_message(None, "\n\t");
        assert!(
            result3.is_err(),
            "Expected newline/tab string to be rejected"
        );

        // Verify no sessions were created
        let sessions = store.list_assistant_sessions().unwrap();
        assert!(
            sessions.is_empty(),
            "Expected no sessions to be created, found: {}",
            sessions.len()
        );
    }

    #[test]
    fn test_stop_process_nonexistent_session() {
        let (service, _store) = create_test_service();

        // Call stop_process with a nonexistent session ID
        let result = service.stop_process("nonexistent");

        // Assert it returns an error
        assert!(result.is_err());

        // Assert the error message contains "not found"
        let err_msg = result.unwrap_err().to_string();
        assert!(
            err_msg.to_lowercase().contains("not found"),
            "Expected error message to contain 'not found', got: {err_msg}"
        );
    }

    #[test]
    fn test_list_sessions_delegates_to_store() {
        let (service, store) = create_test_service();

        // Pre-create 2 sessions with different timestamps
        let now = chrono::Utc::now();
        let session1_time = (now - chrono::Duration::seconds(10)).to_rfc3339();
        let session2_time = now.to_rfc3339();

        let session1 = AssistantSession::new("session-1", &session1_time);
        let session2 = AssistantSession::new("session-2", &session2_time);

        store.save_assistant_session(&session1).unwrap();
        store.save_assistant_session(&session2).unwrap();

        // Call list_sessions
        let result = service.list_sessions().unwrap();

        // Assert returns 2 sessions
        assert_eq!(result.len(), 2);

        // Assert ordered by created_at DESC (most recent first)
        assert_eq!(result[0].id, "session-2");
        assert_eq!(result[1].id, "session-1");
    }

    #[test]
    fn test_get_session_logs_delegates_to_store() {
        let (service, store) = create_test_service();

        // Pre-create a session
        let session_id = "test-session";
        let now = chrono::Utc::now().to_rfc3339();
        let session = AssistantSession::new(session_id, &now);
        store.save_assistant_session(&session).unwrap();

        // Append 2 log entries
        let user_msg = LogEntry::UserMessage {
            resume_type: "message".to_string(),
            content: "first message".to_string(),
        };
        let text_msg = LogEntry::Text {
            content: "response".to_string(),
        };

        store
            .append_assistant_log_entry(session_id, &user_msg)
            .unwrap();
        store
            .append_assistant_log_entry(session_id, &text_msg)
            .unwrap();

        // Call get_session_logs
        let entries = service.get_session_logs(session_id).unwrap();

        // Assert returns exactly 2 entries in order
        assert_eq!(entries.len(), 2);
        match &entries[0] {
            LogEntry::UserMessage { content, .. } => {
                assert_eq!(content, "first message");
            }
            _ => panic!("Expected first log to be UserMessage"),
        }
        match &entries[1] {
            LogEntry::Text { content } => {
                assert_eq!(content, "response");
            }
            _ => panic!("Expected second log to be Text"),
        }
    }

    // ========================================================================
    // Task-scoped session tests
    // ========================================================================

    /// Create a task with a `worktree_path` pointing to a temp dir.
    fn create_task_with_worktree(
        store: &Arc<InMemoryWorkflowStore>,
        task_id: &str,
        worktree_path: &str,
    ) {
        let now = chrono::Utc::now().to_rfc3339();
        let mut task = Task::new(
            task_id,
            "Test Task",
            "A test task description",
            "work",
            &now,
        );
        task.worktree_path = Some(worktree_path.to_string());
        store.save_task(&task).expect("save_task should succeed");
    }

    #[test]
    fn test_send_task_message_creates_new_session() {
        let (service, store) = create_test_service();
        let task_id = "task-abc";
        let worktree = std::env::temp_dir();
        create_task_with_worktree(&store, task_id, worktree.to_str().unwrap());

        let session = service
            .send_task_message(task_id, "hello from task")
            .unwrap();

        // Session should have task_id set
        assert_eq!(session.task_id.as_deref(), Some(task_id));
        assert!(!session.id.is_empty());
        assert!(session.claude_session_id.is_some());
    }

    #[test]
    fn test_send_task_message_reuses_existing_session() {
        let (service, store) = create_test_service();
        let task_id = "task-reuse";
        let worktree = std::env::temp_dir();
        create_task_with_worktree(&store, task_id, worktree.to_str().unwrap());

        // First message — creates session
        let session1 = service.send_task_message(task_id, "first message").unwrap();

        // Second message — reuses session
        let session2 = service
            .send_task_message(task_id, "second message")
            .unwrap();

        assert_eq!(session1.id, session2.id, "Same session should be reused");
    }

    #[test]
    fn test_send_task_message_task_not_found() {
        let (service, _store) = create_test_service();

        let result = service.send_task_message("nonexistent-task", "hello");

        assert!(result.is_err());
        let err_msg = result.unwrap_err().to_string();
        assert!(
            err_msg.to_lowercase().contains("not found"),
            "Expected 'not found' in error, got: {err_msg}"
        );
    }

    #[test]
    fn test_send_task_message_empty_message_rejected() {
        let (service, store) = create_test_service();
        let task_id = "task-empty";
        let worktree = std::env::temp_dir();
        create_task_with_worktree(&store, task_id, worktree.to_str().unwrap());

        let result = service.send_task_message(task_id, "");
        assert!(result.is_err(), "Empty message should be rejected");

        let result = service.send_task_message(task_id, "   ");
        assert!(
            result.is_err(),
            "Whitespace-only message should be rejected"
        );
    }

    #[test]
    fn test_list_project_sessions_excludes_task_sessions() {
        let (service, store) = create_test_service();
        let now = chrono::Utc::now().to_rfc3339();

        // Create a project-level session
        let project_session = AssistantSession::new("project-session", &now);
        store.save_assistant_session(&project_session).unwrap();

        // Create a task-scoped session
        let task_session = AssistantSession::new("task-session", &now).with_task("some-task");
        store.save_assistant_session(&task_session).unwrap();

        // list_project_sessions should only return the project-level one
        let project_sessions = service.list_project_sessions().unwrap();
        assert_eq!(project_sessions.len(), 1);
        assert_eq!(project_sessions[0].id, "project-session");

        // list_sessions should return both
        let all_sessions = service.list_sessions().unwrap();
        assert_eq!(all_sessions.len(), 2);
    }

    #[test]
    fn test_get_or_create_assistant_session_for_task_returns_same_session() {
        let (_service, store) = create_test_service();
        let task_id = "task-idempotent";
        let now = chrono::Utc::now().to_rfc3339();

        // Build a candidate new session
        let new_session = AssistantSession::new("session-a", &now).with_task(task_id);

        // First call — should create and return session-a
        let s1 = store
            .get_or_create_assistant_session_for_task(
                task_id,
                &SessionType::Assistant,
                &new_session,
            )
            .unwrap();
        assert_eq!(s1.id, "session-a");

        // Second call with a different candidate — should return the existing session-a
        let another = AssistantSession::new("session-b", &now).with_task(task_id);
        let s2 = store
            .get_or_create_assistant_session_for_task(task_id, &SessionType::Assistant, &another)
            .unwrap();
        assert_eq!(
            s2.id, "session-a",
            "Should return the existing session, not create a second one"
        );

        // Verify only one session exists in the store for this task
        let sessions = store.list_assistant_sessions().unwrap();
        let task_sessions: Vec<_> = sessions
            .iter()
            .filter(|s| s.task_id.as_deref() == Some(task_id))
            .collect();
        assert_eq!(
            task_sessions.len(),
            1,
            "Only one session should exist for the task"
        );
    }
}
