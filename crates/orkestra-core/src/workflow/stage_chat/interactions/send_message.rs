//! Send a chat message to the stage agent.
//!
//! Valid when the task is in `AwaitingApproval`, `AwaitingQuestionAnswer`,
//! `AwaitingRejectionConfirmation`, or `Interrupted` phase.
//! Enters chat mode on first message, kills any existing chat process,
//! then spawns a new agent process and reads output in the background.

use std::path::{Path, PathBuf};
use std::sync::Arc;
use std::thread;

use crate::orkestra_debug;
use crate::workflow::config::WorkflowConfig;
use crate::workflow::domain::LogEntry;
use crate::workflow::execution::{AgentParser, ProviderRegistry};
use crate::workflow::ports::{WorkflowError, WorkflowResult, WorkflowStore};
use orkestra_process::{is_process_running, kill_process_tree, ProcessConfig, ProcessHandle};

/// Resume type identifier for chat messages in log entries.
pub const CHAT_RESUME_TYPE: &str = "chat";

/// Send a chat message to the stage agent.
///
/// Validates state, enters chat mode on first message, logs the user message,
/// kills any existing chat agent, then spawns a new one.
///
/// Takes `Arc<dyn WorkflowStore>` rather than `&dyn WorkflowStore` because the
/// background output reader thread needs an owned reference.
pub fn execute(
    store: Arc<dyn WorkflowStore>,
    registry: &ProviderRegistry,
    workflow: &WorkflowConfig,
    project_root: &Path,
    task_id: &str,
    message: &str,
) -> WorkflowResult<()> {
    let task = store
        .get_task(task_id)?
        .ok_or_else(|| WorkflowError::TaskNotFound(task_id.into()))?;

    if !task.can_chat() {
        return Err(WorkflowError::InvalidTransition(format!(
            "Cannot chat in state {} (expected AwaitingApproval, AwaitingQuestionAnswer, AwaitingRejectionConfirmation, or Interrupted)",
            task.state
        )));
    }

    let stage = task
        .current_stage()
        .ok_or_else(|| WorkflowError::InvalidTransition("No current stage".into()))?
        .to_string();

    let now = chrono::Utc::now().to_rfc3339();

    // Load the stage session — required for --resume
    let mut session = store.get_stage_session(task_id, &stage)?.ok_or_else(|| {
        WorkflowError::InvalidState(format!(
            "No stage session found for task {task_id} stage {stage}"
        ))
    })?;

    // First message: enter chat mode
    if !session.chat_active {
        session.enter_chat(&now);
        store.save_stage_session(&session)?;
    }

    // Store the user message as a log entry on the stage session
    store.append_log_entry(
        &session.id,
        &LogEntry::UserMessage {
            resume_type: CHAT_RESUME_TYPE.to_string(),
            content: message.to_string(),
        },
    )?;

    // Resolve worktree path for the task
    let worktree_path = resolve_worktree_path(task.worktree_path.as_deref(), project_root, task_id);

    spawn_chat_agent(
        store,
        registry,
        workflow,
        task.flow.as_deref(),
        &mut session,
        &stage,
        &worktree_path,
        message,
        &now,
    )
}

// ============================================================================
// Helpers
// ============================================================================

/// Resolve the worktree path for a task.
///
/// Uses `task.worktree_path` if set; falls back to the conventional path
/// under the project root for tasks that haven't completed setup yet.
fn resolve_worktree_path(
    worktree_path: Option<&str>,
    project_root: &Path,
    task_id: &str,
) -> PathBuf {
    worktree_path.map_or_else(
        || project_root.join(".orkestra/.worktrees").join(task_id),
        PathBuf::from,
    )
}

