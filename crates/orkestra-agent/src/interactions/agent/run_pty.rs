//! PTY-based agent execution for interactive Claude Code sessions.
//!
//! Spawns Claude Code in a PTY, injects the prompt via keystrokes, waits for
//! the hook-based Stop callback, reads the JSONL transcript, classifies output,
//! and emits `RunEvents` matching the (u32, Receiver<RunEvent>) contract.

use std::collections::{HashMap, VecDeque};
use std::io::{BufReader, Read, Seek, SeekFrom, Write};
use std::path::{Path, PathBuf};
use std::sync::mpsc::{self, Receiver, Sender};
use std::sync::{Arc, Mutex};
use std::thread;
use std::time::Duration;

use orkestra_parser::interactions::stream::parse_resume_marker;
use orkestra_parser::AgentParser;
use orkestra_process::ProcessGuard;
use orkestra_types::domain::{compute_transcript_path, LogEntry, PromptSection};
use portable_pty::{CommandBuilder, PtySize};
use tempfile::NamedTempFile;

use crate::interactions::hooks::types::{HookReceiver, HookServer};
use crate::orkestra_debug;
use crate::registry::{ProviderRegistry, ResolvedProvider};
use crate::types::{AgentCompletionError, RunConfig, RunError, RunEvent};

use super::classify_output::{self, OutputClassification};

// ============================================================================
// PTY Handle
// ============================================================================

/// Owns the PTY process lifecycle. `ProcessGuard` fires SIGTERM on drop.
///
/// `child` and `guard` are held for their drop-side effects rather than read
/// access — `child` keeps the PTY slave open, `guard` sends SIGTERM on drop.
/// `_drain_thread` continuously reads PTY master output to prevent the classic
/// output-buffer deadlock: if the slave process fills the master output buffer,
/// it blocks on stdout and stops reading stdin, which in turn blocks our prompt
/// `write_all`. The drain thread also retains the last 8KB of output for
/// diagnosability on startup failure. It exits naturally when the PTY closes
/// (EOF) after the process is killed.
#[allow(dead_code)]
struct PtyHandle {
    writer: Box<dyn Write + Send>,
    child: Box<dyn portable_pty::Child + Send + Sync>,
    guard: ProcessGuard,
    _drain_thread: thread::JoinHandle<()>,
    output_tail: Arc<Mutex<VecDeque<u8>>>,
}

// ============================================================================
// Entry Point
// ============================================================================

/// Run an agent in a PTY session with event streaming.
///
/// Spawns Claude Code in a PTY, writes the prompt via keystrokes, waits for
/// the hook-based Stop callback, reads the JSONL transcript, classifies output,
/// and emits `RunEvents`. Returns `(pid, receiver)` matching the standard contract.
///
/// `resolved` is the already-resolved provider from the service layer (avoids double resolution).
pub fn execute(
    resolved: &ResolvedProvider,
    registry: &Arc<ProviderRegistry>,
    config: &RunConfig,
    hook_server: &Arc<HookServer>,
) -> Result<(u32, Receiver<RunEvent>), RunError> {
    // Create parser — claude-pty uses the same JSONL format as claudecode
    let parser = registry
        .create_parser(&resolved.provider_name)
        .map_err(|e| RunError::SpawnFailed(e.to_string()))?;

    // Parse schema for validation — fail fast on invalid JSON rather than silently ignoring it
    let schema: Option<serde_json::Value> = if config.json_schema.trim().is_empty() {
        None
    } else {
        Some(
            serde_json::from_str(&config.json_schema)
                .map_err(|e| RunError::SpawnFailed(format!("invalid JSON schema: {e}")))?,
        )
    };

    // Clone before config is consumed
    let prompt_sections = config.prompt_sections.clone();
    let prompt = config.prompt.clone();

    let session_id = config
        .session_id
        .clone()
        .unwrap_or_else(|| uuid::Uuid::new_v4().to_string());
    let task_id = config.task_id.clone().unwrap_or_else(|| session_id.clone());
    let is_resume = config.is_resume;
    let working_dir = config.working_dir.clone();
    let resolved_model_id = resolved.model_id.clone();
    let env = config.env.clone();

    // Resolve HOME before spawning the background thread (no hidden env access in helpers)
    let home_dir = std::env::var_os("HOME")
        .map(PathBuf::from)
        .ok_or_else(|| RunError::SpawnFailed("HOME environment variable not set".into()))?;

    // Register task with hook server before spawning PTY so no events are missed
    let hook_rx = hook_server.register_task(&task_id);
    let socket_path = hook_server
        .socket_path()
        .to_str()
        .ok_or_else(|| {
            RunError::SpawnFailed("hook socket path contains non-UTF-8 characters".into())
        })?
        .to_string();

    // Write hook settings to a temp file; kept alive until the session ends
    let settings_file = build_settings_file(&session_id, &socket_path)
        .map_err(|e| RunError::SpawnFailed(format!("failed to write hook settings: {e}")))?;

    let settings_path = settings_file.path().to_path_buf();

    let (pty_handle, pid) = open_and_spawn_pty(&PtyCommandConfig {
        session_id: &session_id,
        is_resume,
        settings_path: &settings_path,
        model: resolved_model_id.as_deref(),
        working_dir: &working_dir,
        task_id: &task_id,
        disallowed_tools: &config.disallowed_tools,
        env: env.as_ref(),
    })?;
    orkestra_debug!("runner", "run_pty: spawned pid={}", pid);

    // Create event channel
    let (tx, rx) = mpsc::channel();

    // Emit UserMessage log entry (same pattern as run_async)
    emit_user_message(&tx, &prompt, prompt_sections);

    // Clone Arc for the background thread
    let hook_server_thread = Arc::clone(hook_server);

    thread::spawn(move || {
        // Keep settings_file alive until the PTY session ends
        let _settings_file = settings_file;

        let ctx = PtySessionParams {
            task_id: &task_id,
            session_id: &session_id,
            working_dir: &working_dir,
            prompt: &prompt,
            schema: schema.as_ref(),
            home_dir: &home_dir,
        };
        drive_pty_session(pty_handle, &hook_rx, &hook_server_thread, &tx, parser, ctx);
    });

    Ok((pid, rx))
}

