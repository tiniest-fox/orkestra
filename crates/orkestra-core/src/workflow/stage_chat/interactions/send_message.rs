//! Send a chat message to the stage agent.
//!
//! Valid when the task is in `AwaitingApproval`, `AwaitingQuestionAnswer`,
//! `AwaitingRejectionConfirmation`, or `Interrupted` phase.
//! Enters chat mode on first message, kills any existing chat process,
//! then spawns a new agent process and reads output in the background.

use std::path::{Path, PathBuf};
use std::sync::Arc;
use std::thread;

use super::try_complete_from_output::{self, DetectionResult};
use crate::orkestra_debug;
use crate::workflow::config::WorkflowConfig;
use crate::workflow::domain::{LogEntry, LogNotification};
use crate::workflow::execution::{get_agent_schema, AgentParser, ProviderRegistry};
use crate::workflow::ports::{WorkflowError, WorkflowResult, WorkflowStore};
use orkestra_parser::interactions::output::strip_markdown_fences;
use orkestra_process::{is_process_running, kill_process_tree, ProcessConfig, ProcessHandle};

/// Resume type identifier for chat messages in log entries.
pub const CHAT_RESUME_TYPE: &str = "chat";

/// Resume type identifier for auto-correction messages in log entries.
pub const CORRECTION_RESUME_TYPE: &str = "correction";

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
    registry: &Arc<ProviderRegistry>,
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
        // Bump updated_at so differential sync delivers is_chatting and shouldPoll immediately.
        store.touch_task(task_id)?;
    }

    // Store the user message as a log entry on the stage session
    store.append_log_entry(
        &session.id,
        &LogEntry::UserMessage {
            resume_type: CHAT_RESUME_TYPE.to_string(),
            content: message.to_string(),
            sections: Vec::new(),
        },
        None,
    )?;

    // Notify frontend immediately so it fetches the UserMessage entry without waiting
    // for the background reader's first batch notification.
    if let Some(tx) = &log_notify_tx {
        if let Err(e) = tx.send(LogNotification {
            task_id: task_id.to_string(),
            session_id: session.id.clone(),
            last_entry_summary: None,
        }) {
            orkestra_debug!("stage_chat", "Log notification send failed: {}", e);
        }
    }

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
        1,
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

/// Emit an `ExtractedJson` log entry classifying detected output for the frontend.
fn emit_extracted_json_entry(
    store: &Arc<dyn WorkflowStore>,
    session_id: &str,
    raw_json: String,
    valid: bool,
) {
    if let Err(e) = store.append_log_entry(
        session_id,
        &LogEntry::ExtractedJson { raw_json, valid },
        None,
    ) {
        orkestra_debug!("stage_chat", "Failed to append ExtractedJson entry: {}", e);
    }
}

/// Persist all buffered Text entries to the store.
fn flush_text_buffer(buffer: &[LogEntry], store: &Arc<dyn WorkflowStore>, session_id: &str) {
    for entry in buffer {
        if let Err(e) = store.append_log_entry(session_id, entry, None) {
            orkestra_debug!("stage_chat", "Failed to flush buffered log entry: {}", e);
        }
    }
}

/// State machine for buffering Text log entries that may contain JSON.
///
/// Buffers entries starting with `{` or ` ``` ` until we can determine whether
/// they contain JSON (discard after extraction) or regular text (flush to store).
#[derive(Default)]
struct TextBufferState {
    buffer: Vec<LogEntry>,
    buffering: bool,
    /// Set once the accumulated buffer parses as valid JSON.
    json_complete: bool,
}

