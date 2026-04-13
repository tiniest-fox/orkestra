//! Send a chat message to the stage agent.
//!
//! Valid when the task is in `AwaitingApproval`, `AwaitingQuestionAnswer`,
//! `AwaitingRejectionConfirmation`, or `Interrupted` phase.
//! Enters chat mode on first message, kills any existing chat process,
//! then spawns a new agent process and reads output in the background.

use std::path::{Path, PathBuf};
use std::sync::Arc;
use std::thread;

use super::try_complete_from_output;
use crate::orkestra_debug;
use crate::workflow::config::WorkflowConfig;
use crate::workflow::domain::{LogEntry, LogNotification};
use crate::workflow::execution::{get_agent_schema, AgentParser, ProviderRegistry};
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
///
/// `log_notify_tx` is forwarded to the background reader thread which sends one
/// `LogNotification` per batch of log entries, enabling push-based frontend updates.
pub fn execute(
    store: Arc<dyn WorkflowStore>,
    registry: &ProviderRegistry,
    workflow: &WorkflowConfig,
    project_root: &Path,
    task_id: &str,
    message: &str,
    log_notify_tx: Option<std::sync::mpsc::Sender<LogNotification>>,
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
        None,
    )?;

    // Resolve worktree path for the task
    let worktree_path = resolve_worktree_path(task.worktree_path.as_deref(), project_root, task_id);

    spawn_chat_agent(
        store,
        registry,
        workflow,
        &task.flow,
        &mut session,
        &stage,
        &worktree_path,
        project_root,
        message,
        &now,
        log_notify_tx,
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

/// Extract a hint string from the schema's type enum values.
///
/// Produces a comma-separated list like "summary, failed, blocked" for injection
/// into the chat context note so the agent knows what type values are valid.
fn schema_type_hint(schema: &serde_json::Value) -> String {
    schema
        .get("properties")
        .and_then(|p| p.get("type"))
        .and_then(|t| t.get("enum"))
        .and_then(|e| e.as_array())
        .map_or_else(
            || "summary, failed, blocked".to_string(),
            |arr| {
                arr.iter()
                    .filter_map(|v| v.as_str())
                    .collect::<Vec<_>>()
                    .join(", ")
            },
        )
}

/// Kill any running chat agent, spawn a new one, and start reading its output in background.
#[allow(clippy::too_many_arguments)]
fn spawn_chat_agent(
    store: Arc<dyn WorkflowStore>,
    registry: &ProviderRegistry,
    workflow: &WorkflowConfig,
    task_flow: &str,
    session: &mut crate::workflow::domain::StageSession,
    stage: &str,
    worktree_path: &Path,
    project_root: &Path,
    message: &str,
    now: &str,
    log_notify_tx: Option<std::sync::mpsc::Sender<LogNotification>>,
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
    let model_spec = workflow
        .stage(task_flow, stage)
        .and_then(|s| s.model.clone());
    let resolved = registry
        .resolve(model_spec.as_deref())
        .map_err(|e| WorkflowError::Storage(format!("Provider resolution failed: {e}")))?;

    // Compute stage schema for structured output detection in the background thread.
    // Uses the canonical get_agent_schema() which respects custom schema_file configs.
    let effective_stage = workflow
        .stage(task_flow, stage)
        .ok_or_else(|| WorkflowError::InvalidState(format!("Unknown stage: {stage}")))?
        .clone();
    let schema_str = get_agent_schema(&effective_stage, Some(project_root), &[])
        .ok_or_else(|| WorkflowError::InvalidState(format!("No schema for stage: {stage}")))?;
    let schema: serde_json::Value = serde_json::from_str(&schema_str).map_err(|e| {
        WorkflowError::InvalidState(format!("Generated schema is not valid JSON: {e}"))
    })?;

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

    // Prepend a context note to the message so the agent knows it can produce structured output
    let type_hint = schema_type_hint(&schema);
    let chat_context = format!(
        "[System: You are in stage chat mode. If you want to complete this stage, \
         output your structured JSON response (matching the stage's output schema) \
         as raw text — the system will detect and process it as a stage completion. \
         Your previous structured output schema had type field options including: {type_hint}]\n\n"
    );
    let full_message = format!("{chat_context}{message}");

    // Write message to stdin (closes stdin after write)
    handle
        .write_prompt(&full_message)
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

    // Spawn background reader — writes log entries and detects structured output
    let task_id_owned = session.task_id.clone();
    let session_id_owned = session.id.clone();
    let stage_owned = stage.to_string();
    let workflow_owned = workflow.clone();
    let schema_owned = schema;
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
            &workflow_owned,
            &schema_owned,
            log_notify_tx.as_ref(),
        );
    });

    Ok(())
}