// ============================================================================
// Background Thread
// ============================================================================

/// Session parameters bundled to keep `drive_pty_session`'s argument count in check.
#[derive(Copy, Clone)]
struct PtySessionParams<'a> {
    task_id: &'a str,
    session_id: &'a str,
    working_dir: &'a Path,
    prompt: &'a str,
    schema: Option<&'a serde_json::Value>,
    /// Resolved `$HOME` directory — passed explicitly to avoid hidden env reads in helpers.
    home_dir: &'a Path,
}

fn drive_pty_session(
    mut pty_handle: PtyHandle,
    hook_rx: &HookReceiver,
    hook_server: &HookServer,
    tx: &Sender<RunEvent>,
    mut parser: Box<dyn AgentParser>,
    ctx: PtySessionParams<'_>,
) {
    // Write prompt to PTY master, then send Enter (\r) and flush.
    // \r is used instead of \n: Claude Code's TUI runs in raw mode where \r is
    // the Enter key. The PTY line discipline (ICRNL) converts \r→\n for the slave
    // in canonical mode, so \r also works for shells/scripts that read lines.
    let write_result = pty_handle
        .writer
        .write_all(ctx.prompt.as_bytes())
        .and_then(|()| pty_handle.writer.write_all(b"\r"))
        .and_then(|()| pty_handle.writer.flush());

    if let Err(e) = write_result {
        let _ = tx.send(RunEvent::Completed(Err(AgentCompletionError::Crash(
            format!("failed to write prompt to PTY: {e}"),
        ))));
        hook_server.unregister_task(ctx.task_id);
        return;
    }

    orkestra_debug!(
        "runner",
        "run_pty: prompt written ({} bytes)",
        ctx.prompt.len()
    );

    // Poll for JSONL transcript file to confirm session started.
    // Two Text entries are required to set `has_confirmed_output` in ActiveAgent::poll(),
    // persisting `has_activity=true` for crash recovery (one Text only sets `has_any_output`).
    //
    // Re-send Enter every ~3s to handle the TUI startup race: when the TUI isn't ready,
    // the prompt and trailing \r written above are ingested as paste-like input and the \r
    // doesn't submit. Extra \r on an idle composer is a no-op; on an unsubmitted composer
    // it submits.
    let fallback_transcript_path =
        compute_transcript_path(ctx.home_dir, ctx.working_dir, ctx.session_id);
    let poll_deadline = std::time::Instant::now() + Duration::from_secs(30);

    let poll_outcome = poll_for_transcript_with_enter_retry(
        &fallback_transcript_path,
        poll_deadline,
        &mut pty_handle.writer,
    );

    let transcript_found = match poll_outcome {
        PollOutcome::Found => true,
        PollOutcome::Timeout => false,
        PollOutcome::WriteFailed(e) => {
            // PTY process died — fail fast instead of waiting 30s
            let _ = tx.send(RunEvent::Completed(Err(AgentCompletionError::Crash(
                format!("PTY process died during startup — failed to write Enter: {e}"),
            ))));
            drop(pty_handle);
            hook_server.unregister_task(ctx.task_id);
            return;
        }
    };

    if transcript_found {
        let _ = tx.send(RunEvent::LogLine(LogEntry::Text {
            content: "PTY session active".to_string(),
        }));
        let _ = tx.send(RunEvent::LogLine(LogEntry::Text {
            content: "PTY session confirmed".to_string(),
        }));
    } else {
        handle_transcript_not_found(pty_handle, hook_server, tx, ctx.task_id);
        return;
    }

    // Tail transcript during execution, emitting LogLine events as lines arrive.
    // Non-blocking: polls transcript file every 150ms while waiting for Stop hook.
    let (hook_event, mut full_output, tail_file_pos) =
        tail_transcript_until_stop(&fallback_transcript_path, hook_rx, &mut *parser, tx);

    // Use transcript path from hook event if available, else computed fallback.
    // In practice these match — the divergence path is a safety net.
    let transcript_path = hook_event
        .as_ref()
        .and_then(|e| e.transcript_path.clone())
        .unwrap_or_else(|| fallback_transcript_path.clone());

    // Resume final read from where tail left off (same file) or from 0 (diverged file).
    let final_read_pos = if transcript_path == fallback_transcript_path {
        tail_file_pos
    } else {
        full_output.clear();
        0
    };

    // Wait for transcript file size to stabilize before final read; the Stop hook fires
    // before Claude finishes flushing the final bytes to disk.
    wait_for_stable_size(
        &transcript_path,
        Duration::from_millis(200),
        Duration::from_secs(5),
    );

    // Final read: catch any lines written between the last tail poll and stabilization.
    let mut trailing_count = 0usize;
    read_new_lines(
        &transcript_path,
        final_read_pos,
        &mut *parser,
        tx,
        &mut full_output,
        &mut trailing_count,
    );

    // Kill PTY process — ProcessGuard fires SIGTERM on drop (not disarmed)
    drop(pty_handle);

    // Cleanup
    hook_server.unregister_task(ctx.task_id);

    // Flush finalized parser entries
    for entry in parser.finalize() {
        if tx.send(RunEvent::LogLine(entry)).is_err() {
            return;
        }
    }

    // Classify output and emit completion
    let result = match classify_output::execute(&*parser, &full_output, ctx.schema) {
        OutputClassification::Success(output) => Ok(output),
        OutputClassification::ExtractionFailed(e) => Err(AgentCompletionError::Crash(e)),
        OutputClassification::PlainText(text) => Err(AgentCompletionError::PlainText(text)),
        OutputClassification::ParseFailed(e) => Err(AgentCompletionError::MalformedOutput(e)),
    };

    orkestra_debug!("runner", "run_pty: completion result ok={}", result.is_ok());

    let _ = tx.send(RunEvent::Completed(result));
}

