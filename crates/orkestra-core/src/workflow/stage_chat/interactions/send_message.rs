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
            stage_completed: false,
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
    /// Set when currently buffering inside a markdown fence block.
    inside_fence: bool,
}

/// Process a single log entry through the text buffer state machine.
///
/// Returns entries to persist immediately. Empty means the entry was buffered.
/// Non-Text entries are always returned immediately.
///
/// Decision tree for Text entries:
/// - If `json_complete` and new text arrives: the JSON hypothesis is wrong — flush buffered
///   entries (they are prose, not structured output), reset state, append this trailing entry.
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

    // Trailing text invalidates the JSON hypothesis — flush buffer so entries reach the store.
    // Exception: a closing fence inside a fenced block is not trailing text — it closes the block.
    if state.buffering && state.json_complete && !(is_closing_fence && state.inside_fence) {
        let mut flushed = std::mem::take(&mut state.buffer);
        state.buffering = false;
        state.json_complete = false;
        state.inside_fence = false;
        flushed.push(entry);
        return flushed;
    }

    // Trigger buffering on JSON object or markdown fence.
    // Don't start buffering on a bare closing fence with no prior open.
    if !state.buffering && starts_with_json && !is_closing_fence {
        state.buffering = true;
        if content.trim().starts_with("```") {
            state.inside_fence = true;
        }
    }

    if state.buffering {
        state.buffer.push(entry);

        // Clear inside_fence when the closing fence arrives, before the eager parse.
        if is_closing_fence && state.inside_fence {
            state.inside_fence = false;
        }

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

    let mut buf_state = TextBufferState::default();
    // Tracks the last text entry that was persisted directly (not buffered).
    // Used as a fallback detection candidate when the buffer path doesn't fire —
    // specifically when prose + ork fence arrive together in a single Text entry.
    let mut last_persisted_text: Option<String> = None;

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
                    for e in buffer_or_persist(entry, &mut buf_state) {
                        // Track the last persisted Text entry for fallback detection.
                        if let LogEntry::Text { content } = &e {
                            last_persisted_text = Some(content.clone());
                        }
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
                            stage_completed: false,
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

    // Finalize parser and pass finalized entries through the buffer state machine
    let finalized = parser.finalize();
    let mut finalized_count = 0usize;
    let finalized_summary = LogEntry::last_summary(&finalized);
    for entry in finalized {
        for e in buffer_or_persist(entry, &mut buf_state) {
            // Track the last persisted Text entry for fallback detection.
            if let LogEntry::Text { content } = &e {
                last_persisted_text = Some(content.clone());
            }
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
                stage_completed: false,
            }) {
                orkestra_debug!("stage_chat", "Log notification send failed: {}", e);
            }
        }
    }

    // Build trailing text candidate from the buffer.
    //
    // Only attempt structured output detection when the buffer holds content that the
    // state machine identified as a JSON candidate (`json_complete = true`).  This
    // scopes detection to the *trailing* portion of the response — the final block the
    // model output as its last text — rather than scanning the entire accumulated
    // response, which could match a JSON example written mid-response and trigger a
    // false-positive stage completion.
    let trailing_text: Option<String> = if buf_state.json_complete && !buf_state.buffer.is_empty() {
        let text = buf_state
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
        if text.is_empty() {
            None
        } else {
            Some(text)
        }
    } else {
        // Fallback: when the buffer didn't fire (entry started with prose, not JSON/fence),
        // use the last persisted text entry as the detection candidate. This handles the
        // case where prose + ork fence arrive in a single LogEntry::Text.
        last_persisted_text.take()
    };

    // Try to detect structured output and complete the stage
    let mut detection_succeeded = false;
    if let Some(trailing_text) = trailing_text {
        match try_complete_from_output::execute(
            store,
            workflow,
            schema,
            task_id,
            stage,
            &trailing_text,
        ) {
            Ok(DetectionResult::Completed { raw_json }) => {
                orkestra_debug!(
                    "stage_chat",
                    "Detected structured output in chat, stage completed for task {}",
                    task_id
                );
                emit_extracted_json_entry(store, session_id, raw_json, true);
                buf_state.buffer.clear();
                if let Some(tx) = log_notify_tx {
                    if let Err(e) = tx.send(LogNotification {
                        task_id: task_id.to_string(),
                        session_id: session_id.to_string(),
                        last_entry_summary: None,
                        stage_completed: true,
                    }) {
                        orkestra_debug!("stage_chat", "Log notification send failed: {}", e);
                    }
                }
                detection_succeeded = true;
            }
            Ok(DetectionResult::NotDetected) => {
                // No structured output detected — flush any remaining buffered text
                if !buf_state.buffer.is_empty() {
                    let flushed_summary = LogEntry::last_summary(&buf_state.buffer);
                    flush_text_buffer(&buf_state.buffer, store, session_id);
                    buf_state.buffer.clear();
                    if let Some(tx) = &log_notify_tx {
                        let _ = tx.send(LogNotification {
                            task_id: task_id.to_string(),
                            session_id: session_id.to_string(),
                            last_entry_summary: flushed_summary,
                            stage_completed: false,
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

                // Always log the correction UserMessage so the error is visible in the chat.
                // The UserMessage already renders as a system-labeled bubble — no separate
                // Text entry is needed.
                let corrective_msg = error;
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

                // Auto-retry: re-spawn agent with corrective message (once)
                if remaining_corrections > 0 {
                    // Notify frontend
                    if let Some(tx) = log_notify_tx {
                        if let Err(e) = tx.send(LogNotification {
                            task_id: task_id.to_string(),
                            session_id: session_id.to_string(),
                            last_entry_summary: None,
                            stage_completed: false,
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
            stage_completed: false,
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
    use crate::workflow::config::{StageConfig, WorkflowConfig};
    use crate::workflow::domain::{IterationTrigger, StageSession, Task};
    use crate::workflow::execution::{default_test_registry, AgentParser};
    use crate::workflow::ports::WorkflowStore;
    use crate::workflow::runtime::TaskState;
    use orkestra_parser::ParsedUpdate;
    use std::path::Path;
    use std::process::{Command, Stdio};

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
    fn trailing_text_after_json_flushes_buffer() {
        // When trailing text arrives after json_complete, the JSON hypothesis is wrong.
        // The buffered entries must be flushed (not discarded) so they reach the store.
        let mut state = TextBufferState::default();

        // Single-line JSON completes immediately
        let r1 = buffer_or_persist(make_text_entry(r#"{"type":"summary"}"#), &mut state);
        assert!(r1.is_empty());
        assert!(state.json_complete);

        // Trailing text invalidates the JSON hypothesis — buffer flushed + trailing text returned
        let r2 = buffer_or_persist(make_text_entry("Some trailing prose"), &mut state);
        assert_eq!(
            r2.len(),
            2,
            "buffered JSON line + trailing text should both be returned"
        );
        assert!(
            !state.buffering,
            "state should be reset after trailing text"
        );
        assert!(!state.json_complete);
        assert!(state.buffer.is_empty(), "buffer taken by mem::take");
        // First entry is the buffered JSON line, second is trailing prose
        assert!(
            matches!(&r2[0], LogEntry::Text { content } if content == r#"{"type":"summary"}"#),
            "first returned entry is the buffered JSON line"
        );
        assert!(
            matches!(&r2[1], LogEntry::Text { content } if content == "Some trailing prose"),
            "second returned entry is the trailing prose"
        );
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

    #[test]
    fn inside_fence_tracks_open_close() {
        let mut state = TextBufferState::default();

        let r1 = buffer_or_persist(make_text_entry("```json"), &mut state);
        assert!(r1.is_empty());
        assert!(state.buffering, "buffering started on opening fence");
        assert!(state.inside_fence, "inside_fence set on opening fence");

        let r2 = buffer_or_persist(make_text_entry(r#"{"type":"summary"}"#), &mut state);
        assert!(r2.is_empty());
        assert!(state.inside_fence, "inside_fence still true during content");
        assert!(!state.json_complete, "fence not closed yet");

        let r3 = buffer_or_persist(make_text_entry("```"), &mut state);
        assert!(r3.is_empty(), "closing fence buffered");
        assert!(!state.inside_fence, "inside_fence cleared on closing fence");
        assert!(state.json_complete, "json_complete set after fence closes");
    }

    #[test]
    fn standalone_closing_fence_not_buffered() {
        // A bare ``` with no prior opening fence should be persisted immediately,
        // not start buffering.
        let mut state = TextBufferState::default();

        let result = buffer_or_persist(make_text_entry("```"), &mut state);
        assert_eq!(
            result.len(),
            1,
            "standalone closing fence should be persisted immediately"
        );
        assert!(
            !state.buffering,
            "buffering should not start on lone closing fence"
        );
        assert!(!state.inside_fence);
    }

    #[test]
    fn fenced_json_then_trailing_prose_flushes_after_close() {
        // Complete fenced JSON followed by trailing prose should flush the entire
        // block (fence open + content + fence close + trailing prose) together.
        let mut state = TextBufferState::default();

        let r1 = buffer_or_persist(make_text_entry("```json"), &mut state);
        assert!(r1.is_empty());
        let r2 = buffer_or_persist(make_text_entry(r#"{"type":"summary"}"#), &mut state);
        assert!(r2.is_empty());
        let r3 = buffer_or_persist(make_text_entry("```"), &mut state);
        assert!(r3.is_empty(), "closing fence buffered (json_complete set)");
        assert!(state.json_complete, "json_complete set after fence closes");
        assert!(
            !state.inside_fence,
            "inside_fence cleared after fence closes"
        );

        // Trailing prose arrives — flush buffer + trailing entry
        let r4 = buffer_or_persist(make_text_entry("Some trailing prose"), &mut state);
        assert_eq!(
            r4.len(),
            4,
            "all three fenced entries + trailing prose returned"
        );
        assert!(!state.buffering, "state reset after flush");
        assert!(!state.json_complete);
        assert!(state.buffer.is_empty());
    }

    #[test]
    fn ork_fence_buffered_like_json_fence() {
        // ```ork fences should be treated the same as ```json fences.
        let mut state = TextBufferState::default();

        let r1 = buffer_or_persist(make_text_entry("```ork"), &mut state);
        assert!(r1.is_empty());
        assert!(state.buffering);
        assert!(state.inside_fence, "inside_fence set for ork fence");

        let r2 = buffer_or_persist(
            make_text_entry(r#"{"type":"summary","content":"done"}"#),
            &mut state,
        );
        assert!(r2.is_empty());
        assert!(!state.json_complete, "fence not closed yet");

        let r3 = buffer_or_persist(make_text_entry("```"), &mut state);
        assert!(r3.is_empty(), "closing fence buffered");
        assert!(!state.inside_fence, "inside_fence cleared on close");
        assert!(
            state.json_complete,
            "json_complete set after ork fence closes"
        );
    }

    // -- Integration tests for read_chat_output --

    /// A minimal `AgentParser` that converts each raw stdout line to a `LogEntry::Text`.
    ///
    /// Used in integration tests to exercise the `read_chat_output` pipeline without
    /// a real agent provider.
    struct TextLineParser;

    impl AgentParser for TextLineParser {
        fn parse_line(&mut self, line: &str) -> ParsedUpdate {
            ParsedUpdate {
                log_entries: vec![LogEntry::Text {
                    content: line.to_string(),
                }],
                session_id: None,
            }
        }

        fn finalize(&mut self) -> Vec<LogEntry> {
            vec![]
        }

        fn extract_output(&self, _full_output: &str) -> Result<String, String> {
            Err("not used in chat mode".to_string())
        }
    }

    /// Spawn `cat` with the given content pre-written to stdin, returning a handle
    /// whose stdout will yield those lines.  `cat` exits when stdin closes (which
    /// `write_prompt` arranges), so `handle.lines()` will see EOF after draining.
    #[allow(clippy::zombie_processes)]
    fn make_scripted_handle(content: &str) -> (u32, ProcessHandle) {
        let mut child = Command::new("cat")
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::null())
            .spawn()
            .expect("cat must be available");

        let pid = child.id();
        let stdin = child.stdin.take().unwrap();
        let stdout = child.stdout.take().unwrap();
        let mut handle = ProcessHandle::new(pid, stdin, stdout, None);
        handle.write_prompt(content).unwrap();
        (pid, handle)
    }

    /// Minimal JSON schema accepting "summary", "failed", "blocked" types.
    fn integration_schema() -> serde_json::Value {
        serde_json::json!({
            "type": "object",
            "properties": {
                "type": {"type": "string", "enum": ["summary", "failed", "blocked"]},
                "content": {"type": "string"},
                "error": {"type": "string"}
            },
            "required": ["type"]
        })
    }

    /// Workflow with a single "work" stage with artifact type "summary".
    fn integration_workflow() -> WorkflowConfig {
        WorkflowConfig::new(vec![StageConfig::new("work", "summary")])
    }

    #[test]
    fn integration_non_json_prose_persisted_immediately() {
        // Non-JSON lines bypass the buffer and are written to the store during the main
        // streaming loop.  After `read_chat_output` finishes, the store has Text entries
        // and a ProcessExit, but no ExtractedJson.
        let store: Arc<dyn WorkflowStore> = Arc::new(InMemoryWorkflowStore::new());
        let session = StageSession::new(
            "ss-int-prose",
            "task-int-prose",
            "work",
            "2025-01-01T00:00:00Z",
        );
        store.save_stage_session(&session).unwrap();

        let (pid, mut handle) = make_scripted_handle("Just some prose\nMore regular text\n");
        let stderr = handle.take_stderr();

        let registry = Arc::new(default_test_registry());
        read_chat_output(
            pid,
            &store,
            "ss-int-prose",
            "task-int-prose",
            "work",
            Box::new(TextLineParser),
            handle,
            stderr,
            &integration_workflow(),
            &integration_schema(),
            None,
            &registry,
            Path::new("/tmp"),
            "default",
            0,
        );

        let entries = store.get_log_entries("ss-int-prose").unwrap();
        let text_count = entries
            .iter()
            .filter(|e| matches!(e, LogEntry::Text { .. }))
            .count();
        assert_eq!(
            text_count, 2,
            "both Text entries reach the store immediately"
        );
        assert!(
            entries
                .iter()
                .any(|e| matches!(e, LogEntry::ProcessExit { .. })),
            "ProcessExit appended at end"
        );
        assert!(
            !entries
                .iter()
                .any(|e| matches!(e, LogEntry::ExtractedJson { .. })),
            "no ExtractedJson when no JSON detected"
        );
    }

    #[test]
    fn integration_pure_json_only_extracted_json_in_store() {
        // A single-line JSON object matching the schema is buffered during streaming
        // and discarded once detection succeeds (Completed).  Only ExtractedJson and
        // ProcessExit reach the store — no Text entries.
        let store: Arc<dyn WorkflowStore> = Arc::new(InMemoryWorkflowStore::new());

        // Task must be in a chat-capable state so try_complete_from_output proceeds.
        let mut task = Task::new(
            "task-int-json",
            "Test",
            "Test",
            "work",
            "2025-01-01T00:00:00Z",
        );
        task.state = TaskState::awaiting_approval("work");
        store.save_task(&task).unwrap();

        let session = StageSession::new(
            "ss-int-json",
            "task-int-json",
            "work",
            "2025-01-01T00:00:00Z",
        );
        store.save_stage_session(&session).unwrap();

        let json_line = r#"{"type":"summary","content":"done"}"#;
        let (pid, mut handle) = make_scripted_handle(&format!("{json_line}\n"));
        let stderr = handle.take_stderr();

        let registry = Arc::new(default_test_registry());
        read_chat_output(
            pid,
            &store,
            "ss-int-json",
            "task-int-json",
            "work",
            Box::new(TextLineParser),
            handle,
            stderr,
            &integration_workflow(),
            &integration_schema(),
            None,
            &registry,
            Path::new("/tmp"),
            "default",
            0,
        );

        let entries = store.get_log_entries("ss-int-json").unwrap();
        assert!(
            !entries.iter().any(|e| matches!(e, LogEntry::Text { .. })),
            "no Text entries — JSON was buffered and discarded on Completed"
        );
        assert!(
            entries
                .iter()
                .any(|e| matches!(e, LogEntry::ExtractedJson { valid: true, .. })),
            "ExtractedJson(valid=true) must be present"
        );
    }

    #[test]
    fn integration_trailing_prose_after_json_all_reach_store() {
        // When trailing prose follows a JSON line, `buffer_or_persist` flushes the
        // buffer on the trailing-text entry.  `try_complete_from_output` sees the
        // concatenated text (json + prose) and returns NotDetected (not valid JSON).
        // Both Text entries reach the store; no ExtractedJson is written.
        let store: Arc<dyn WorkflowStore> = Arc::new(InMemoryWorkflowStore::new());
        let session = StageSession::new(
            "ss-int-trailing",
            "task-int-trailing",
            "work",
            "2025-01-01T00:00:00Z",
        );
        store.save_stage_session(&session).unwrap();

        let content = "{\"type\":\"summary\",\"content\":\"done\"}\nSome trailing prose here\n";
        let (pid, mut handle) = make_scripted_handle(content);
        let stderr = handle.take_stderr();

        let registry = Arc::new(default_test_registry());
        read_chat_output(
            pid,
            &store,
            "ss-int-trailing",
            "task-int-trailing",
            "work",
            Box::new(TextLineParser),
            handle,
            stderr,
            &integration_workflow(),
            &integration_schema(),
            None,
            &registry,
            Path::new("/tmp"),
            "default",
            0,
        );

        let entries = store.get_log_entries("ss-int-trailing").unwrap();
        let text_count = entries
            .iter()
            .filter(|e| matches!(e, LogEntry::Text { .. }))
            .count();
        assert_eq!(
            text_count, 2,
            "both Text entries (JSON line + prose) reach store"
        );
        assert!(
            !entries
                .iter()
                .any(|e| matches!(e, LogEntry::ExtractedJson { .. })),
            "no ExtractedJson — trailing prose invalidated the JSON hypothesis"
        );
    }

    #[test]
    fn integration_fenced_json_only_extracted_json_in_store() {
        // Fenced JSON (```json\n{...}\n```) as the sole agent output should be buffered
        // and discarded once detection succeeds (Completed).  Only ExtractedJson and
        // ProcessExit reach the store — no Text entries.
        let store: Arc<dyn WorkflowStore> = Arc::new(InMemoryWorkflowStore::new());

        // Task must be in a chat-capable state so try_complete_from_output proceeds.
        let mut task = Task::new(
            "task-int-fenced",
            "Test",
            "Test",
            "work",
            "2025-01-01T00:00:00Z",
        );
        task.state = TaskState::awaiting_approval("work");
        store.save_task(&task).unwrap();

        let session = StageSession::new(
            "ss-int-fenced",
            "task-int-fenced",
            "work",
            "2025-01-01T00:00:00Z",
        );
        store.save_stage_session(&session).unwrap();

        let content = "```json\n{\"type\":\"summary\",\"content\":\"done\"}\n```\n";
        let (pid, mut handle) = make_scripted_handle(content);
        let stderr = handle.take_stderr();

        let registry = Arc::new(default_test_registry());
        read_chat_output(
            pid,
            &store,
            "ss-int-fenced",
            "task-int-fenced",
            "work",
            Box::new(TextLineParser),
            handle,
            stderr,
            &integration_workflow(),
            &integration_schema(),
            None,
            &registry,
            Path::new("/tmp"),
            "default",
            0,
        );

        let entries = store.get_log_entries("ss-int-fenced").unwrap();
        assert!(
            !entries.iter().any(|e| matches!(e, LogEntry::Text { .. })),
            "no Text entries — fenced JSON was buffered and discarded on Completed"
        );
        assert!(
            entries
                .iter()
                .any(|e| matches!(e, LogEntry::ExtractedJson { valid: true, .. })),
            "ExtractedJson(valid=true) must be present"
        );
    }

    #[test]
    fn integration_false_positive_brace_flushed_via_safety_drain() {
        // A lone `{` triggers buffering.  Non-JSON prose lines accumulate in the
        // buffer (no closing brace, no fence).  After the agent exits,
        // `try_complete_from_output` returns NotDetected and the NotDetected arm
        // flushes the buffer so all entries eventually reach the store.
        let store: Arc<dyn WorkflowStore> = Arc::new(InMemoryWorkflowStore::new());
        let session = StageSession::new(
            "ss-int-brace",
            "task-int-brace",
            "work",
            "2025-01-01T00:00:00Z",
        );
        store.save_stage_session(&session).unwrap();

        let content = "{\nThis is not JSON at all\nMore prose without a closing brace\n";
        let (pid, mut handle) = make_scripted_handle(content);
        let stderr = handle.take_stderr();

        let registry = Arc::new(default_test_registry());
        read_chat_output(
            pid,
            &store,
            "ss-int-brace",
            "task-int-brace",
            "work",
            Box::new(TextLineParser),
            handle,
            stderr,
            &integration_workflow(),
            &integration_schema(),
            None,
            &registry,
            Path::new("/tmp"),
            "default",
            0,
        );

        let entries = store.get_log_entries("ss-int-brace").unwrap();
        let text_count = entries
            .iter()
            .filter(|e| matches!(e, LogEntry::Text { .. }))
            .count();
        assert_eq!(
            text_count, 3,
            "all 3 buffered Text entries flushed (false-positive brace safety drain)"
        );
        assert!(
            !entries
                .iter()
                .any(|e| matches!(e, LogEntry::ExtractedJson { .. })),
            "no ExtractedJson for a false-positive brace trigger"
        );
        assert!(
            entries
                .iter()
                .any(|e| matches!(e, LogEntry::ProcessExit { .. })),
            "ProcessExit appended at end"
        );
    }

    #[test]
    fn integration_correction_needed_no_duplicate_entries() {
        // Schema-invalid JSON triggers CorrectionNeeded.  The fix: only a UserMessage
        // (resume_type="correction") is written — no redundant [System] Text entry.
        //
        // Assertions:
        //   (a) ExtractedJson { valid: false } present
        //   (b) exactly one UserMessage with resume_type "correction" present
        //   (c) no Text entries containing "[System]" exist
        let store: Arc<dyn WorkflowStore> = Arc::new(InMemoryWorkflowStore::new());
        let session = StageSession::new(
            "ss-int-correction",
            "task-int-correction",
            "work",
            "2025-01-01T00:00:00Z",
        );
        store.save_stage_session(&session).unwrap();

        // Valid JSON but "type" value is not in the schema enum — triggers CorrectionNeeded
        let content = "{\"type\":\"invalid_value\"}\n";
        let (pid, mut handle) = make_scripted_handle(content);
        let stderr = handle.take_stderr();

        let registry = Arc::new(default_test_registry());
        read_chat_output(
            pid,
            &store,
            "ss-int-correction",
            "task-int-correction",
            "work",
            Box::new(TextLineParser),
            handle,
            stderr,
            &integration_workflow(),
            &integration_schema(),
            None,
            &registry,
            Path::new("/tmp"),
            "default",
            0, // remaining_corrections = 0, no re-spawn
        );

        let entries = store.get_log_entries("ss-int-correction").unwrap();

        // (a) ExtractedJson(valid=false) must be present
        assert!(
            entries
                .iter()
                .any(|e| matches!(e, LogEntry::ExtractedJson { valid: false, .. })),
            "ExtractedJson(valid=false) must be present for CorrectionNeeded"
        );

        // (b) exactly one correction UserMessage
        let correction_msgs: Vec<_> = entries
            .iter()
            .filter(|e| {
                matches!(e, LogEntry::UserMessage { resume_type, .. }
                    if resume_type == CORRECTION_RESUME_TYPE)
            })
            .collect();
        assert_eq!(
            correction_msgs.len(),
            1,
            "exactly one correction UserMessage expected, got {}",
            correction_msgs.len()
        );

        // (c) no [System] Text entries — the redundant Text entry was removed
        let system_text_entries: Vec<_> = entries
            .iter()
            .filter(|e| matches!(e, LogEntry::Text { content } if content.contains("[System]")))
            .collect();
        assert!(
            system_text_entries.is_empty(),
            "no [System] Text entries should exist — UserMessage replaces them"
        );
    }

    // -- Chat completion detection tests --

    #[test]
    fn chat_claude_code_markdown_fenced_json_completes_stage() {
        // Fenced JSON is detected: ExtractedJson(valid=true) is stored, no Text entries
        // containing the raw JSON reach the store, and a ChatCompletion iteration is created.
        let store: Arc<dyn WorkflowStore> = Arc::new(InMemoryWorkflowStore::new());

        let mut task = Task::new(
            "task-cc-fenced",
            "Fenced JSON chat test",
            "Verify fenced JSON detection",
            "work",
            "2025-01-01T00:00:00Z",
        );
        task.state = TaskState::awaiting_approval("work");
        store.save_task(&task).unwrap();

        let session = StageSession::new(
            "ss-cc-fenced",
            "task-cc-fenced",
            "work",
            "2025-01-01T00:00:00Z",
        );
        store.save_stage_session(&session).unwrap();

        let content = "```json\n{\"type\":\"summary\",\"content\":\"done\"}\n```\n";
        let (pid, mut handle) = make_scripted_handle(content);
        let stderr = handle.take_stderr();

        let registry = Arc::new(default_test_registry());
        read_chat_output(
            pid,
            &store,
            "ss-cc-fenced",
            "task-cc-fenced",
            "work",
            Box::new(TextLineParser),
            handle,
            stderr,
            &integration_workflow(),
            &integration_schema(),
            None,
            &registry,
            Path::new("/tmp"),
            "default",
            0,
        );

        let entries = store.get_log_entries("ss-cc-fenced").unwrap();

        // Detection succeeded: ExtractedJson(valid=true) must be present.
        assert!(
            entries
                .iter()
                .any(|e| matches!(e, LogEntry::ExtractedJson { valid: true, .. })),
            "ExtractedJson(valid=true) should be present. Got: {entries:?}"
        );

        // No Text entry should contain raw JSON content — buffered and discarded on detection.
        let json_text_entries: Vec<_> = entries
            .iter()
            .filter(|e| matches!(e, LogEntry::Text { content } if content.contains("\"type\":")))
            .collect();
        assert!(
            json_text_entries.is_empty(),
            "no Text entry should contain raw JSON content. Got: {json_text_entries:?}"
        );

        // A ChatCompletion iteration must be created.
        let iterations = store.get_iterations("task-cc-fenced").unwrap();
        assert!(
            iterations.iter().any(|i| i.stage == "work"
                && matches!(i.incoming_context, Some(IterationTrigger::ChatCompletion))),
            "ChatCompletion iteration should be created. Got: {iterations:?}"
        );
    }

    #[test]
    fn chat_claude_code_mixed_prose_and_fence_completes_stage() {
        // Mixed prose + fenced JSON: prose is persisted as a Text entry (it arrives before
        // the fence, so it is not buffered), JSON is buffered and discarded on detection,
        // and a ChatCompletion iteration is created.
        let store: Arc<dyn WorkflowStore> = Arc::new(InMemoryWorkflowStore::new());

        let mut task = Task::new(
            "task-cc-mixed",
            "Mixed prose + JSON chat test",
            "Verify prose persists and JSON does not",
            "work",
            "2025-01-01T00:00:00Z",
        );
        task.state = TaskState::awaiting_approval("work");
        store.save_task(&task).unwrap();

        let session = StageSession::new(
            "ss-cc-mixed",
            "task-cc-mixed",
            "work",
            "2025-01-01T00:00:00Z",
        );
        store.save_stage_session(&session).unwrap();

        // Prose arrives first (not buffered) then fenced JSON (buffered, discarded on Completed).
        let content =
            "Analysis complete.\n\n```json\n{\"type\":\"summary\",\"content\":\"done\"}\n```\n";
        let (pid, mut handle) = make_scripted_handle(content);
        let stderr = handle.take_stderr();

        let registry = Arc::new(default_test_registry());
        read_chat_output(
            pid,
            &store,
            "ss-cc-mixed",
            "task-cc-mixed",
            "work",
            Box::new(TextLineParser),
            handle,
            stderr,
            &integration_workflow(),
            &integration_schema(),
            None,
            &registry,
            Path::new("/tmp"),
            "default",
            0,
        );

        let entries = store.get_log_entries("ss-cc-mixed").unwrap();

        // Detection succeeded.
        assert!(
            entries
                .iter()
                .any(|e| matches!(e, LogEntry::ExtractedJson { valid: true, .. })),
            "ExtractedJson(valid=true) should be present. Got: {entries:?}"
        );

        // Prose "Analysis complete." must be saved as a Text log entry.
        assert!(
            entries.iter().any(
                |e| matches!(e, LogEntry::Text { content } if content == "Analysis complete.")
            ),
            "prose 'Analysis complete.' should be saved as a Text log entry. Got: {entries:?}"
        );

        // The JSON lines must NOT be saved as a Text log entry (buffered and discarded).
        assert!(
            !entries.iter().any(|e| matches!(e, LogEntry::Text { content } if content.contains("\"type\":\"summary\""))),
            "raw JSON should not appear as a Text log entry. Got: {entries:?}"
        );

        // A ChatCompletion iteration must be created.
        let iterations = store.get_iterations("task-cc-mixed").unwrap();
        assert!(
            iterations.iter().any(|i| i.stage == "work"
                && matches!(i.incoming_context, Some(IterationTrigger::ChatCompletion))),
            "ChatCompletion iteration should be created. Got: {iterations:?}"
        );
    }

    /// Parser that accumulates all lines into a single Text entry on finalize.
    ///
    /// Used to test the fallback detection path where prose + ork fence arrive
    /// in a single `LogEntry::Text` (bypassing the buffer path entirely).
    struct SingleEntryParser {
        lines: Vec<String>,
    }

    impl SingleEntryParser {
        fn new() -> Self {
            Self { lines: Vec::new() }
        }
    }

    impl AgentParser for SingleEntryParser {
        fn parse_line(&mut self, line: &str) -> ParsedUpdate {
            self.lines.push(line.to_string());
            ParsedUpdate {
                log_entries: vec![],
                session_id: None,
            }
        }

        fn finalize(&mut self) -> Vec<LogEntry> {
            let content = std::mem::take(&mut self.lines).join("\n");
            if content.is_empty() {
                vec![]
            } else {
                vec![LogEntry::Text { content }]
            }
        }

        fn extract_output(&self, _full_output: &str) -> Result<String, String> {
            Err("not used in chat mode".to_string())
        }
    }

    #[test]
    fn chat_prose_and_ork_fence_in_single_entry_completes_stage() {
        // Case 1 (primary fix): a single Text entry containing prose followed by an ork fence.
        // Uses SingleEntryParser so all lines arrive as one LogEntry::Text in finalize().
        // The buffer path never fires (starts with prose), so the fallback `last_persisted_text`
        // path must handle detection.
        let store: Arc<dyn WorkflowStore> = Arc::new(InMemoryWorkflowStore::new());

        let mut task = Task::new(
            "task-single-entry",
            "Single entry test",
            "Prose + ork fence in one Text entry",
            "work",
            "2025-01-01T00:00:00Z",
        );
        task.state = TaskState::awaiting_approval("work");
        store.save_task(&task).unwrap();

        let session = StageSession::new(
            "ss-single-entry",
            "task-single-entry",
            "work",
            "2025-01-01T00:00:00Z",
        );
        store.save_stage_session(&session).unwrap();

        // All lines are accumulated by SingleEntryParser and emitted as one Text entry in finalize()
        let content = "Here is my revised plan:\n\n```ork\n{\"type\":\"summary\",\"content\":\"done\"}\n```\n";
        let (pid, mut handle) = make_scripted_handle(content);
        let stderr = handle.take_stderr();

        let registry = Arc::new(default_test_registry());
        read_chat_output(
            pid,
            &store,
            "ss-single-entry",
            "task-single-entry",
            "work",
            Box::new(SingleEntryParser::new()),
            handle,
            stderr,
            &integration_workflow(),
            &integration_schema(),
            None,
            &registry,
            Path::new("/tmp"),
            "default",
            0,
        );

        let entries = store.get_log_entries("ss-single-entry").unwrap();

        assert!(
            entries
                .iter()
                .any(|e| matches!(e, LogEntry::ExtractedJson { valid: true, .. })),
            "ExtractedJson(valid=true) must be present for prose+ork-fence in single entry. Got: {entries:?}"
        );

        let iterations = store.get_iterations("task-single-entry").unwrap();
        assert!(
            iterations.iter().any(|i| i.stage == "work"
                && matches!(i.incoming_context, Some(IterationTrigger::ChatCompletion))),
            "ChatCompletion iteration should be created. Got: {iterations:?}"
        );
    }

    #[test]
    fn chat_json_example_mid_response_ork_fence_wins() {
        // Case 4: prose containing a JSON example followed by an ork fence in one Text entry.
        // The ork fence (Strategy 1 in extract_from_text_content) must win over the bare JSON
        // example embedded in prose.
        let store: Arc<dyn WorkflowStore> = Arc::new(InMemoryWorkflowStore::new());

        let mut task = Task::new(
            "task-json-example",
            "JSON example mid-response test",
            "Verify ork fence wins over bare JSON example",
            "work",
            "2025-01-01T00:00:00Z",
        );
        task.state = TaskState::awaiting_approval("work");
        store.save_task(&task).unwrap();

        let session = StageSession::new(
            "ss-json-example",
            "task-json-example",
            "work",
            "2025-01-01T00:00:00Z",
        );
        store.save_stage_session(&session).unwrap();

        // Bare JSON example in prose followed by the real ork fence — all in one Text entry.
        let content = "Old format was {\"type\":\"failed\"} but here is the real one:\n\n```ork\n{\"type\":\"summary\",\"content\":\"correct\"}\n```\n";
        let (pid, mut handle) = make_scripted_handle(content);
        let stderr = handle.take_stderr();

        let registry = Arc::new(default_test_registry());
        read_chat_output(
            pid,
            &store,
            "ss-json-example",
            "task-json-example",
            "work",
            Box::new(SingleEntryParser::new()),
            handle,
            stderr,
            &integration_workflow(),
            &integration_schema(),
            None,
            &registry,
            Path::new("/tmp"),
            "default",
            0,
        );

        let entries = store.get_log_entries("ss-json-example").unwrap();

        // Ork fence content must win — ExtractedJson should be valid and contain "correct"
        let extracted: Vec<_> = entries
            .iter()
            .filter_map(|e| {
                if let LogEntry::ExtractedJson { raw_json, valid } = e {
                    Some((raw_json, valid))
                } else {
                    None
                }
            })
            .collect();
        assert!(
            !extracted.is_empty(),
            "ExtractedJson must be present. Got: {entries:?}"
        );
        let (raw_json, valid) = extracted[0];
        assert!(
            *valid,
            "Ork fence content must win and be valid. Got: {entries:?}"
        );
        assert!(
            raw_json.contains("correct"),
            "raw_json should contain 'correct' (ork fence wins). Got raw_json: {raw_json}"
        );
    }

    #[test]
    fn chat_trailing_text_after_ork_fence_no_detection() {
        // Case 5 (regression): ork fence as its own entries followed by trailing prose.
        // Trailing prose flushes the buffer (json_complete resets), and last_persisted_text
        // is the trailing prose which contains no JSON — so no detection fires.
        let store: Arc<dyn WorkflowStore> = Arc::new(InMemoryWorkflowStore::new());
        let session = StageSession::new(
            "ss-trailing-ork",
            "task-trailing-ork",
            "work",
            "2025-01-01T00:00:00Z",
        );
        store.save_stage_session(&session).unwrap();

        // TextLineParser splits on newlines, so the ork fence and trailing text are separate entries.
        // The trailing text entry flushes the buffer on arrival.
        let content = "```ork\n{\"type\":\"summary\",\"content\":\"done\"}\n```\nBut wait, I changed my mind\n";
        let (pid, mut handle) = make_scripted_handle(content);
        let stderr = handle.take_stderr();

        let registry = Arc::new(default_test_registry());
        read_chat_output(
            pid,
            &store,
            "ss-trailing-ork",
            "task-trailing-ork",
            "work",
            Box::new(TextLineParser),
            handle,
            stderr,
            &integration_workflow(),
            &integration_schema(),
            None,
            &registry,
            Path::new("/tmp"),
            "default",
            0,
        );

        let entries = store.get_log_entries("ss-trailing-ork").unwrap();

        assert!(
            !entries
                .iter()
                .any(|e| matches!(e, LogEntry::ExtractedJson { .. })),
            "no ExtractedJson — trailing text after ork fence must invalidate detection. Got: {entries:?}"
        );

        // All text entries should have been flushed to the store
        let text_count = entries
            .iter()
            .filter(|e| matches!(e, LogEntry::Text { .. }))
            .count();
        assert!(text_count > 0, "flushed text entries must reach the store");
    }

    #[test]
    fn chat_completion_notification_has_stage_completed_flag() {
        // When chat-mode structured output detection completes a stage, exactly one
        // LogNotification emitted to the channel has stage_completed=true. All other
        // notifications in the same session have stage_completed=false.
        let store: Arc<dyn WorkflowStore> = Arc::new(InMemoryWorkflowStore::new());

        let mut task = Task::new(
            "task-cc-notify",
            "Notification flag test",
            "Verify stage_completed flag in LogNotification",
            "work",
            "2025-01-01T00:00:00Z",
        );
        task.state = TaskState::awaiting_approval("work");
        store.save_task(&task).unwrap();

        let session = StageSession::new(
            "ss-cc-notify",
            "task-cc-notify",
            "work",
            "2025-01-01T00:00:00Z",
        );
        store.save_stage_session(&session).unwrap();

        let (tx, rx) = std::sync::mpsc::channel::<LogNotification>();

        let content = "```json\n{\"type\":\"summary\",\"content\":\"done\"}\n```\n";
        let (pid, mut handle) = make_scripted_handle(content);
        let stderr = handle.take_stderr();

        let registry = Arc::new(default_test_registry());
        read_chat_output(
            pid,
            &store,
            "ss-cc-notify",
            "task-cc-notify",
            "work",
            Box::new(TextLineParser),
            handle,
            stderr,
            &integration_workflow(),
            &integration_schema(),
            Some(&tx),
            &registry,
            Path::new("/tmp"),
            "default",
            0,
        );

        // Drain all notifications accumulated during the session.
        let mut notifications: Vec<LogNotification> = Vec::new();
        while let Ok(n) = rx.try_recv() {
            notifications.push(n);
        }

        assert!(
            !notifications.is_empty(),
            "should have received at least one LogNotification from the chat session"
        );

        // Exactly one notification must have stage_completed=true.
        let completed: Vec<_> = notifications.iter().filter(|n| n.stage_completed).collect();
        assert_eq!(
            completed.len(),
            1,
            "exactly one LogNotification should have stage_completed=true. \
             Got {} completed out of {} total. Notifications: {notifications:?}",
            completed.len(),
            notifications.len()
        );

        // All other notifications must have stage_completed=false.
        let non_completed: Vec<_> = notifications
            .iter()
            .filter(|n| !n.stage_completed)
            .collect();
        assert_eq!(
            non_completed.len(),
            notifications.len() - 1,
            "all notifications except the stage_completed one should have stage_completed=false. \
             Got: {non_completed:?}"
        );
    }
}