/// Kill any running chat agent, spawn a new one, and start reading its output in background.
#[allow(clippy::too_many_arguments)]
fn spawn_chat_agent(
    store: Arc<dyn WorkflowStore>,
    registry: &ProviderRegistry,
    workflow: &WorkflowConfig,
    task_flow: Option<&str>,
    session: &mut crate::workflow::domain::StageSession,
    stage: &str,
    worktree_path: &Path,
    message: &str,
    now: &str,
) -> WorkflowResult<()> {
    // Kill any existing chat agent process
    if let Some(pid) = session.agent_pid {
        if is_process_running(pid) {
            orkestra_debug!("stage_chat", "Killing previous chat agent (pid={})", pid);
            if let Err(e) = kill_process_tree(pid) {
                orkestra_debug!(
                    "stage_chat",
                    "Failed to kill previous chat agent (pid={}): {}",
                    pid,
                    e
                );
            }
        }
    }

    // Resolve the provider for this stage
    let model_spec = workflow.effective_model(stage, task_flow);
    let resolved = registry
        .resolve(model_spec.as_deref())
        .map_err(|e| WorkflowError::Storage(format!("Provider resolution failed: {e}")))?;

    // Validate session has a session ID for resume
    let session_id = session.claude_session_id.as_ref().ok_or_else(|| {
        WorkflowError::InvalidState(format!(
            "No agent session ID for stage {stage} — cannot resume for chat"
        ))
    })?;

    // Build chat process config — no JSON schema, resume existing session
    let config = ProcessConfig::for_chat().with_session(session_id, true);

    // Spawn via the provider's ProcessSpawner
    let mut handle = resolved
        .spawner
        .spawn(worktree_path, config)
        .map_err(|e| WorkflowError::Storage(format!("Chat agent spawn failed: {e}")))?;

    let pid = handle.pid;

    // Write message to stdin (closes stdin after write)
    handle
        .write_prompt(message)
        .map_err(|e| WorkflowError::Storage(format!("Failed to write chat message: {e}")))?;

    // Create parser before committing PID to database — if this fails, ProcessHandle drops
    // and kills the process, leaving no stale PID in the database.
    let parser = registry
        .create_parser(&resolved.provider_name)
        .map_err(|e| WorkflowError::Storage(format!("Failed to create parser: {e}")))?;

    // Update session with new PID (after all can-fail operations succeed)
    session.agent_spawned(pid, now);
    store.save_stage_session(session)?;

    // Take stderr before moving handle into background thread
    let stderr = handle.take_stderr();

    // Spawn background reader — only writes log entries, no state transitions
    let task_id_owned = session.task_id.clone();
    let session_id_owned = session.id.clone();
    let stage_owned = stage.to_string();
    thread::spawn(move || {
        read_chat_output(
            pid,
            &store,
            &session_id_owned,
            &task_id_owned,
            &stage_owned,
            parser,
            handle,
            stderr,
        );
    });

    Ok(())
}

/// Read chat agent output, parse log entries, and write to the stage session logs.
///
/// Runs in a background thread. Reads stdout, parses each line, writes log entries,
/// appends `ProcessExit` when done, and clears the PID on the session.
#[allow(clippy::too_many_arguments)]
fn read_chat_output(
    pid: u32,
    store: &Arc<dyn WorkflowStore>,
    session_id: &str,
    task_id: &str,
    stage: &str,
    mut parser: Box<dyn AgentParser>,
    mut handle: ProcessHandle,
    stderr: Option<std::process::ChildStderr>,
) {
    use std::io::BufRead;

    orkestra_debug!("stage_chat", "Chat output reader started for pid={}", pid);

    // Drain stderr in background to prevent pipe deadlock
    if let Some(stderr) = stderr {
        let _stderr_handle = thread::spawn(move || {
            let reader = std::io::BufReader::new(stderr);
            for line in reader.lines().map_while(Result::ok) {
                orkestra_debug!("stage_chat", "stderr: {}", line);
            }
        });
    }

    for line in handle.lines() {
        match line {
            Ok(line) => {
                if line.trim().is_empty() {
                    continue;
                }

                let update = parser.parse_line(&line);

                for entry in update.log_entries {
                    if let Err(e) = store.append_log_entry(session_id, &entry) {
                        orkestra_debug!("stage_chat", "Failed to append log entry: {}", e);
                    }
                }
            }
            Err(e) => {
                orkestra_debug!("stage_chat", "Error reading stdout: {}", e);
                break;
            }
        }
    }

    // Finalize parser
    let finalized = parser.finalize();
    for entry in finalized {
        if let Err(e) = store.append_log_entry(session_id, &entry) {
            orkestra_debug!("stage_chat", "Failed to append finalized log entry: {}", e);
        }
    }

    // Append ProcessExit so the frontend knows the agent is done
    if let Err(e) = store.append_log_entry(session_id, &LogEntry::ProcessExit { code: None }) {
        orkestra_debug!(
            "stage_chat",
            "Failed to append ProcessExit log entry: {}",
            e
        );
    }

    // Clear PID on session
    let now = chrono::Utc::now().to_rfc3339();
    if let Ok(Some(mut session)) = store.get_stage_session(task_id, stage) {
        // Only clear PID if this session is the one we were reading for
        if session.id == session_id {
            session.agent_finished(&now);
            if let Err(e) = store.save_stage_session(&session) {
                orkestra_debug!(
                    "stage_chat",
                    "Failed to save session after agent exit: {}",
                    e
                );
            }
        }
    }

    handle.disarm();
    orkestra_debug!("stage_chat", "Chat output reader finished for pid={}", pid);
}