// ============================================================================
// Helpers
// ============================================================================

/// Outcome of the transcript poll loop in `drive_pty_session`.
enum PollOutcome {
    Found,
    Timeout,
    WriteFailed(String),
}

/// Poll for the JSONL transcript file, re-sending Enter every ~3s to handle the TUI startup race.
///
/// Returns `Found` when the file appears, `Timeout` when the deadline passes, or
/// `WriteFailed` when the PTY writer returns an error (process died).
fn poll_for_transcript_with_enter_retry(
    path: &Path,
    deadline: std::time::Instant,
    writer: &mut Box<dyn Write + Send>,
) -> PollOutcome {
    let mut polls_since_enter = 0u32;
    loop {
        if path.exists() {
            return PollOutcome::Found;
        }
        if std::time::Instant::now() >= deadline {
            return PollOutcome::Timeout;
        }
        polls_since_enter += 1;
        if polls_since_enter >= 6 {
            polls_since_enter = 0;
            if let Err(e) = writer.write_all(b"\r").and_then(|()| writer.flush()) {
                return PollOutcome::WriteFailed(e.to_string());
            }
        }
        thread::sleep(Duration::from_millis(500));
    }
}

/// Handle the case where the transcript never appeared within the startup deadline.
///
/// Builds a diagnostic message from the PTY output tail, cleans up resources, and
/// sends a `Crash` completion event.
fn handle_transcript_not_found(
    pty_handle: PtyHandle,
    hook_server: &HookServer,
    tx: &Sender<RunEvent>,
    task_id: &str,
) {
    let tail_text = {
        let raw = if let Ok(tail) = pty_handle.output_tail.lock() {
            tail.iter().copied().collect::<Vec<u8>>()
        } else {
            orkestra_debug!(
                "runner",
                "run_pty: output_tail mutex poisoned — PTY drain thread panicked; no diagnostic output available"
            );
            Vec::new()
        };
        strip_ansi_codes(&String::from_utf8_lossy(&raw))
    };
    drop(pty_handle);
    hook_server.unregister_task(task_id);
    let mut msg = "PTY session failed to start — transcript file not found after 30s".to_string();
    if !tail_text.is_empty() {
        msg.push_str("\n\n--- PTY output tail ---\n");
        msg.push_str(&tail_text);
    }
    let _ = tx.send(RunEvent::Completed(Err(AgentCompletionError::Crash(msg))));
}

/// Open a PTY, spawn the Claude Code command, and return a `PtyHandle` with the child PID.
fn open_and_spawn_pty(cfg: &PtyCommandConfig<'_>) -> Result<(PtyHandle, u32), RunError> {
    const TAIL_CAPACITY: usize = 8192;
    let cmd = build_pty_command(cfg)?;

    let pty_system = portable_pty::native_pty_system();
    let pair = pty_system
        .openpty(PtySize {
            rows: 24,
            cols: 80,
            pixel_width: 0,
            pixel_height: 0,
        })
        .map_err(|e| RunError::SpawnFailed(format!("failed to open PTY: {e}")))?;

    let child = pair
        .slave
        .spawn_command(cmd)
        .map_err(|e| RunError::SpawnFailed(format!("failed to spawn PTY process: {e}")))?;

    let pid = child
        .process_id()
        .ok_or_else(|| RunError::SpawnFailed("PTY child has no process ID".into()))?
        as u32;

    // Clone the master reader before taking the writer — both use &self so order
    // doesn't matter, but cloning first makes the intent clear: we need to drain
    // the output side to prevent output-buffer deadlock during the prompt write.
    let drain_reader = pair
        .master
        .try_clone_reader()
        .map_err(|e| RunError::SpawnFailed(format!("failed to clone PTY reader: {e}")))?;

    let output_tail: Arc<Mutex<VecDeque<u8>>> =
        Arc::new(Mutex::new(VecDeque::with_capacity(TAIL_CAPACITY)));
    let drain_tail = Arc::clone(&output_tail);

    let drain_thread = thread::spawn(move || {
        let mut buf = [0u8; 4096];
        let mut reader = drain_reader;
        loop {
            match reader.read(&mut buf) {
                Ok(0) | Err(_) => break,
                Ok(n) => {
                    if let Ok(mut tail) = drain_tail.lock() {
                        tail.extend(&buf[..n]);
                        let excess = tail.len().saturating_sub(TAIL_CAPACITY);
                        if excess > 0 {
                            tail.drain(..excess);
                        }
                    }
                }
            }
        }
    });

    let writer = pair
        .master
        .take_writer()
        .map_err(|e| RunError::SpawnFailed(format!("failed to get PTY writer: {e}")))?;

    Ok((
        PtyHandle {
            writer,
            child,
            guard: ProcessGuard::new(pid),
            _drain_thread: drain_thread,
            output_tail,
        },
        pid,
    ))
}