/// Read chat agent output, parse log entries, and write to the stage session logs.
///
/// Runs in a background thread. Reads stdout, parses each line, writes log entries,
/// accumulates text for structured output detection, appends `ProcessExit` when done,
/// and clears the PID on the session.
///
/// Sends one `LogNotification` per batch of entries written (main loop + finalized entries),
/// enabling push-based frontend updates when a `log_notify_tx` sender is provided.
#[allow(clippy::too_many_arguments)]
#[allow(clippy::too_many_lines)]
fn read_chat_output(
    pid: u32,
    store: &Arc<dyn WorkflowStore>,
    session_id: &str,
    task_id: &str,
    stage: &str,
    mut parser: Box<dyn AgentParser>,
    mut handle: ProcessHandle,
    stderr: Option<std::process::ChildStderr>,
    workflow: &WorkflowConfig,
    schema: &serde_json::Value,
    log_notify_tx: Option<&std::sync::mpsc::Sender<LogNotification>>,
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

    let mut accumulated_text: Vec<String> = Vec::new();

    for line in handle.lines() {
        match line {
            Ok(line) => {
                if line.trim().is_empty() {
                    continue;
                }

                let update = parser.parse_line(&line);

                let mut batch_count = 0usize;
                let batch_summary = LogEntry::last_summary(&update.log_entries);
                for entry in update.log_entries {
                    if let LogEntry::Text { ref content } = entry {
                        accumulated_text.push(content.clone());
                    }
                    if let Err(e) = store.append_log_entry(session_id, &entry, None) {
                        orkestra_debug!("stage_chat", "Failed to append log entry: {}", e);
                    } else {
                        batch_count += 1;
                    }
                }

                // Send one notification per parsed batch
                if batch_count > 0 {
                    if let Some(tx) = &log_notify_tx {
                        if let Err(e) = tx.send(LogNotification {
                            task_id: task_id.to_string(),
                            session_id: session_id.to_string(),
                            last_entry_summary: batch_summary,
                        }) {
                            orkestra_debug!("stage_chat", "Log notification send failed: {}", e);
                        }
                    }
                }
            }
            Err(e) => {
                orkestra_debug!("stage_chat", "Error reading stdout: {}", e);
                break;
            }
        }
    }

    // Finalize parser and accumulate text from finalized entries
    let finalized = parser.finalize();
    let mut finalized_count = 0usize;
    let finalized_summary = LogEntry::last_summary(&finalized);
    for entry in finalized {
        if let LogEntry::Text { ref content } = entry {
            accumulated_text.push(content.clone());
        }
        if let Err(e) = store.append_log_entry(session_id, &entry, None) {
            orkestra_debug!("stage_chat", "Failed to append finalized log entry: {}", e);
        } else {
            finalized_count += 1;
        }
    }

    // Send notification for finalized entries batch
    if finalized_count > 0 {
        if let Some(tx) = &log_notify_tx {
            if let Err(e) = tx.send(LogNotification {
                task_id: task_id.to_string(),
                session_id: session_id.to_string(),
                last_entry_summary: finalized_summary,
            }) {
                orkestra_debug!("stage_chat", "Log notification send failed: {}", e);
            }
        }
    }

    // Try to detect structured output and complete the stage
    let mut detection_succeeded = false;
    if !accumulated_text.is_empty() {
        let full_text = accumulated_text.join("");
        match try_complete_from_output::execute(store, workflow, schema, task_id, stage, &full_text)
        {
            Ok(true) => {
                orkestra_debug!(
                    "stage_chat",
                    "Detected structured output in chat, stage completed for task {}",
                    task_id
                );
                detection_succeeded = true;
            }
            Ok(false) => {} // No structured output detected, continue normal flow
            Err(e) => {
                orkestra_debug!(
                    "stage_chat",
                    "Error during structured output detection: {}",
                    e
                );
                // Append error as a visible log entry so the user can see what went wrong
                let error_msg = format!(
                    "[System] Structured output detection failed: {e}. \
                     The agent's response was treated as regular chat text."
                );
                if let Err(log_err) =
                    store.append_log_entry(session_id, &LogEntry::Text { content: error_msg }, None)
                {
                    orkestra_debug!(
                        "stage_chat",
                        "Failed to append error log entry: {}",
                        log_err
                    );
                }
            }
        }
    }

    // Append ProcessExit so the frontend knows the agent is done
    if let Err(e) = store.append_log_entry(session_id, &LogEntry::ProcessExit { code: None }, None)
    {
        orkestra_debug!(
            "stage_chat",
            "Failed to append ProcessExit log entry: {}",
            e
        );
    } else if let Some(tx) = &log_notify_tx {
        if let Err(e) = tx.send(LogNotification {
            task_id: task_id.to_string(),
            session_id: session_id.to_string(),
            last_entry_summary: None, // ProcessExit is not summarizable
        }) {
            orkestra_debug!("stage_chat", "Log notification send failed: {}", e);
        }
    }

    // Clear PID on session (skip if detection already handled session cleanup via exit_chat).
    //
    // Use a targeted conditional update rather than a read-modify-write to avoid a race
    // with `return_to_work` / `approve` / `reject`: those operations call `exit_chat` which
    // clears BOTH `agent_pid` and `chat_active`. A full session save here would overwrite
    // their `chat_active=false` with a stale `chat_active=true` from before they ran.
    // The conditional update (`WHERE id = ? AND agent_pid = ?`) is a no-op when another
    // writer has already cleared `agent_pid`, so `chat_active` is never clobbered.
    if !detection_succeeded {
        match store.clear_agent_pid_for_session(session_id, pid) {
            Ok(true) => {
                // PID was ours — bump task.updated_at so differential sync delivers the
                // chat_active=false state change to the UI.
                if let Err(e) = store.touch_task(task_id) {
                    orkestra_debug!(
                        "stage_chat",
                        "Failed to touch task after clearing agent PID: {}",
                        e
                    );
                }
            }
            Ok(false) => {
                // Another writer (exit_chat) already cleared the PID — it owns touch_task.
            }
            Err(e) => {
                orkestra_debug!(
                    "stage_chat",
                    "Failed to clear agent PID on session exit: {}",
                    e
                );
            }
        }
    }

    handle.disarm();
    orkestra_debug!("stage_chat", "Chat output reader finished for pid={}", pid);
}