/// Process a single log entry through the text buffer state machine.
///
/// Returns entries to persist immediately. Empty means the entry was buffered.
/// Non-Text entries are always returned immediately.
///
/// Decision tree for Text entries:
/// - If `json_complete` and new text arrives: discard buffer (JSON handled by
///   `try_complete_from_output`), reset state, persist this entry as trailing text.
/// - If not buffering and entry starts with `{` or ` ``` `: start buffering.
/// - If buffering: add to buffer and try eager parse. If parse succeeds, set `json_complete`.
///   If a closing fence arrives and parse still fails: flush immediately (non-JSON fence).
/// - If not buffering: persist immediately.
fn buffer_or_persist(entry: LogEntry, state: &mut TextBufferState) -> Vec<LogEntry> {
    let LogEntry::Text { ref content } = entry else {
        return vec![entry];
    };
    // Compute booleans before moving `entry` into the buffer.
    let starts_with_json = content.trim().starts_with('{') || content.trim().starts_with("```");
    let is_closing_fence = content.trim() == "```";

    // Trailing text after json_complete confirms structured output — discard buffer, persist this
    if state.buffering && state.json_complete {
        state.buffer.clear();
        state.buffering = false;
        state.json_complete = false;
        return vec![entry];
    }

    // Trigger buffering on JSON object or markdown fence
    if !state.buffering && starts_with_json {
        state.buffering = true;
    }

    if state.buffering {
        state.buffer.push(entry);

        // Eager parse: check if accumulated buffer is already valid JSON
        let buffer_text = state
            .buffer
            .iter()
            .filter_map(|e| {
                if let LogEntry::Text { content } = e {
                    Some(content.as_str())
                } else {
                    None
                }
            })
            .collect::<Vec<_>>()
            .join("\n");
        let stripped = strip_markdown_fences::execute(buffer_text.trim());
        if serde_json::from_str::<serde_json::Value>(&stripped).is_ok() {
            state.json_complete = true;
        } else if is_closing_fence {
            // Fence closed and not valid JSON — flush immediately so UI sees it
            state.buffering = false;
            state.json_complete = false;
            return std::mem::take(&mut state.buffer);
        }

        vec![] // buffered
    } else {
        vec![entry] // persist directly
    }
}

/// Build a corrective `UserMessage` log entry using the correction resume type.
fn correction_user_message(error: &str) -> LogEntry {
    LogEntry::UserMessage {
        resume_type: CORRECTION_RESUME_TYPE.to_string(),
        content: error.to_string(),
        sections: Vec::new(),
    }
}