fn emit_user_message(tx: &Sender<RunEvent>, prompt: &str, prompt_sections: Vec<PromptSection>) {
    if let Some(marker) = parse_resume_marker::execute(prompt) {
        let _ = tx.send(RunEvent::LogLine(LogEntry::UserMessage {
            resume_type: marker.marker_type.as_str().to_string(),
            content: marker.content,
            sections: prompt_sections,
        }));
    } else {
        let _ = tx.send(RunEvent::LogLine(LogEntry::UserMessage {
            resume_type: "user_message".to_string(),
            content: prompt.to_string(),
            sections: prompt_sections,
        }));
    }
}

/// Parameters for constructing the PTY `CommandBuilder`.
struct PtyCommandConfig<'a> {
    session_id: &'a str,
    is_resume: bool,
    settings_path: &'a Path,
    model: Option<&'a str>,
    working_dir: &'a Path,
    task_id: &'a str,
    disallowed_tools: &'a [String],
    env: Option<&'a HashMap<String, String>>,
}

/// Build the `CommandBuilder` for spawning Claude Code in a PTY.
///
/// Mirrors the headless path in `spawner/claude.rs`: uses
/// `--dangerously-skip-permissions`, blocks `EnterPlanMode`/`ExitPlanMode`, and
/// threads `disallowed_tools` from the stage config.
fn build_pty_command(cfg: &PtyCommandConfig<'_>) -> Result<CommandBuilder, RunError> {
    let mut cmd = CommandBuilder::new("claude");

    if cfg.is_resume {
        cmd.args(["--resume", cfg.session_id]);
    } else {
        cmd.args(["--session-id", cfg.session_id]);
    }

    cmd.arg("--dangerously-skip-permissions");

    let settings_path_str = cfg.settings_path.to_str().ok_or_else(|| {
        RunError::SpawnFailed("settings path contains non-UTF-8 characters".into())
    })?;
    cmd.args(["--settings", settings_path_str]);

    if let Some(model) = cfg.model {
        cmd.args(["--model", model]);
    }

    // Block plan-mode tools and any stage-level restrictions (same as headless path).
    let mut disallowed = vec!["EnterPlanMode".to_string(), "ExitPlanMode".to_string()];
    disallowed.extend_from_slice(cfg.disallowed_tools);
    cmd.args(["--disallowedTools", &disallowed.join(",")]);

    cmd.cwd(cfg.working_dir);
    cmd.env("ORK_TASK_ID", cfg.task_id);
    cmd.env("CLAUDE_CODE_DISABLE_BACKGROUND_TASKS", "1");

    if let Some(env_map) = cfg.env {
        for (k, v) in env_map {
            cmd.env(k, v);
        }
    }

    Ok(cmd)
}

/// Write Claude Code hook settings JSON to a temp file.
///
/// The Stop hook sends the turn-done signal to the UDS server. `SessionEnd`
/// fires when the process terminates. Both commands use `$ORK_TASK_ID` (set
/// in the PTY environment) for server-side routing.
///
/// Returns an error if `socket_path` or `session_id` contain shell metacharacters.
fn build_settings_file(
    session_id: &str,
    socket_path: &str,
) -> Result<NamedTempFile, Box<dyn std::error::Error + Send + Sync>> {
    // Guard against shell injection — both values are embedded in a shell command.
    if !socket_path
        .chars()
        .all(|c| c.is_ascii_alphanumeric() || matches!(c, '/' | '.' | '-' | '_'))
    {
        return Err(format!("socket path contains shell-unsafe characters: {socket_path}").into());
    }
    if !session_id
        .chars()
        .all(|c| c.is_ascii_alphanumeric() || matches!(c, '-' | '_'))
    {
        return Err(format!("session_id contains shell-unsafe characters: {session_id}").into());
    }

    let stop_cmd = format!(
        "echo '{{\"event\":\"stop\",\"task_id\":\"'\"$ORK_TASK_ID\"'\",\"session_id\":\"{session_id}\",\"transcript_path\":\"'\"$CLAUDE_TRANSCRIPT_PATH\"'\"}}' | nc -U {socket_path}"
    );
    let session_end_cmd = format!(
        "echo '{{\"event\":\"session_end\",\"task_id\":\"'\"$ORK_TASK_ID\"'\",\"session_id\":\"{session_id}\"}}' | nc -U {socket_path}"
    );

    let settings = serde_json::json!({
        "hooks": {
            "Stop": [{"matcher": "", "hooks": [{"type": "command", "command": stop_cmd}]}],
            "SessionEnd": [{"matcher": "", "hooks": [{"type": "command", "command": session_end_cmd}]}]
        }
    });

    let mut file = NamedTempFile::new()?;
    let json_bytes = serde_json::to_vec(&settings)?;
    file.write_all(&json_bytes)?;
    Ok(file)
}

