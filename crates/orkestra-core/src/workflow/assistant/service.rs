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
use std::sync::{Arc, Mutex};
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
use orkestra_utility::ExecutionMode;

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
                sections: Vec::new(),
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
            &self.project_root,
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

        // Resolve working directory: use worktree if available, fall back to project root for
        // chat tasks, or return error if worktree is unavailable for a non-chat task.
        let worktree_path = task.worktree_path.as_deref().and_then(|p| {
            let path = std::path::Path::new(p);
            if path.exists() {
                Some(path.to_path_buf())
            } else {
                None
            }
        });

        let working_dir = match worktree_path {
            Some(path) => path,
            None if task.is_chat => self.project_root.clone(),
            None => {
                self.store.append_assistant_log_entry(
                    &session.id,
                    &LogEntry::UserMessage {
                        resume_type: "message".to_string(),
                        content: message.to_string(),
                        sections: Vec::new(),
                    },
                )?;
                self.store.append_assistant_log_entry(
                    &session.id,
                    &LogEntry::Error {
                        message: "Task worktree not available — the task may have been integrated or cleaned up".to_string(),
                    },
                )?;
                return Ok(session);
            }
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
                sections: Vec::new(),
            },
        )?;

        // Spawn the agent
        let system_prompt = build_prompt(&task);
        let spawn_result = self.spawn_agent_in(
            &session,
            message,
            &working_dir,
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

/// Sentinel string Claude Code emits on stderr when `--resume <id>` references
/// a session it no longer has on disk. Detected to recover from session loss.
const SESSION_LOST_SENTINEL: &str = "No conversation found with session ID";

/// Outcome of a single agent run, derived from whether visible content was
/// produced and what (if anything) showed up on stderr.
#[derive(Debug, PartialEq, Eq)]
enum CompletionDiagnostic {
    /// Agent produced visible content (Text / `ToolUse` / `Error` / subagent activity).
    /// No diagnostic action needed.
    Healthy,
    /// Agent exited without visible output. Stderr (possibly empty) is captured
    /// for inclusion in the surfaced error message.
    SilentFailure { stderr: String },
    /// Agent failed because Claude Code lost the resume session. Triggers state
    /// reset so the next message starts fresh.
    SessionLost,
}

/// Classify a finished agent run into one of three buckets.
///
/// Pure function so it can be unit tested without spawning a real process.
fn analyze_completion(produced_visible_content: bool, stderr: &str) -> CompletionDiagnostic {
    if produced_visible_content {
        return CompletionDiagnostic::Healthy;
    }
    if stderr.contains(SESSION_LOST_SENTINEL) {
        return CompletionDiagnostic::SessionLost;
    }
    CompletionDiagnostic::SilentFailure {
        stderr: stderr.to_string(),
    }
}

/// Build the user-visible message for a non-Healthy diagnostic.
///
/// Returns `None` for `Healthy` (nothing to surface).
fn format_diagnostic_message(diagnostic: &CompletionDiagnostic) -> Option<String> {
    match diagnostic {
        CompletionDiagnostic::Healthy => None,
        CompletionDiagnostic::SessionLost => Some(
            "The assistant session was lost (Claude Code no longer has the conversation). \
             Your next message will start a fresh conversation."
                .to_string(),
        ),
        CompletionDiagnostic::SilentFailure { stderr } => {
            let trimmed = stderr.trim();
            if trimmed.is_empty() {
                Some("Assistant agent exited without producing a response.".to_string())
            } else {
                Some(format!(
                    "Assistant agent exited without producing a response.\n\nstderr:\n{trimmed}"
                ))
            }
        }
    }
}

/// Whether a parsed log entry constitutes "visible content" — i.e., something
/// the user would see in the chat UI.
///
/// Tool results and process-lifecycle markers don't count; only entries that
/// render as text, tool calls, or surfaced errors do.
fn is_visible_log_entry(entry: &LogEntry) -> bool {
    matches!(
        entry,
        LogEntry::Text { .. }
            | LogEntry::ToolUse { .. }
            | LogEntry::SubagentToolUse { .. }
            | LogEntry::Error { .. }
    )
}

/// Reset a session whose Claude Code conversation was lost.
///
/// Generates a fresh `claude_session_id` and zeroes `spawn_count` so the next
/// spawn uses `--session-id <new>` instead of `--resume <stale>`.
fn reset_lost_session(
    store: &Arc<dyn WorkflowStore>,
    session_id: &str,
    now: &str,
) -> WorkflowResult<()> {
    let Some(mut session) = store.get_assistant_session(session_id)? else {
        return Ok(());
    };
    session.claude_session_id = Some(uuid::Uuid::new_v4().to_string());
    session.spawn_count = 0;
    session.updated_at = now.to_string();
    store.save_assistant_session(&session)?;
    Ok(())
}

/// Read agent output, parse log entries, and write to the store.
///
/// This runs in a background thread. It:
/// 1. Reads stdout lines from the agent process
/// 2. Parses each line through the `AgentParser`
/// 3. Writes log entries to the store
/// 4. Captures stderr in parallel — if the agent produced no visible content,
///    surfaces stderr as a `LogEntry::Error` and recovers from session loss
/// 5. On completion, disarms the `ProcessGuard` and updates session state
/// 6. Triggers title generation if this was the first spawn
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

    // Drain stderr in background thread to prevent pipe deadlock.
    // Lines are both logged (for debug.log analysis) and captured into a shared
    // buffer so we can surface fatal errors to the UI when the agent produced
    // no visible stdout content.
    let stderr_buffer: Arc<Mutex<Vec<String>>> = Arc::new(Mutex::new(Vec::new()));
    let stderr_buffer_writer = Arc::clone(&stderr_buffer);
    let stderr_handle = thread::spawn(move || {
        let reader = std::io::BufReader::new(stderr);
        for line in reader.lines().map_while(Result::ok) {
            orkestra_debug!("assistant", "stderr: {}", line);
            if let Ok(mut buf) = stderr_buffer_writer.lock() {
                buf.push(line);
            }
        }
    });

    // Read stdout line by line
    let reader = std::io::BufReader::new(stdout);
    let mut produced_visible_content = false;

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
                    if is_visible_log_entry(&entry) {
                        produced_visible_content = true;
                    }
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
        if is_visible_log_entry(&entry) {
            produced_visible_content = true;
        }
        if let Err(e) = store.append_assistant_log_entry(session_id, &entry) {
            orkestra_debug!("assistant", "Failed to append finalized log entry: {}", e);
        }
    }

    // Wait for the stderr drainer to finish so the buffer captures everything
    // the process wrote before exit. The thread exits when the process closes
    // its stderr pipe, so this is a quick join.
    let _ = stderr_handle.join();
    let stderr_content = stderr_buffer
        .lock()
        .map(|buf| buf.join("\n"))
        .unwrap_or_default();

    // Classify the run and surface a diagnostic if needed.
    let now = chrono::Utc::now().to_rfc3339();
    let diagnostic = analyze_completion(produced_visible_content, &stderr_content);
    if let Some(message) = format_diagnostic_message(&diagnostic) {
        if let Err(e) = store.append_assistant_log_entry(session_id, &LogEntry::Error { message }) {
            orkestra_debug!("assistant", "Failed to append diagnostic log entry: {}", e);
        }
    }
    if matches!(diagnostic, CompletionDiagnostic::SessionLost) {
        if let Err(e) = reset_lost_session(store, session_id, &now) {
            orkestra_debug!("assistant", "Failed to reset lost session: {}", e);
        }
    }

    // Append ProcessExit log entry so frontend knows agent is done
    if let Err(e) =
        store.append_assistant_log_entry(session_id, &LogEntry::ProcessExit { code: None })
    {
        orkestra_debug!("assistant", "Failed to append ProcessExit log entry: {}", e);
    }

    // Mark agent as finished. Re-load the session to pick up any state changes
    // made by `reset_lost_session` above so we don't clobber them.
    if let Ok(Some(mut session)) = store.get_assistant_session(session_id) {
        session.agent_finished(&now);
        let _ = store.save_assistant_session(&session);

        // Bump task.updated_at so differential polling re-fetches the chat task's
        // assistant_active field (which just transitioned from true → false).
        if let Some(ref task_id) = session.task_id {
            if let Ok(Some(mut task)) = store.get_task(task_id) {
                task.updated_at.clone_from(&now);
                let _ = store.save_task(&task);
            }
        }

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
    let title = match generate_title_sync(first_message, 30, ExecutionMode::SingleTurn) {
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
            sections: Vec::new(),
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

    // ========================================================================
    // Completion diagnostic tests (visibility + recovery for empty agent runs)
    // ========================================================================

    #[test]
    fn analyze_completion_visible_content_is_healthy() {
        let result = analyze_completion(true, "some stderr noise");
        assert_eq!(result, CompletionDiagnostic::Healthy);
    }

    #[test]
    fn analyze_completion_no_content_no_stderr_is_silent_failure() {
        let result = analyze_completion(false, "");
        assert_eq!(
            result,
            CompletionDiagnostic::SilentFailure {
                stderr: String::new()
            }
        );
    }

    #[test]
    fn analyze_completion_no_content_with_stderr_is_silent_failure() {
        let result = analyze_completion(false, "some unrecognized error");
        assert_eq!(
            result,
            CompletionDiagnostic::SilentFailure {
                stderr: "some unrecognized error".to_string(),
            }
        );
    }

    #[test]
    fn analyze_completion_session_lost_takes_priority() {
        let stderr = "some preamble\nNo conversation found with session ID: abc-123\nmore noise";
        let result = analyze_completion(false, stderr);
        assert_eq!(result, CompletionDiagnostic::SessionLost);
    }

    #[test]
    fn analyze_completion_visible_content_overrides_session_lost_sentinel() {
        // If the agent did produce content, even a session-lost-shaped stderr
        // shouldn't trigger recovery — visible content always wins.
        let stderr = "No conversation found with session ID: abc-123";
        let result = analyze_completion(true, stderr);
        assert_eq!(result, CompletionDiagnostic::Healthy);
    }

    #[test]
    fn format_diagnostic_message_healthy_returns_none() {
        let msg = format_diagnostic_message(&CompletionDiagnostic::Healthy);
        assert_eq!(msg, None);
    }

    #[test]
    fn format_diagnostic_message_session_lost_explains_recovery() {
        let msg = format_diagnostic_message(&CompletionDiagnostic::SessionLost)
            .expect("session lost should produce a message");
        assert!(msg.contains("session was lost"));
        assert!(msg.contains("fresh conversation"));
    }

    #[test]
    fn format_diagnostic_message_silent_failure_includes_stderr() {
        let diagnostic = CompletionDiagnostic::SilentFailure {
            stderr: "auth: invalid token\n".to_string(),
        };
        let msg = format_diagnostic_message(&diagnostic).expect("must produce a message");
        assert!(msg.contains("exited without producing a response"));
        assert!(msg.contains("auth: invalid token"));
    }

    #[test]
    fn format_diagnostic_message_silent_failure_omits_stderr_section_when_empty() {
        let diagnostic = CompletionDiagnostic::SilentFailure {
            stderr: "   \n  ".to_string(),
        };
        let msg = format_diagnostic_message(&diagnostic).expect("must produce a message");
        assert!(msg.contains("exited without producing a response"));
        assert!(!msg.contains("stderr:"));
    }

    #[test]
    fn is_visible_log_entry_classifies_correctly() {
        assert!(is_visible_log_entry(&LogEntry::Text {
            content: "hi".into()
        }));
        assert!(is_visible_log_entry(&LogEntry::Error {
            message: "boom".into()
        }));
        assert!(is_visible_log_entry(&LogEntry::ToolUse {
            tool: "Bash".into(),
            id: "t1".into(),
            input: orkestra_types::domain::ToolInput::Bash {
                command: "ls".into()
            },
        }));
        assert!(is_visible_log_entry(&LogEntry::SubagentToolUse {
            tool: "Read".into(),
            id: "t2".into(),
            input: orkestra_types::domain::ToolInput::Read {
                file_path: "/tmp/x".into()
            },
            parent_task_id: "p1".into(),
        }));

        // Not visible
        assert!(!is_visible_log_entry(&LogEntry::ProcessExit {
            code: Some(0)
        }));
        assert!(!is_visible_log_entry(&LogEntry::UserMessage {
            resume_type: "message".into(),
            content: "user said".into(),
            sections: Vec::new(),
        }));
        assert!(!is_visible_log_entry(&LogEntry::ToolResult {
            tool: "Bash".into(),
            tool_use_id: "t1".into(),
            content: "stdout".into(),
        }));
    }

    #[test]
    fn reset_lost_session_assigns_new_claude_session_id_and_zeros_spawn_count() {
        let store: Arc<dyn crate::workflow::ports::WorkflowStore> =
            Arc::new(InMemoryWorkflowStore::new());
        let now = chrono::Utc::now().to_rfc3339();
        let mut session = AssistantSession::new("session-1", &now);
        session.claude_session_id = Some("stale-session".to_string());
        session.spawn_count = 3;
        store.save_assistant_session(&session).unwrap();

        let later = "2026-04-15T20:30:00Z";
        reset_lost_session(&store, "session-1", later).unwrap();

        let reloaded = store.get_assistant_session("session-1").unwrap().unwrap();
        assert_eq!(reloaded.spawn_count, 0);
        let new_id = reloaded
            .claude_session_id
            .expect("claude_session_id should be regenerated, not cleared");
        assert_ne!(
            new_id, "stale-session",
            "claude_session_id should be a new UUID, not the lost one"
        );
        assert_eq!(reloaded.updated_at, later);
    }

    #[test]
    fn reset_lost_session_is_noop_when_session_missing() {
        let store: Arc<dyn crate::workflow::ports::WorkflowStore> =
            Arc::new(InMemoryWorkflowStore::new());
        // Should not error even though the session doesn't exist.
        reset_lost_session(&store, "nonexistent", "2026-04-15T20:30:00Z").unwrap();
    }
}