/// Kill any running chat agent, spawn a new one, and start reading its output in background.
#[allow(clippy::too_many_arguments)]
fn spawn_chat_agent(
    store: Arc<dyn WorkflowStore>,
    registry: &Arc<ProviderRegistry>,
    workflow: &WorkflowConfig,
    task_flow: &str,
    session: &mut crate::workflow::domain::StageSession,
    stage: &str,
    worktree_path: &Path,
    project_root: &Path,
    message: &str,
    now: &str,
    log_notify_tx: Option<std::sync::mpsc::Sender<LogNotification>>,
    remaining_corrections: u32,
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

    // Clone retry context before moving into thread
    let registry_owned = Arc::clone(registry);
    let project_root_owned = project_root.to_path_buf();
    let task_flow_owned = task_flow.to_string();

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
            &registry_owned,
            project_root_owned.as_path(),
            task_flow_owned.as_str(),
            remaining_corrections,
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
///
/// When the agent produces JSON that fails schema validation, logs the error and
/// re-spawns the agent with a corrective message (up to `remaining_corrections` times).
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
    registry: &Arc<ProviderRegistry>,
    project_root: &Path,
    task_flow: &str,
    remaining_corrections: u32,
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
    let mut buf_state = TextBufferState::default();

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
                    for e in buffer_or_persist(entry, &mut buf_state) {
                        if let Err(e) = store.append_log_entry(session_id, &e, None) {
                            orkestra_debug!("stage_chat", "Failed to append log entry: {}", e);
                        } else {
                            batch_count += 1;
                        }
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
        for e in buffer_or_persist(entry, &mut buf_state) {
            if let Err(e) = store.append_log_entry(session_id, &e, None) {
                orkestra_debug!("stage_chat", "Failed to append finalized log entry: {}", e);
            } else {
                finalized_count += 1;
            }
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
        let full_text = accumulated_text.join("\n");
        match try_complete_from_output::execute(store, workflow, schema, task_id, stage, &full_text)
        {
            Ok(DetectionResult::Completed { raw_json }) => {
                orkestra_debug!(
                    "stage_chat",
                    "Detected structured output in chat, stage completed for task {}",
                    task_id
                );
                emit_extracted_json_entry(store, session_id, raw_json, true);
                buf_state.buffer.clear();
                detection_succeeded = true;
            }
            Ok(DetectionResult::NotDetected) => {
                // No structured output detected — flush any remaining buffered text
                if !buf_state.buffer.is_empty() {
                    flush_text_buffer(&buf_state.buffer, store, session_id);
                    buf_state.buffer.clear();
                    if let Some(tx) = &log_notify_tx {
                        let _ = tx.send(LogNotification {
                            task_id: task_id.to_string(),
                            session_id: session_id.to_string(),
                            last_entry_summary: LogEntry::last_summary(&[]),
                        });
                    }
                }
            }
            Ok(DetectionResult::CorrectionNeeded { error, raw_json }) => {
                orkestra_debug!(
                    "stage_chat",
                    "Structured output correction needed for task {}: {}",
                    task_id,
                    error
                );

                // Discard the text buffer — the JSON is captured in ExtractedJson
                buf_state.buffer.clear();

                // Append ExtractedJson log entry for frontend classification
                emit_extracted_json_entry(store, session_id, raw_json, false);

                // Log the error as a visible system message
                let system_msg = format!("[System] {error}");
                if let Err(e) = store.append_log_entry(
                    session_id,
                    &LogEntry::Text {
                        content: system_msg,
                    },
                    None,
                ) {
                    orkestra_debug!(
                        "stage_chat",
                        "Failed to append corrective system message: {}",
                        e
                    );
                }

                // Auto-retry: re-spawn agent with corrective message (once)
                if remaining_corrections > 0 {
                    let corrective_msg = error;
                    // Log as UserMessage so the agent sees it in context on resume
                    if let Err(e) = store.append_log_entry(
                        session_id,
                        &correction_user_message(&corrective_msg),
                        None,
                    ) {
                        orkestra_debug!(
                            "stage_chat",
                            "Failed to append corrective user message: {}",
                            e
                        );
                    }

                    // Notify frontend
                    if let Some(tx) = log_notify_tx {
                        if let Err(e) = tx.send(LogNotification {
                            task_id: task_id.to_string(),
                            session_id: session_id.to_string(),
                            last_entry_summary: None,
                        }) {
                            orkestra_debug!("stage_chat", "Log notification send failed: {}", e);
                        }
                    }

                    // Reload session and re-spawn
                    match store.get_stage_session(task_id, stage) {
                        Ok(Some(mut session)) => {
                            let now = chrono::Utc::now().to_rfc3339();
                            let worktree_path = if let Ok(Some(task)) = store.get_task(task_id) {
                                resolve_worktree_path(
                                    task.worktree_path.as_deref(),
                                    project_root,
                                    task_id,
                                )
                            } else {
                                resolve_worktree_path(None, project_root, task_id)
                            };

                            if let Err(e) = spawn_chat_agent(
                                Arc::clone(store),
                                registry,
                                workflow,
                                task_flow,
                                &mut session,
                                stage,
                                &worktree_path,
                                project_root,
                                &corrective_msg,
                                &now,
                                log_notify_tx.cloned(),
                                remaining_corrections - 1,
                            ) {
                                orkestra_debug!(
                                    "stage_chat",
                                    "Failed to spawn corrective agent: {}",
                                    e
                                );
                            } else {
                                // The new spawn's read_chat_output handles ProcessExit and PID cleanup
                                handle.disarm();
                                return;
                            }
                        }
                        Ok(None) => {
                            orkestra_debug!(
                                "stage_chat",
                                "Session not found for corrective re-spawn (task={}, stage={})",
                                task_id,
                                stage
                            );
                        }
                        Err(e) => {
                            orkestra_debug!(
                                "stage_chat",
                                "Failed to reload session for corrective re-spawn (task={}, stage={}): {}",
                                task_id,
                                stage,
                                e
                            );
                        }
                    }
                }
            }
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

    // Safety drain: flush any remaining buffered text that wasn't consumed by detection
    if !buf_state.buffer.is_empty() {
        flush_text_buffer(&buf_state.buffer, store, session_id);
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

/// Determine whether a corrective re-spawn should be attempted.
///
/// Returns the corrective message string when correction is warranted: the result
/// is `CorrectionNeeded` and there are remaining correction attempts. Returns
/// `None` when no correction should be attempted (wrong result type or exhausted budget).
///
/// Extracted as a pure function so the retry-gate logic can be tested independently
/// of the process-spawning path.
#[cfg(test)]
fn should_attempt_correction(result: &DetectionResult, remaining: u32) -> Option<&str> {
    match result {
        DetectionResult::CorrectionNeeded { error, .. } if remaining > 0 => Some(error.as_str()),
        _ => None,
    }
}

// ============================================================================
// Tests
// ============================================================================

#[cfg(test)]
mod tests {
    use super::*;
    use crate::workflow::adapters::InMemoryWorkflowStore;
    use crate::workflow::domain::StageSession;
    use crate::workflow::ports::WorkflowStore;

    #[test]
    fn completed_detection_appends_valid_extracted_json() {
        let store: Arc<dyn WorkflowStore> = Arc::new(InMemoryWorkflowStore::new());
        let session = StageSession::new("ss-completed", "task-1", "work", "2025-01-01T00:00:00Z");
        store.save_stage_session(&session).unwrap();

        emit_extracted_json_entry(
            &store,
            "ss-completed",
            r#"{"type":"summary"}"#.to_string(),
            true,
        );

        let entries = store.get_log_entries("ss-completed").unwrap();
        assert_eq!(entries.len(), 1);
        match &entries[0] {
            LogEntry::ExtractedJson { raw_json, valid } => {
                assert!(*valid, "Completed path emits valid: true");
                assert!(raw_json.contains("summary"));
            }
            _ => panic!("expected ExtractedJson"),
        }
    }

    #[test]
    fn correction_detection_appends_invalid_extracted_json() {
        let store: Arc<dyn WorkflowStore> = Arc::new(InMemoryWorkflowStore::new());
        let session = StageSession::new("ss-correction", "task-1", "work", "2025-01-01T00:00:00Z");
        store.save_stage_session(&session).unwrap();

        emit_extracted_json_entry(
            &store,
            "ss-correction",
            r#"{"type":"bogus"}"#.to_string(),
            false,
        );

        let entries = store.get_log_entries("ss-correction").unwrap();
        assert_eq!(entries.len(), 1);
        match &entries[0] {
            LogEntry::ExtractedJson { raw_json, valid } => {
                assert!(!*valid, "CorrectionNeeded path emits valid: false");
                assert!(raw_json.contains("bogus"));
            }
            _ => panic!("expected ExtractedJson"),
        }
    }

    #[test]
    fn correction_user_message_uses_correction_resume_type() {
        match correction_user_message("please fix your output") {
            LogEntry::UserMessage {
                resume_type,
                content,
                ..
            } => {
                assert_eq!(resume_type, CORRECTION_RESUME_TYPE);
                assert_eq!(resume_type, "correction");
                assert_eq!(content, "please fix your output");
            }
            _ => panic!("expected UserMessage"),
        }
    }

    #[test]
    fn should_attempt_correction_when_remaining() {
        let result = DetectionResult::CorrectionNeeded {
            error: "bad schema".to_string(),
            raw_json: "{}".to_string(),
        };
        assert_eq!(should_attempt_correction(&result, 1), Some("bad schema"));
        assert_eq!(should_attempt_correction(&result, 2), Some("bad schema"));
    }

    #[test]
    fn should_not_attempt_correction_when_exhausted() {
        let result = DetectionResult::CorrectionNeeded {
            error: "bad schema".to_string(),
            raw_json: "{}".to_string(),
        };
        assert_eq!(should_attempt_correction(&result, 0), None);
    }

    #[test]
    fn should_not_attempt_correction_when_completed() {
        let result = DetectionResult::Completed {
            raw_json: "{}".to_string(),
        };
        assert_eq!(should_attempt_correction(&result, 1), None);
    }

    #[test]
    fn should_not_attempt_correction_when_not_detected() {
        let result = DetectionResult::NotDetected;
        assert_eq!(should_attempt_correction(&result, 1), None);
    }

    // -- Buffering tests --

    fn make_text_entry(content: &str) -> LogEntry {
        LogEntry::Text {
            content: content.to_string(),
        }
    }

    #[test]
    fn flush_text_buffer_persists_entries_to_store() {
        let store: Arc<dyn WorkflowStore> = Arc::new(InMemoryWorkflowStore::new());
        let session = StageSession::new("ss-flush", "task-1", "work", "2025-01-01T00:00:00Z");
        store.save_stage_session(&session).unwrap();

        let buffer = vec![make_text_entry("line one"), make_text_entry("line two")];
        flush_text_buffer(&buffer, &store, "ss-flush");

        let entries = store.get_log_entries("ss-flush").unwrap();
        assert_eq!(entries.len(), 2);
        match (&entries[0], &entries[1]) {
            (LogEntry::Text { content: c1 }, LogEntry::Text { content: c2 }) => {
                assert_eq!(c1, "line one");
                assert_eq!(c2, "line two");
            }
            _ => panic!("expected two Text entries"),
        }
    }

    #[test]
    fn json_buffer_discarded_on_completed() {
        // When detection succeeds (Completed), Text entries that were buffered are discarded;
        // only the ExtractedJson entry reaches the store.
        let store: Arc<dyn WorkflowStore> = Arc::new(InMemoryWorkflowStore::new());
        let session = StageSession::new("ss-discard", "task-1", "work", "2025-01-01T00:00:00Z");
        store.save_stage_session(&session).unwrap();

        // Feed JSON entries through the buffer — nothing should reach the store yet
        let mut buf_state = TextBufferState::default();
        let r1 = buffer_or_persist(make_text_entry("{"), &mut buf_state);
        assert!(r1.is_empty(), "opening brace buffered");
        let r2 = buffer_or_persist(make_text_entry("  \"type\": \"summary\""), &mut buf_state);
        assert!(r2.is_empty(), "json content buffered");
        let r3 = buffer_or_persist(make_text_entry("}"), &mut buf_state);
        assert!(r3.is_empty(), "closing brace buffered");
        assert!(
            buf_state.json_complete,
            "json_complete set after valid JSON"
        );
        assert_eq!(buf_state.buffer.len(), 3, "all three entries buffered");

        // Simulate Completed detection: discard buffer, emit ExtractedJson
        buf_state.buffer.clear();
        emit_extracted_json_entry(
            &store,
            "ss-discard",
            r#"{"type":"summary"}"#.to_string(),
            true,
        );

        // Only ExtractedJson in store — Text entries were discarded
        let entries = store.get_log_entries("ss-discard").unwrap();
        assert_eq!(entries.len(), 1, "only ExtractedJson entry in store");
        assert!(matches!(
            entries[0],
            LogEntry::ExtractedJson { valid: true, .. }
        ));
    }

    #[test]
    fn json_buffer_discarded_on_correction_needed() {
        // When detection returns CorrectionNeeded, Text entries that were buffered are discarded;
        // only the ExtractedJson (invalid) entry reaches the store.
        let store: Arc<dyn WorkflowStore> = Arc::new(InMemoryWorkflowStore::new());
        let session = StageSession::new("ss-corr", "task-1", "work", "2025-01-01T00:00:00Z");
        store.save_stage_session(&session).unwrap();

        // Feed JSON entries through the buffer — nothing should reach the store yet
        let mut buf_state = TextBufferState::default();
        let r1 = buffer_or_persist(make_text_entry("{"), &mut buf_state);
        assert!(r1.is_empty(), "opening brace buffered");
        let r2 = buffer_or_persist(make_text_entry("  \"type\": \"bad\""), &mut buf_state);
        assert!(r2.is_empty(), "json content buffered");
        let r3 = buffer_or_persist(make_text_entry("}"), &mut buf_state);
        assert!(r3.is_empty(), "closing brace buffered");
        assert!(
            buf_state.json_complete,
            "json_complete set after valid JSON"
        );

        // Simulate CorrectionNeeded: discard buffer, emit ExtractedJson (invalid)
        buf_state.buffer.clear();
        emit_extracted_json_entry(&store, "ss-corr", r#"{"type":"bad"}"#.to_string(), false);

        // Only ExtractedJson (invalid) in store — Text entries were discarded
        let entries = store.get_log_entries("ss-corr").unwrap();
        assert_eq!(entries.len(), 1, "only ExtractedJson entry in store");
        assert!(matches!(
            entries[0],
            LogEntry::ExtractedJson { valid: false, .. }
        ));
    }

    #[test]
    fn safety_drain_not_detected_flushes_buffer_to_store() {
        // When NotDetected: the safety drain flushes buffered Text entries to the store.
        let store: Arc<dyn WorkflowStore> = Arc::new(InMemoryWorkflowStore::new());
        let session = StageSession::new("ss-drain", "task-1", "work", "2025-01-01T00:00:00Z");
        store.save_stage_session(&session).unwrap();

        // Feed JSON entries through buffer_or_persist until json_complete
        let mut buf_state = TextBufferState::default();
        let r1 = buffer_or_persist(make_text_entry("{"), &mut buf_state);
        assert!(r1.is_empty());
        let r2 = buffer_or_persist(make_text_entry("  \"type\": \"summary\""), &mut buf_state);
        assert!(r2.is_empty());
        let r3 = buffer_or_persist(make_text_entry("}"), &mut buf_state);
        assert!(r3.is_empty());
        assert!(buf_state.json_complete, "json_complete set");
        assert_eq!(buf_state.buffer.len(), 3, "three entries buffered");

        // Simulate NotDetected: flush buffer to store (safety drain path)
        flush_text_buffer(&buf_state.buffer, &store, "ss-drain");
        buf_state.buffer.clear();

        // All three Text entries should be in the store
        let entries = store.get_log_entries("ss-drain").unwrap();
        assert_eq!(
            entries.len(),
            3,
            "all buffered Text entries flushed to store"
        );
        assert!(
            entries.iter().all(|e| matches!(e, LogEntry::Text { .. })),
            "all entries are Text"
        );
    }

    // -- buffer_or_persist decision logic tests --

    #[test]
    fn plain_text_persisted_immediately() {
        let mut state = TextBufferState::default();
        let entry = make_text_entry("This is just prose");
        let result = buffer_or_persist(entry, &mut state);
        assert_eq!(
            result.len(),
            1,
            "plain text should be returned for immediate persist"
        );
        assert!(!state.buffering);
    }

    #[test]
    fn bare_json_object_buffered_until_complete() {
        let mut state = TextBufferState::default();

        // Incomplete JSON — stays buffered
        let r1 = buffer_or_persist(make_text_entry("{"), &mut state);
        assert!(r1.is_empty(), "opening brace should be buffered");
        assert!(state.buffering);
        assert!(!state.json_complete);

        let r2 = buffer_or_persist(make_text_entry("  \"type\": \"summary\""), &mut state);
        assert!(r2.is_empty(), "partial JSON should still be buffered");
        assert!(!state.json_complete);

        // Closing brace completes the JSON
        let r3 = buffer_or_persist(make_text_entry("}"), &mut state);
        assert!(r3.is_empty(), "closing brace still buffered (json_complete set, waiting for trailing text or session end)");
        assert!(
            state.json_complete,
            "closing brace should set json_complete"
        );
        assert_eq!(state.buffer.len(), 3);
    }

    #[test]
    fn trailing_text_after_json_discards_buffer() {
        let mut state = TextBufferState::default();

        // Single-line JSON completes immediately
        let r1 = buffer_or_persist(make_text_entry(r#"{"type":"summary"}"#), &mut state);
        assert!(r1.is_empty());
        assert!(state.json_complete);

        // Trailing text signals structured output — buffer discarded, trailing text persisted
        let r2 = buffer_or_persist(make_text_entry("Some trailing prose"), &mut state);
        assert_eq!(r2.len(), 1, "trailing text should be persisted");
        assert!(
            !state.buffering,
            "state should be reset after trailing text"
        );
        assert!(!state.json_complete);
        assert!(state.buffer.is_empty(), "buffer discarded on trailing text");
    }

    #[test]
    fn fenced_json_buffered_until_close_then_json_complete() {
        let mut state = TextBufferState::default();

        let r1 = buffer_or_persist(make_text_entry("```json"), &mut state);
        assert!(r1.is_empty());
        assert!(state.buffering);

        let r2 = buffer_or_persist(make_text_entry(r#"{"type":"summary"}"#), &mut state);
        assert!(r2.is_empty());
        assert!(!state.json_complete, "fence not closed yet");

        // Closing fence makes the whole block parse as JSON
        let r3 = buffer_or_persist(make_text_entry("```"), &mut state);
        assert!(
            r3.is_empty(),
            "closing fence should still be buffered (json_complete)"
        );
        assert!(
            state.json_complete,
            "closing fence of JSON fence sets json_complete"
        );
    }

    #[test]
    fn non_json_fence_flushed_on_close() {
        let mut state = TextBufferState::default();

        let r1 = buffer_or_persist(make_text_entry("```python"), &mut state);
        assert!(r1.is_empty());

        let r2 = buffer_or_persist(make_text_entry("def hello(): pass"), &mut state);
        assert!(r2.is_empty());

        // Closing fence on non-JSON content → flushed immediately
        let r3 = buffer_or_persist(make_text_entry("```"), &mut state);
        assert_eq!(
            r3.len(),
            3,
            "all buffered entries flushed on non-JSON fence close"
        );
        assert!(!state.buffering);
        assert!(!state.json_complete);
        assert!(state.buffer.is_empty());
    }

    #[test]
    fn prose_before_json_persisted_json_buffered() {
        // Mixed prose + JSON: prose is persisted immediately; JSON fence is buffered.
        // After Completed detection, only the prose entry is in the store.
        let store: Arc<dyn WorkflowStore> = Arc::new(InMemoryWorkflowStore::new());
        let session = StageSession::new("ss-prose", "task-1", "work", "2025-01-01T00:00:00Z");
        store.save_stage_session(&session).unwrap();

        let mut state = TextBufferState::default();

        // Prose before JSON is persisted immediately
        let r1 = buffer_or_persist(make_text_entry("Here is my result:"), &mut state);
        assert_eq!(r1.len(), 1, "prose before JSON persisted immediately");
        assert!(!state.buffering);
        for e in r1 {
            store.append_log_entry("ss-prose", &e, None).unwrap();
        }

        // JSON fence starts buffering — nothing reaches the store
        let r2 = buffer_or_persist(make_text_entry("```json"), &mut state);
        assert!(r2.is_empty());
        assert!(state.buffering);

        let r3 = buffer_or_persist(make_text_entry(r#"{"type":"summary"}"#), &mut state);
        assert!(r3.is_empty());

        let r4 = buffer_or_persist(make_text_entry("```"), &mut state);
        assert!(r4.is_empty());
        assert!(state.json_complete, "json_complete set after fence closes");

        // Simulate Completed detection: discard buffer (JSON text entries are dropped)
        state.buffer.clear();

        // Only the prose Text entry should be in the store
        let entries = store.get_log_entries("ss-prose").unwrap();
        assert_eq!(entries.len(), 1, "only prose text entry in store");
        match &entries[0] {
            LogEntry::Text { content } => assert_eq!(content, "Here is my result:"),
            _ => panic!("expected prose Text entry"),
        }
    }

    #[test]
    fn non_text_entry_persisted_immediately() {
        let mut state = TextBufferState::default();
        let entry = LogEntry::ProcessExit { code: Some(0) };
        let result = buffer_or_persist(entry, &mut state);
        assert_eq!(
            result.len(),
            1,
            "non-Text entries always persist immediately"
        );
        assert!(!state.buffering);
    }
}