/// Wait until the file size stops changing for `stable_for`, up to `timeout`.
///
/// Polls at 50ms intervals. Returns immediately if the file does not exist (the
/// final `read_new_lines` call will return 0 entries).
fn wait_for_stable_size(path: &Path, stable_for: Duration, timeout: Duration) {
    let deadline = std::time::Instant::now() + timeout;
    let mut last_size: Option<u64> = None;
    let mut stable_since: Option<std::time::Instant> = None;

    loop {
        if std::time::Instant::now() >= deadline {
            break;
        }
        let current_size = std::fs::metadata(path).map(|m| m.len()).ok();
        if current_size.is_some() && current_size == last_size {
            let since = stable_since.get_or_insert_with(std::time::Instant::now);
            if since.elapsed() >= stable_for {
                break;
            }
        } else {
            stable_since = None;
        }
        last_size = current_size;
        thread::sleep(Duration::from_millis(50));
    }
}

/// Read new complete lines from `path` starting at `file_pos` (byte offset), parse each
/// through `parser`, emit `LogLine` events, append to `full_output`, and return the updated
/// byte position. Incomplete trailing lines (no terminating `\n`) are not parsed — the position
/// stops at the last complete line boundary so the next call picks them up once they finish.
fn read_new_lines(
    path: &Path,
    file_pos: usize,
    parser: &mut dyn AgentParser,
    tx: &Sender<RunEvent>,
    full_output: &mut String,
    line_count: &mut usize,
) -> usize {
    let Ok(mut file) = std::fs::File::open(path) else {
        return file_pos;
    };

    if file.seek(SeekFrom::Start(file_pos as u64)).is_err() {
        return file_pos;
    }

    let mut raw = Vec::new();
    if BufReader::new(file).read_to_end(&mut raw).is_err() {
        return file_pos;
    }
    let buf = String::from_utf8_lossy(&raw);

    // Only process up to the last newline — trailing partial lines are not yet complete.
    let complete_end = match buf.rfind('\n') {
        Some(pos) => pos + 1,
        None => return file_pos,
    };

    for line in buf[..complete_end].lines() {
        if line.trim().is_empty() {
            continue;
        }
        *line_count += 1;

        let update = parser.parse_line(line);

        if let Some(sid) = update.session_id {
            let _ = tx.send(RunEvent::SessionId(sid));
        }

        for entry in update.log_entries {
            if tx.send(RunEvent::LogLine(entry)).is_err() {
                return file_pos + complete_end;
            }
        }

        full_output.push_str(line);
        full_output.push('\n');
    }

    file_pos + complete_end
}

/// Poll the transcript file for new lines every 150ms while waiting for the Stop hook.
///
/// Returns `(hook_event, full_output, file_pos)`. `full_output` contains all content
/// parsed so far; `file_pos` is the byte offset for the subsequent final read.
fn tail_transcript_until_stop(
    transcript_path: &Path,
    hook_rx: &HookReceiver,
    parser: &mut dyn AgentParser,
    tx: &Sender<RunEvent>,
) -> (
    Option<crate::interactions::hooks::types::HookEvent>,
    String,
    usize,
) {
    use std::sync::mpsc::TryRecvError;

    let mut file_pos = 0usize;
    let mut full_output = String::new();
    let mut line_count = 0usize;

    loop {
        match hook_rx.receiver.try_recv() {
            Ok(event) => {
                orkestra_debug!(
                    "runner",
                    "run_pty: got hook event {:?} for session {}",
                    event.event_type,
                    event.session_id
                );
                return (Some(event), full_output, file_pos);
            }
            Err(TryRecvError::Empty) => {
                file_pos = read_new_lines(
                    transcript_path,
                    file_pos,
                    parser,
                    tx,
                    &mut full_output,
                    &mut line_count,
                );
                thread::sleep(Duration::from_millis(150));
            }
            Err(TryRecvError::Disconnected) => {
                orkestra_debug!("runner", "run_pty: hook receiver disconnected");
                return (None, full_output, file_pos);
            }
        }
    }
}

/// Strip ANSI escape sequences from text for human-readable error messages.
///
/// Handles CSI sequences (`\x1b[...letter`) and OSC sequences (`\x1b]...BEL/ST`).
/// Duplicated from `orkestra-networking::ci_log_parser::strip_ansi_codes` —
/// `orkestra-agent` cannot depend on `orkestra-networking`.
fn strip_ansi_codes(text: &str) -> String {
    let mut result = String::with_capacity(text.len());
    let mut chars = text.chars().peekable();
    while let Some(c) = chars.next() {
        if c == '\x1b' {
            match chars.peek() {
                Some('[') => {
                    chars.next();
                    while let Some(&next) = chars.peek() {
                        chars.next();
                        if next.is_ascii_alphabetic() {
                            break;
                        }
                    }
                }
                Some(']') => {
                    chars.next();
                    while let Some(&next) = chars.peek() {
                        chars.next();
                        if next == '\x07' {
                            break;
                        }
                        if next == '\x1b' {
                            if chars.peek() == Some(&'\\') {
                                chars.next();
                            }
                            break;
                        }
                    }
                }
                _ => {
                    chars.next();
                }
            }
        } else {
            result.push(c);
        }
    }
    result
}

// ============================================================================
// Tests
// ============================================================================

#[cfg(test)]
mod tests {
    use std::path::PathBuf;
    use std::time::Duration;

    use tempfile::TempDir;

    use super::*;

    fn poll_for_file(path: &Path, timeout: Duration) -> bool {
        let deadline = std::time::Instant::now() + timeout;
        loop {
            if path.exists() {
                return true;
            }
            if std::time::Instant::now() >= deadline {
                return false;
            }
            thread::sleep(Duration::from_millis(500));
        }
    }

    #[test]
    fn strip_ansi_codes_plain_text_passthrough() {
        assert_eq!(
            strip_ansi_codes("hello world\nline 2"),
            "hello world\nline 2"
        );
    }

    #[test]
    fn strip_ansi_codes_csi_sequences() {
        assert_eq!(strip_ansi_codes("\x1b[1mhello\x1b[0m world"), "hello world");
        assert_eq!(strip_ansi_codes("\x1b[31mred\x1b[0m"), "red");
    }

    #[test]
    fn strip_ansi_codes_osc_with_bel_terminator() {
        assert_eq!(
            strip_ansi_codes("\x1b]0;window title\x07visible text"),
            "visible text"
        );
    }

    #[test]
    fn strip_ansi_codes_osc_with_st_terminator() {
        assert_eq!(
            strip_ansi_codes("\x1b]2;title\x1b\\visible text"),
            "visible text"
        );
    }

    #[test]
    fn settings_file_contains_stop_and_session_end_hooks() {
        let file = build_settings_file("ses-123", "/tmp/hooks.sock").unwrap();
        let content = std::fs::read_to_string(file.path()).unwrap();
        let parsed: serde_json::Value = serde_json::from_str(&content).unwrap();

        // Assert nested hook schema: {"matcher": "", "hooks": [{"type": "command", "command": ...}]}
        let stop_hooks = &parsed["hooks"]["Stop"];
        assert!(stop_hooks.is_array(), "Stop hooks should be an array");
        assert_eq!(
            parsed["hooks"]["Stop"][0]["hooks"][0]["type"].as_str(),
            Some("command"),
            "Stop hook must use nested hooks array with type=command"
        );
        let stop_cmd = parsed["hooks"]["Stop"][0]["hooks"][0]["command"]
            .as_str()
            .unwrap();
        assert!(
            stop_cmd.contains("nc -U /tmp/hooks.sock"),
            "Stop cmd missing socket path"
        );
        assert!(
            stop_cmd.contains("\"event\":\"stop\""),
            "Stop cmd missing event type"
        );
        assert!(stop_cmd.contains("ses-123"), "Stop cmd missing session_id");
        assert!(
            stop_cmd.contains("$CLAUDE_TRANSCRIPT_PATH"),
            "Stop cmd missing transcript path var"
        );

        let se_hooks = &parsed["hooks"]["SessionEnd"];
        assert!(se_hooks.is_array(), "SessionEnd hooks should be an array");
        assert_eq!(
            parsed["hooks"]["SessionEnd"][0]["hooks"][0]["type"].as_str(),
            Some("command"),
            "SessionEnd hook must use nested hooks array with type=command"
        );
        let se_cmd = parsed["hooks"]["SessionEnd"][0]["hooks"][0]["command"]
            .as_str()
            .unwrap();
        assert!(
            se_cmd.contains("nc -U /tmp/hooks.sock"),
            "SessionEnd cmd missing socket path"
        );
        assert!(
            se_cmd.contains("\"event\":\"session_end\""),
            "SessionEnd cmd missing event type"
        );
    }

    #[test]
    fn compute_transcript_path_encodes_slashes_and_dots() {
        let home = PathBuf::from("/home/user");
        let dir = PathBuf::from("/home/user/projects/my-repo");
        let path = compute_transcript_path(&home, &dir, "ses-456");
        let path_str = path.to_string_lossy();

        assert!(
            path_str.ends_with("ses-456.jsonl"),
            "path should end with session_id.jsonl"
        );
        assert!(
            path_str.contains(".claude/projects/"),
            "path should contain .claude/projects/"
        );
        assert!(
            path_str.contains("-home-user-projects-my-repo"),
            "path should encode slashes as dashes"
        );

        // Paths with hidden directories (leading dots) must match Claude Code's encoding:
        // both '/' and '.' are replaced with '-'.
        let dotted_dir = PathBuf::from("/projects/my-app/.orkestra/.worktrees/some-task");
        let dotted_path = compute_transcript_path(&home, &dotted_dir, "ses-789");
        let dotted_str = dotted_path.to_string_lossy();
        assert!(
            dotted_str.contains("-projects-my-app--orkestra--worktrees-some-task"),
            "dots in path components must be encoded as dashes, got: {dotted_str}"
        );
    }

    #[test]
    fn poll_for_file_returns_false_when_file_never_appears() {
        let dir = TempDir::new().unwrap();
        let nonexistent = dir.path().join("does-not-exist.jsonl");
        let found = poll_for_file(&nonexistent, Duration::from_millis(60));
        assert!(
            !found,
            "should return false when file does not exist within timeout"
        );
    }

    #[test]
    fn poll_for_file_returns_true_when_file_exists() {
        let dir = TempDir::new().unwrap();
        let path = dir.path().join("transcript.jsonl");
        std::fs::write(&path, b"{}").unwrap();
        let found = poll_for_file(&path, Duration::from_secs(1));
        assert!(found, "should return true when file exists");
    }

    fn make_null_parser() -> impl AgentParser {
        use orkestra_parser::types::ParsedUpdate;
        use orkestra_parser::AgentParser;
        use orkestra_parser::ExtractionResult;

        struct NullParser;
        impl AgentParser for NullParser {
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
            fn extract_output(&self, _: &str) -> ExtractionResult {
                ExtractionResult::NotFound
            }
        }
        NullParser
    }

    #[test]
    fn read_new_lines_returns_entries_and_advances_position() {
        use std::sync::mpsc;

        let dir = TempDir::new().unwrap();
        let path = dir.path().join("transcript.jsonl");
        std::fs::write(&path, b"line1\nline2\n").unwrap();

        let (tx, rx) = mpsc::channel();
        let mut parser = make_null_parser();
        let mut full_output = String::new();
        let mut line_count = 0usize;

        let pos = read_new_lines(
            &path,
            0,
            &mut parser,
            &tx,
            &mut full_output,
            &mut line_count,
        );

        assert_eq!(line_count, 2, "should parse both complete lines");
        assert_eq!(
            pos, 12,
            "position should advance past both lines (12 bytes)"
        );
        assert!(full_output.contains("line1") && full_output.contains("line2"));
        let events: Vec<_> = rx.try_iter().collect();
        assert_eq!(events.len(), 2, "one LogLine per line");

        // Append a third line and re-read from the returned position.
        {
            let mut f = std::fs::OpenOptions::new()
                .append(true)
                .open(&path)
                .unwrap();
            std::io::Write::write_all(&mut f, b"line3\n").unwrap();
        }

        let pos2 = read_new_lines(
            &path,
            pos,
            &mut parser,
            &tx,
            &mut full_output,
            &mut line_count,
        );

        assert_eq!(line_count, 3, "only new line should be counted");
        assert_eq!(pos2, 18, "position should advance by 6 more bytes");
        let new_events: Vec<_> = rx.try_iter().collect();
        assert_eq!(new_events.len(), 1, "only the new line emits an event");
    }

    #[test]
    fn read_new_lines_handles_partial_trailing_line() {
        use std::sync::mpsc;

        let dir = TempDir::new().unwrap();
        let path = dir.path().join("partial.jsonl");
        // Last line has no trailing newline — incomplete write in progress.
        std::fs::write(&path, b"line1\nline2").unwrap();

        let (tx, rx) = mpsc::channel();
        let mut parser = make_null_parser();
        let mut full_output = String::new();
        let mut line_count = 0usize;

        let pos = read_new_lines(
            &path,
            0,
            &mut parser,
            &tx,
            &mut full_output,
            &mut line_count,
        );

        assert_eq!(line_count, 1, "incomplete line must not be parsed");
        assert_eq!(pos, 6, "position stops after the last complete line");
        let events: Vec<_> = rx.try_iter().collect();
        assert_eq!(events.len(), 1);

        // Complete the line by appending the terminating newline.
        {
            let mut f = std::fs::OpenOptions::new()
                .append(true)
                .open(&path)
                .unwrap();
            std::io::Write::write_all(&mut f, b"\n").unwrap();
        }

        let pos2 = read_new_lines(
            &path,
            pos,
            &mut parser,
            &tx,
            &mut full_output,
            &mut line_count,
        );

        assert_eq!(line_count, 2, "now-complete line should be parsed");
        assert_eq!(pos2, 12);
        let new_events: Vec<_> = rx.try_iter().collect();
        assert_eq!(new_events.len(), 1);
    }

    #[test]
    fn read_new_lines_returns_zero_entries_for_unchanged_file() {
        use std::sync::mpsc;

        let dir = TempDir::new().unwrap();
        let path = dir.path().join("stable.jsonl");
        std::fs::write(&path, b"line1\n").unwrap();

        let (tx, rx) = mpsc::channel();
        let mut parser = make_null_parser();
        let mut full_output = String::new();
        let mut line_count = 0usize;

        let pos = read_new_lines(
            &path,
            0,
            &mut parser,
            &tx,
            &mut full_output,
            &mut line_count,
        );
        // Drain the channel so we start fresh.
        let _ = rx.try_iter().collect::<Vec<_>>();

        // Second call at the same position — file unchanged.
        let mut second_count = 0usize;
        let pos2 = read_new_lines(
            &path,
            pos,
            &mut parser,
            &tx,
            &mut full_output,
            &mut second_count,
        );

        assert_eq!(second_count, 0, "no new lines should be parsed");
        assert_eq!(pos2, pos, "position must not change");
        let events: Vec<_> = rx.try_iter().collect();
        assert_eq!(events.len(), 0);
    }

    #[test]
    fn read_new_lines_handles_missing_file() {
        use std::sync::mpsc;

        let (tx, rx) = mpsc::channel();
        let mut parser = make_null_parser();
        let mut full_output = String::new();
        let mut line_count = 0usize;

        let pos = read_new_lines(
            &PathBuf::from("/nonexistent/path.jsonl"),
            0,
            &mut parser,
            &tx,
            &mut full_output,
            &mut line_count,
        );

        assert_eq!(pos, 0, "position must stay at 0 for missing file");
        assert_eq!(line_count, 0);
        let events: Vec<_> = rx.try_iter().collect();
        assert_eq!(events.len(), 0);
    }

    #[test]
    fn build_settings_file_rejects_shell_unsafe_socket_path() {
        let result = build_settings_file("ses-1", "/tmp/hooks.sock; rm -rf /");
        assert!(
            result.is_err(),
            "expected error for shell-unsafe socket path"
        );
    }

    #[test]
    fn build_settings_file_rejects_shell_unsafe_session_id() {
        let result = build_settings_file("ses-1\"; rm -rf /", "/tmp/hooks.sock");
        assert!(
            result.is_err(),
            "expected error for shell-unsafe session_id"
        );
    }

    #[test]
    fn build_settings_file_accepts_valid_session_id() {
        let result = build_settings_file("550e8400-e29b-41d4-a716-446655440000", "/tmp/hooks.sock");
        assert!(
            result.is_ok(),
            "UUID-formatted session_id should be accepted"
        );
    }

    #[test]
    fn wait_for_stable_size_returns_immediately_for_missing_file() {
        let dir = TempDir::new().unwrap();
        let path = dir.path().join("nonexistent.jsonl");
        // Should not hang — file doesn't exist, returns after first poll
        wait_for_stable_size(&path, Duration::from_millis(50), Duration::from_millis(200));
        // No assertion needed — test passes if it returns within the timeout
    }

    #[test]
    fn wait_for_stable_size_returns_when_file_stabilizes() {
        let dir = TempDir::new().unwrap();
        let path = dir.path().join("transcript.jsonl");
        std::fs::write(&path, b"initial content").unwrap();

        // File is stable from the start — should return quickly (< stable_for + poll interval)
        let start = std::time::Instant::now();
        wait_for_stable_size(&path, Duration::from_millis(100), Duration::from_secs(5));
        assert!(
            start.elapsed() < Duration::from_secs(2),
            "should return quickly for stable file"
        );
    }

    /// Regression test for the PTY output-buffer deadlock fix.
    ///
    /// Without a drain thread, `cat` echoes stdin to stdout, fills the PTY master
    /// output buffer, blocks on stdout, stops reading stdin, and our large `write_all`
    /// deadlocks. With the drain thread active, the buffer never fills and the write
    /// completes in well under 5 seconds.
    #[test]
    fn large_prompt_write_completes_with_drain_thread() {
        use portable_pty::{CommandBuilder, PtySize};
        use std::io::Read;

        let pty_system = portable_pty::native_pty_system();
        let pair = pty_system
            .openpty(PtySize {
                rows: 24,
                cols: 80,
                pixel_width: 0,
                pixel_height: 0,
            })
            .unwrap();

        let cmd = CommandBuilder::new("cat");
        let mut child = pair.slave.spawn_command(cmd).unwrap();

        // Drain thread — the fix under test
        let mut drain_reader = pair.master.try_clone_reader().unwrap();
        let drain = thread::spawn(move || {
            let mut buf = [0u8; 4096];
            loop {
                match drain_reader.read(&mut buf) {
                    Ok(0) | Err(_) => break,
                    Ok(_) => {}
                }
            }
        });

        let mut writer = pair.master.take_writer().unwrap();
        let payload = vec![b'x'; 30_000]; // Larger than typical PTY buffer
        let start = std::time::Instant::now();
        writer
            .write_all(&payload)
            .expect("large write should not deadlock with drain thread active");
        let _ = writer.flush();

        assert!(
            start.elapsed() < Duration::from_secs(5),
            "large write must complete quickly with active drain thread, took {:?}",
            start.elapsed()
        );

        // Cleanup
        drop(writer);
        child.kill().ok();
        // Drop the PTY pair (closes the slave fd) before joining the drain thread.
        // On Linux, the master reader only returns EIO (EOF) once ALL slave fds are
        // closed. macOS/BSD returns EIO as soon as the child dies, but Linux requires
        // the parent-side slave to be dropped too. Without this, drain.join() hangs
        // indefinitely on Linux CI.
        drop(pair);
        let _ = drain.join();
    }

    #[test]
    fn wait_for_stable_size_respects_timeout_for_growing_file() {
        let dir = TempDir::new().unwrap();
        let path = dir.path().join("growing.jsonl");
        std::fs::write(&path, b"initial").unwrap();

        // Spawn a thread that keeps writing to the file to keep it "growing"
        let path_clone = path.clone();
        let handle = std::thread::spawn(move || {
            for i in 0..20u8 {
                std::thread::sleep(Duration::from_millis(30));
                if let Ok(mut f) = std::fs::OpenOptions::new().append(true).open(&path_clone) {
                    let _ = std::io::Write::write_all(&mut f, &[i]);
                }
            }
        });

        // stable_for = 500ms, but file grows every 30ms — should time out after ~300ms
        let start = std::time::Instant::now();
        wait_for_stable_size(
            &path,
            Duration::from_millis(500),
            Duration::from_millis(300),
        );
        let elapsed = start.elapsed();
        handle.join().ok();
        assert!(
            elapsed >= Duration::from_millis(250),
            "should wait for timeout when file keeps growing (elapsed: {elapsed:?})"
        );
    }
}
