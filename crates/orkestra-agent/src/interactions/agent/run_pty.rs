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

use crate::interactions::hooks::types::{HookEvent, HookEventType, HookReceiver, HookServer};
use crate::orkestra_debug;
use crate::registry::{ProviderRegistry, ResolvedProvider};
use crate::types::{AgentCompletionError, RunConfig, RunError, RunEvent};

use super::classify_output::{self, OutputClassification};

// ============================================================================
// PTY Handle
// ============================================================================

/// Owns the PTY process lifecycle. `ProcessGuard` fires SIGTERM on drop.
///
/// `child` is polled via `try_wait()` to detect crashes; it also keeps the PTY
/// slave open. `guard` is disarmed after the process is confirmed done (both
/// clean completion and detected crash), then dropped.
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
            is_resume,
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
    is_resume: bool,
}

/// Compute the fallback transcript path + baseline size, then wait for PTY readiness.
///
/// Returns `(baseline, readiness_outcome)`.
fn compute_transcript_baseline_and_wait(
    hook_rx: &HookReceiver,
    writer: &mut Box<dyn Write + Send>,
    ctx: PtySessionParams<'_>,
) -> (TranscriptBaseline, ReadinessOutcome) {
    // baseline_size is the initial file position for tail_transcript_until_stop so
    // prior-run content is not re-parsed as new output.
    let fallback_transcript_path =
        compute_transcript_path(ctx.home_dir, ctx.working_dir, ctx.session_id);
    let baseline_size = if ctx.is_resume {
        std::fs::metadata(&fallback_transcript_path).map_or(0, |m| m.len())
    } else {
        0
    };
    let baseline_size_usize =
        usize::try_from(baseline_size).expect("transcript size exceeds platform address space");
    // Wait for readiness via dual-signal: UserPromptSubmit hook OR transcript growth.
    // Re-send Enter every ~3s to handle TUI startup races; escalates on resume after 3 retries.
    let readiness_deadline = std::time::Instant::now() + Duration::from_secs(30);
    let readiness_outcome = wait_for_readiness(
        hook_rx,
        writer,
        readiness_deadline,
        &fallback_transcript_path,
        baseline_size,
        ctx.prompt.as_bytes(),
        ctx.is_resume,
    );
    (
        TranscriptBaseline {
            path: fallback_transcript_path,
            size: baseline_size_usize,
        },
        readiness_outcome,
    )
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

    let (baseline, readiness_outcome) =
        compute_transcript_baseline_and_wait(hook_rx, &mut pty_handle.writer, ctx);

    match readiness_outcome {
        ReadinessOutcome::Ready => {
            run_tail_and_finalize(
                pty_handle,
                hook_rx,
                hook_server,
                tx,
                &mut *parser,
                &ctx,
                &baseline,
            );
        }
        ReadinessOutcome::EarlyCompletion(event) => {
            // Stop/SessionEnd arrived before the prompt was confirmed — skip tail entirely.
            finalize_pty_session(
                FinalizePtyParams {
                    pty_handle,
                    hook_server,
                    tx,
                    parser: &mut *parser,
                    task_id: ctx.task_id,
                    schema: ctx.schema,
                    fallback_transcript_path: &baseline.path,
                    sidechains: HashMap::new(),
                },
                Some(&event),
                String::new(),
                baseline.size,
            );
        }
        ReadinessOutcome::Timeout => {
            handle_transcript_not_found(pty_handle, hook_server, tx, ctx.task_id);
        }
        ReadinessOutcome::WriteFailed(e) => {
            // PTY process died — fail fast instead of waiting for the deadline.
            let _ = tx.send(RunEvent::Completed(Err(AgentCompletionError::Crash(
                format!("PTY process died during startup — failed to write Enter: {e}"),
            ))));
            drop(pty_handle);
            hook_server.unregister_task(ctx.task_id);
        }
    }
}

/// Emit synthetic activity events, tail the transcript until Stop fires, then finalize.
///
/// Called from `drive_pty_session` once the session is confirmed ready. Extracted to
/// keep `drive_pty_session` under the 100-line clippy threshold.
fn run_tail_and_finalize(
    mut pty_handle: PtyHandle,
    hook_rx: &HookReceiver,
    hook_server: &HookServer,
    tx: &Sender<RunEvent>,
    parser: &mut dyn AgentParser,
    ctx: &PtySessionParams<'_>,
    baseline: &TranscriptBaseline,
) {
    // Two Text events needed for `has_confirmed_output` crash-recovery tracking.
    let _ = tx.send(RunEvent::LogLine(LogEntry::Text {
        content: "PTY session active".to_string(),
    }));
    let _ = tx.send(RunEvent::LogLine(LogEntry::Text {
        content: "PTY session confirmed".to_string(),
    }));

    // Tail transcript until Stop hook fires; polls every 150ms, checks liveness every ~3s.
    let (hook_event, full_output, tail_file_pos, sidechains) = tail_transcript_until_stop(
        &baseline.path,
        hook_rx,
        &mut pty_handle.child,
        parser,
        tx,
        baseline.size,
    );

    finalize_pty_session(
        FinalizePtyParams {
            pty_handle,
            hook_server,
            tx,
            parser,
            task_id: ctx.task_id,
            schema: ctx.schema,
            fallback_transcript_path: &baseline.path,
            sidechains,
        },
        hook_event.as_ref(),
        full_output,
        tail_file_pos,
    );
}

struct TranscriptBaseline {
    path: PathBuf,
    size: usize,
}

/// Tracks the state of a discovered Claude Code subagent sidechain transcript file.
struct SidechainState {
    parent_tool_use_id: String,
    file_path: PathBuf,
    file_pos: usize,
}

struct FinalizePtyParams<'a> {
    pty_handle: PtyHandle,
    hook_server: &'a HookServer,
    tx: &'a Sender<RunEvent>,
    parser: &'a mut dyn AgentParser,
    task_id: &'a str,
    schema: Option<&'a serde_json::Value>,
    fallback_transcript_path: &'a Path,
    sidechains: HashMap<PathBuf, SidechainState>,
}

/// Resolve the transcript path, perform the final stabilized read, clean up the PTY
/// process, flush the parser, classify output, and emit the completion event.
///
/// Also performs a final read of all sidechain transcript files, re-discovering if the
/// transcript path diverged from the fallback.
fn finalize_pty_session(
    params: FinalizePtyParams<'_>,
    hook_event: Option<&HookEvent>,
    mut full_output: String,
    tail_file_pos: usize,
) {
    let FinalizePtyParams {
        pty_handle,
        hook_server,
        tx,
        parser,
        task_id,
        schema,
        fallback_transcript_path,
        mut sidechains,
    } = params;

    // Use transcript path from hook event if available, else computed fallback.
    // In practice these match — the divergence path is a safety net.
    let transcript_path = hook_event
        .and_then(|e| e.transcript_path.clone())
        .unwrap_or_else(|| fallback_transcript_path.to_path_buf());

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
        parser,
        tx,
        &mut full_output,
        &mut trailing_count,
    );

    // Final sidechain reads. Re-derive the sidechain dir from the final transcript path so
    // newly-appeared agent directories are caught when the path diverged from the fallback.
    let sidechain_dir = derive_sidechain_dir(&transcript_path);
    if transcript_path != fallback_transcript_path {
        let new = discover_new_sidechains(&sidechain_dir, &sidechains);
        for (k, s) in new {
            sidechains.insert(k, s);
        }
    }
    // Brief wait for sidechain files to flush alongside the main transcript.
    thread::sleep(Duration::from_millis(50));
    for state in sidechains.values_mut() {
        let path = state.file_path.clone();
        let id = state.parent_tool_use_id.clone();
        state.file_pos = read_sidechain_lines(&path, state.file_pos, &id, parser, tx);
    }

    // Process is confirmed done — disarm so Drop sends SIGTERM only (no SIGKILL escalation)
    pty_handle.guard.disarm();
    drop(pty_handle);

    // Cleanup
    hook_server.unregister_task(task_id);

    // Flush finalized parser entries
    for entry in parser.finalize() {
        if tx.send(RunEvent::LogLine(entry)).is_err() {
            return;
        }
    }

    // Classify output and emit completion
    let result = match classify_output::execute(&*parser, &full_output, schema) {
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

/// Outcome of the readiness wait in `drive_pty_session`.
enum ReadinessOutcome {
    /// Prompt accepted — proceed to tail the transcript.
    Ready,
    /// Stop or `SessionEnd` arrived before readiness — skip tail, finalize immediately.
    EarlyCompletion(HookEvent),
    /// Deadline elapsed with no readiness signal.
    Timeout,
    /// PTY writer returned an error (process died).
    WriteFailed(String),
}

/// Returns `true` when the retry write should escalate to Ctrl-U + full prompt re-delivery.
///
/// Only applies on resume sessions after the 3rd bare-`\r` retry, once the TUI
/// replay is expected to have finished and further bare enters won't help.
fn should_escalate(is_resume: bool, retry_count: u32) -> bool {
    is_resume && retry_count > 3
}

/// Wait for the PTY session to accept the prompt using dual-signal detection.
///
/// Returns `Ready` when either the `UserPromptSubmit` hook fires OR the transcript
/// grows past `baseline_size` (fallback for environments where hooks fire late or
/// not at all). Returns `EarlyCompletion` if a `Stop`/`SessionEnd` event arrives
/// before readiness, `Timeout` if the deadline elapses, or `WriteFailed` if the
/// PTY writer fails (process died).
///
/// Retry cadence (every ~3s / 6 iterations):
/// - Fresh sessions (`!is_resume`): bare `\r` — no-op on idle composer, submits otherwise.
/// - Resume sessions, first 3 retries: bare `\r` while the TUI replays the transcript.
/// - Resume sessions, subsequent retries: `\x15` (Ctrl-U) + full prompt + `\r` to
///   re-deliver the prompt after the TUI finishes replaying and may have discarded the
///   initial write.
fn wait_for_readiness(
    hook_rx: &HookReceiver,
    writer: &mut Box<dyn Write + Send>,
    deadline: std::time::Instant,
    transcript_path: &Path,
    baseline_size: u64,
    prompt: &[u8],
    is_resume: bool,
) -> ReadinessOutcome {
    use std::sync::mpsc::TryRecvError;

    let mut polls_since_retry = 0u32;
    let mut retry_count = 0u32;

    loop {
        // Hook check — UserPromptSubmit signals prompt accepted; Stop/SessionEnd mean
        // the session completed before readiness was confirmed.
        match hook_rx.try_recv() {
            Ok(event) => match event.event_type {
                HookEventType::UserPromptSubmit => return ReadinessOutcome::Ready,
                HookEventType::Stop | HookEventType::SessionEnd => {
                    return ReadinessOutcome::EarlyCompletion(event);
                }
            },
            Err(TryRecvError::Empty) => {}
            Err(TryRecvError::Disconnected) => return ReadinessOutcome::Timeout,
        }

        // Transcript growth fallback — catches environments where hooks are unavailable.
        // Skipped on resume: bookkeeping bytes grow the transcript before any real turn,
        // causing a false-positive Ready before the prompt is actually read.
        if !is_resume {
            let current_size = std::fs::metadata(transcript_path).map_or(0, |m| m.len());
            if current_size > baseline_size {
                return ReadinessOutcome::Ready;
            }
        }

        if std::time::Instant::now() >= deadline {
            return ReadinessOutcome::Timeout;
        }

        polls_since_retry += 1;
        if polls_since_retry >= 6 {
            polls_since_retry = 0;
            retry_count += 1;

            let write_result = if should_escalate(is_resume, retry_count) {
                // Escalate: clear the composer line then re-deliver the full prompt.
                writer
                    .write_all(b"\x15")
                    .and_then(|()| writer.write_all(prompt))
                    .and_then(|()| writer.write_all(b"\r"))
                    .and_then(|()| writer.flush())
            } else {
                writer.write_all(b"\r").and_then(|()| writer.flush())
            };

            if let Err(e) = write_result {
                return ReadinessOutcome::WriteFailed(e.to_string());
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
/// fires when the process terminates. `UserPromptSubmit` fires when the TUI
/// accepts the prompt, signaling readiness. All commands use `$ORK_TASK_ID`
/// (set in the PTY environment) for server-side routing.
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
    let user_prompt_submit_cmd = format!(
        "echo '{{\"event\":\"user_prompt_submit\",\"task_id\":\"'\"$ORK_TASK_ID\"'\",\"session_id\":\"{session_id}\"}}' | nc -U {socket_path}"
    );

    let settings = serde_json::json!({
        "hooks": {
            "Stop": [{"matcher": "", "hooks": [{"type": "command", "command": stop_cmd}]}],
            "SessionEnd": [{"matcher": "", "hooks": [{"type": "command", "command": session_end_cmd}]}],
            "UserPromptSubmit": [{"matcher": "", "hooks": [{"type": "command", "command": user_prompt_submit_cmd}]}]
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

    // Find the last newline in raw bytes. 0x0A cannot appear as a UTF-8 continuation
    // byte, so this is always a correct line boundary regardless of encoding.
    let complete_end = match raw.iter().rposition(|&b| b == b'\n') {
        Some(pos) => pos + 1,
        None => return file_pos,
    };

    // Convert only the complete portion so that `complete_end` remains a valid raw
    // byte offset — lossy replacement expands invalid bytes (1 byte → 3 bytes) which
    // would make the returned file position overshoot the actual file position.
    let buf = String::from_utf8_lossy(&raw[..complete_end]);

    for line in buf.lines() {
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
/// Returns `(hook_event, full_output, file_pos, sidechains)`. `full_output` contains all
/// main-agent content parsed so far; `file_pos` is the byte offset for the subsequent final
/// read. `sidechains` is the accumulated sidechain state for the finalization step.
///
/// `initial_file_pos` seeds the starting byte offset — pass the pre-existing file size
/// on resume so prior-run lines are not re-parsed as new output.
///
/// `child` is polled every ~3s (20 × 150ms) to detect PTY process exits without
/// a Stop hook (crashes / silent exits).
fn tail_transcript_until_stop(
    transcript_path: &Path,
    hook_rx: &HookReceiver,
    child: &mut Box<dyn portable_pty::Child + Send + Sync>,
    parser: &mut dyn AgentParser,
    tx: &Sender<RunEvent>,
    initial_file_pos: usize,
) -> (
    Option<crate::interactions::hooks::types::HookEvent>,
    String,
    usize,
    HashMap<PathBuf, SidechainState>,
) {
    use std::sync::mpsc::TryRecvError;

    let sidechain_dir = derive_sidechain_dir(transcript_path);
    let mut sidechains: HashMap<PathBuf, SidechainState> = HashMap::new();
    let mut file_pos = initial_file_pos;
    let mut full_output = String::new();
    let mut line_count = 0usize;
    let mut polls_since_crash_check = 0u32;

    loop {
        match hook_rx.try_recv() {
            Ok(event) => match event.event_type {
                HookEventType::Stop | HookEventType::SessionEnd => {
                    orkestra_debug!(
                        "runner",
                        "run_pty: got hook event {:?} for session {}",
                        event.event_type,
                        event.session_id
                    );
                    return (Some(event), full_output, file_pos, sidechains);
                }
                HookEventType::UserPromptSubmit => {
                    // Stale or duplicate readiness signal — ignore and keep tailing.
                }
            },
            Err(TryRecvError::Empty) => {
                file_pos = read_new_lines(
                    transcript_path,
                    file_pos,
                    parser,
                    tx,
                    &mut full_output,
                    &mut line_count,
                );
                update_sidechains(&sidechain_dir, &mut sidechains, parser, tx);
                polls_since_crash_check += 1;
                if polls_since_crash_check >= 20 {
                    polls_since_crash_check = 0;
                    match child.try_wait() {
                        Ok(Some(exit_status)) => {
                            orkestra_debug!(
                                "runner",
                                "run_pty: PTY process exited with {:?} without firing Stop hook",
                                exit_status
                            );
                            return (None, full_output, file_pos, sidechains);
                        }
                        Ok(None) => {}
                        Err(e) => {
                            orkestra_debug!(
                                "runner",
                                "run_pty: try_wait failed: {e:?}, assuming process dead"
                            );
                            return (None, full_output, file_pos, sidechains);
                        }
                    }
                }
                thread::sleep(Duration::from_millis(150));
            }
            Err(TryRecvError::Disconnected) => {
                orkestra_debug!("runner", "run_pty: hook receiver disconnected");
                return (None, full_output, file_pos, sidechains);
            }
        }
    }
}

/// Derive the sidechain directory from a transcript path.
///
/// For a path like `~/.claude/projects/<cwd>/abc123.jsonl`, returns
/// `~/.claude/projects/<cwd>/abc123/subagents/`.
fn derive_sidechain_dir(transcript_path: &Path) -> PathBuf {
    transcript_path.with_extension("").join("subagents")
}

/// Scan `sidechain_dir` for new `agent-*` subdirectories not yet in `known`.
///
/// For each new directory, reads `meta.json` to extract `toolUseId` and finds the
/// `.jsonl` file. Silently skips directories that are missing either file.
fn discover_new_sidechains(
    sidechain_dir: &Path,
    known: &HashMap<PathBuf, SidechainState>,
) -> Vec<(PathBuf, SidechainState)> {
    let Ok(entries) = std::fs::read_dir(sidechain_dir) else {
        return vec![];
    };
    let mut result = Vec::new();
    for entry in entries.flatten() {
        let path = entry.path();
        if !path.is_dir() {
            continue;
        }
        let name = path.file_name().and_then(|n| n.to_str()).unwrap_or("");
        if !name.starts_with("agent-") || known.contains_key(&path) {
            continue;
        }
        let Ok(meta_bytes) = std::fs::read(path.join("meta.json")) else {
            continue;
        };
        let Ok(meta) = serde_json::from_slice::<serde_json::Value>(&meta_bytes) else {
            continue;
        };
        let Some(tool_use_id) = meta.get("toolUseId").and_then(|v| v.as_str()) else {
            continue;
        };
        let Ok(sub_entries) = std::fs::read_dir(&path) else {
            continue;
        };
        let Some(jsonl_path) = sub_entries
            .flatten()
            .map(|e| e.path())
            .find(|p| p.extension().is_some_and(|ext| ext == "jsonl"))
        else {
            continue;
        };
        orkestra_debug!(
            "runner",
            "run_pty: discovered sidechain {} parent_tool_use_id={}",
            path.display(),
            tool_use_id
        );
        result.push((
            path,
            SidechainState {
                parent_tool_use_id: tool_use_id.to_string(),
                file_path: jsonl_path,
                file_pos: 0,
            },
        ));
    }
    result
}

/// Inject a `parent_tool_use_id` field into a JSON line.
///
/// Returns the modified JSON string, or the original string if it is not valid JSON.
fn inject_parent_tool_use_id(line: &str, parent_tool_use_id: &str) -> String {
    match serde_json::from_str::<serde_json::Value>(line) {
        Ok(mut v) => {
            if let Some(obj) = v.as_object_mut() {
                obj.insert(
                    "parent_tool_use_id".to_string(),
                    serde_json::Value::String(parent_tool_use_id.to_string()),
                );
            }
            v.to_string()
        }
        Err(_) => line.to_string(),
    }
}

/// Read new complete lines from a sidechain transcript, injecting `parent_tool_use_id`
/// before parsing, and emit `LogLine` events. Does not append to `full_output`.
fn read_sidechain_lines(
    path: &Path,
    file_pos: usize,
    parent_tool_use_id: &str,
    parser: &mut dyn AgentParser,
    tx: &Sender<RunEvent>,
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
    let complete_end = match raw.iter().rposition(|&b| b == b'\n') {
        Some(pos) => pos + 1,
        None => return file_pos,
    };
    let buf = String::from_utf8_lossy(&raw[..complete_end]);
    for line in buf.lines() {
        if line.trim().is_empty() {
            continue;
        }
        let injected = inject_parent_tool_use_id(line, parent_tool_use_id);
        let update = parser.parse_line(&injected);
        if let Some(sid) = update.session_id {
            let _ = tx.send(RunEvent::SessionId(sid));
        }
        for entry in update.log_entries {
            if tx.send(RunEvent::LogLine(entry)).is_err() {
                return file_pos + complete_end;
            }
        }
    }
    file_pos + complete_end
}

/// Discover new sidechains and read pending lines from all tracked sidechains.
fn update_sidechains(
    sidechain_dir: &Path,
    sidechains: &mut HashMap<PathBuf, SidechainState>,
    parser: &mut dyn AgentParser,
    tx: &Sender<RunEvent>,
) {
    let new = discover_new_sidechains(sidechain_dir, sidechains);
    for (k, s) in new {
        sidechains.insert(k, s);
    }
    for state in sidechains.values_mut() {
        let path = state.file_path.clone();
        let id = state.parent_tool_use_id.clone();
        state.file_pos = read_sidechain_lines(&path, state.file_pos, &id, parser, tx);
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
    fn settings_file_contains_all_hooks() {
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

        let ups_hooks = &parsed["hooks"]["UserPromptSubmit"];
        assert!(
            ups_hooks.is_array(),
            "UserPromptSubmit hooks should be an array"
        );
        assert_eq!(
            parsed["hooks"]["UserPromptSubmit"][0]["hooks"][0]["type"].as_str(),
            Some("command"),
            "UserPromptSubmit hook must use nested hooks array with type=command"
        );
        let ups_cmd = parsed["hooks"]["UserPromptSubmit"][0]["hooks"][0]["command"]
            .as_str()
            .unwrap();
        assert!(
            ups_cmd.contains("nc -U /tmp/hooks.sock"),
            "UserPromptSubmit cmd missing socket path"
        );
        assert!(
            ups_cmd.contains("\"event\":\"user_prompt_submit\""),
            "UserPromptSubmit cmd missing event type"
        );
        assert!(
            ups_cmd.contains("ses-123"),
            "UserPromptSubmit cmd missing session_id"
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
                    token_usage: None,
                    cost: None,
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
    fn read_new_lines_handles_invalid_utf8() {
        use std::sync::mpsc;

        let dir = TempDir::new().unwrap();
        let path = dir.path().join("invalid_utf8.jsonl");

        // Write: valid line, line with invalid bytes, valid line.
        let mut content = b"good\n".to_vec();
        content.extend_from_slice(b"\xff\xfebad\n");
        content.extend_from_slice(b"after\n");
        std::fs::write(&path, &content).unwrap();

        let (tx, _rx) = mpsc::channel();
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

        // Position must track raw bytes (5 + 6 + 6 = 17), not the lossy-expanded length.
        // \xff and \xfe each expand to the 3-byte U+FFFD sequence in from_utf8_lossy,
        // so the lossy byte length is 5 + 10 + 6 = 21 — but file_pos must stay at 17.
        assert_eq!(
            pos, 17,
            "position must track raw bytes, not lossy-expanded bytes"
        );
        assert_eq!(line_count, 3);
        assert!(
            full_output.contains('\u{FFFD}'),
            "invalid bytes should produce replacement chars"
        );

        // A subsequent call from pos must return 0 new lines (file unchanged).
        let (tx2, _rx2) = mpsc::channel();
        let mut parser2 = make_null_parser();
        let mut full_output2 = String::new();
        let mut line_count2 = 0usize;
        let pos2 = read_new_lines(
            &path,
            pos,
            &mut parser2,
            &tx2,
            &mut full_output2,
            &mut line_count2,
        );
        assert_eq!(pos2, pos, "subsequent call must not advance position");
        assert_eq!(line_count2, 0, "subsequent call must find no new lines");
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
    fn wait_for_readiness_returns_ready_on_transcript_growth() {
        use std::sync::mpsc;

        let dir = TempDir::new().unwrap();
        let path = dir.path().join("transcript.jsonl");

        // Pre-create file with some content — simulates a prior-run transcript.
        std::fs::write(&path, b"old content\n").unwrap();
        let baseline = std::fs::metadata(&path).unwrap().len();

        // Keep sender alive so try_recv returns Empty (not Disconnected → Timeout).
        let (_hook_tx, hook_rx_raw) = mpsc::channel::<HookEvent>();
        let hook_rx = HookReceiver {
            receiver: hook_rx_raw,
        };

        let mut writer: Box<dyn Write + Send> = Box::new(std::io::sink());

        // Append new content before calling wait_for_readiness — transcript growth path fires.
        {
            let mut f = std::fs::OpenOptions::new()
                .append(true)
                .open(&path)
                .unwrap();
            std::io::Write::write_all(&mut f, b"new line\n").unwrap();
        }

        let deadline = std::time::Instant::now() + Duration::from_secs(5);
        let outcome =
            wait_for_readiness(&hook_rx, &mut writer, deadline, &path, baseline, b"", false);
        assert!(
            matches!(outcome, ReadinessOutcome::Ready),
            "should return Ready once transcript grows past baseline"
        );
    }

    #[test]
    fn wait_for_readiness_timeout_when_no_signal() {
        use std::sync::mpsc;

        let dir = TempDir::new().unwrap();
        let path = dir.path().join("no-transcript.jsonl");
        // File does not exist — no transcript growth, no hook.

        let (_hook_tx, hook_rx_raw) = mpsc::channel::<HookEvent>();
        let hook_rx = HookReceiver {
            receiver: hook_rx_raw,
        };

        let mut writer: Box<dyn Write + Send> = Box::new(std::io::sink());
        // Very short deadline.
        let deadline = std::time::Instant::now() + Duration::from_millis(600);
        let outcome = wait_for_readiness(&hook_rx, &mut writer, deadline, &path, 0, b"", false);
        assert!(
            matches!(outcome, ReadinessOutcome::Timeout),
            "should timeout when neither hook nor transcript growth arrives"
        );
    }

    #[test]
    fn wait_for_readiness_returns_ready_on_user_prompt_submit_hook() {
        use std::sync::mpsc;

        let dir = TempDir::new().unwrap();
        let path = dir.path().join("no-transcript.jsonl");
        // No file — only the hook will signal readiness.

        let (hook_tx, hook_rx_raw) = mpsc::channel::<HookEvent>();
        let hook_rx = HookReceiver {
            receiver: hook_rx_raw,
        };

        let mut writer: Box<dyn Write + Send> = Box::new(std::io::sink());
        let deadline = std::time::Instant::now() + Duration::from_secs(5);

        // Send UserPromptSubmit after a short delay.
        thread::spawn(move || {
            thread::sleep(Duration::from_millis(100));
            let _ = hook_tx.send(HookEvent {
                event_type: HookEventType::UserPromptSubmit,
                task_id: "task-1".to_string(),
                session_id: "ses-1".to_string(),
                transcript_path: None,
                reason: None,
            });
        });

        let outcome =
            wait_for_readiness(&hook_rx, &mut writer, deadline, &path, 0, b"prompt", false);
        assert!(
            matches!(outcome, ReadinessOutcome::Ready),
            "should return Ready when UserPromptSubmit hook fires"
        );
    }

    #[test]
    fn wait_for_readiness_returns_early_completion_on_stop_hook() {
        use std::sync::mpsc;

        let dir = TempDir::new().unwrap();
        let path = dir.path().join("no-transcript.jsonl");

        let (hook_tx, hook_rx_raw) = mpsc::channel::<HookEvent>();
        let hook_rx = HookReceiver {
            receiver: hook_rx_raw,
        };

        // Send Stop event before calling wait_for_readiness.
        hook_tx
            .send(HookEvent {
                event_type: HookEventType::Stop,
                task_id: "task-1".to_string(),
                session_id: "ses-1".to_string(),
                transcript_path: None,
                reason: None,
            })
            .unwrap();

        let mut writer: Box<dyn Write + Send> = Box::new(std::io::sink());
        let deadline = std::time::Instant::now() + Duration::from_secs(5);
        let outcome = wait_for_readiness(&hook_rx, &mut writer, deadline, &path, 0, b"", false);
        assert!(
            matches!(outcome, ReadinessOutcome::EarlyCompletion(_)),
            "should return EarlyCompletion when Stop hook fires before readiness"
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

    #[test]
    fn should_escalate_only_on_resume_after_3_retries() {
        assert!(!should_escalate(false, 0), "fresh session never escalates");
        assert!(
            !should_escalate(false, 100),
            "fresh session never escalates at high count"
        );
        assert!(
            !should_escalate(true, 0),
            "resume: 0 retries — no escalation"
        );
        assert!(
            !should_escalate(true, 3),
            "resume: 3 retries — still bare \\r"
        );
        assert!(
            should_escalate(true, 4),
            "resume: 4th retry escalates to Ctrl-U + prompt"
        );
        assert!(
            should_escalate(true, 100),
            "resume: escalation persists at high count"
        );
    }

    #[test]
    fn wait_for_readiness_ignores_transcript_growth_on_resume() {
        use std::sync::mpsc;

        let dir = TempDir::new().unwrap();
        let path = dir.path().join("transcript.jsonl");

        // Write content above baseline — simulates TUI bookkeeping bytes on resume.
        std::fs::write(&path, b"bookkeeping\n").unwrap();
        let baseline = 0u64;

        // Keep sender alive so try_recv returns Empty, not Disconnected.
        let (_hook_tx, hook_rx_raw) = mpsc::channel::<HookEvent>();
        let hook_rx = HookReceiver {
            receiver: hook_rx_raw,
        };
        let mut writer: Box<dyn Write + Send> = Box::new(std::io::sink());

        // If transcript growth were applied, Ready would fire immediately.
        // With the guard in place, is_resume=true skips growth and reaches Timeout.
        let deadline = std::time::Instant::now() + Duration::from_millis(600);
        let outcome =
            wait_for_readiness(&hook_rx, &mut writer, deadline, &path, baseline, b"", true);
        assert!(
            matches!(outcome, ReadinessOutcome::Timeout),
            "resume sessions must not treat transcript growth as a ready signal"
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
    fn test_derive_sidechain_dir() {
        let transcript = PathBuf::from("/home/user/.claude/projects/-home-user-repo/abc123.jsonl");
        let dir = derive_sidechain_dir(&transcript);
        assert_eq!(
            dir,
            PathBuf::from("/home/user/.claude/projects/-home-user-repo/abc123/subagents")
        );
    }

    #[test]
    fn test_inject_parent_tool_use_id() {
        let line = r#"{"type":"tool_use","id":"toolu_01"}"#;
        let result = inject_parent_tool_use_id(line, "toolu_parent");
        let v: serde_json::Value = serde_json::from_str(&result).unwrap();
        assert_eq!(v["parent_tool_use_id"], "toolu_parent");
        assert_eq!(v["type"], "tool_use");
        assert_eq!(v["id"], "toolu_01");
    }

    #[test]
    fn test_inject_parent_tool_use_id_invalid_json() {
        let line = "not json at all";
        let result = inject_parent_tool_use_id(line, "toolu_parent");
        assert_eq!(result, "not json at all");
    }

    #[test]
    fn test_inject_parent_tool_use_id_preserves_existing_fields() {
        let line = r#"{"a":1,"b":"hello","c":true}"#;
        let result = inject_parent_tool_use_id(line, "pid");
        let v: serde_json::Value = serde_json::from_str(&result).unwrap();
        assert_eq!(v["a"], 1);
        assert_eq!(v["b"], "hello");
        assert_eq!(v["c"], true);
        assert_eq!(v["parent_tool_use_id"], "pid");
    }

    #[test]
    fn test_discover_sidechains_with_temp_dir() {
        let dir = TempDir::new().unwrap();
        let sidechain_dir = dir.path().join("subagents");
        std::fs::create_dir_all(&sidechain_dir).unwrap();

        // Create agent-abc directory with meta.json and a .jsonl file
        let agent_dir = sidechain_dir.join("agent-abc");
        std::fs::create_dir_all(&agent_dir).unwrap();
        std::fs::write(
            agent_dir.join("meta.json"),
            r#"{"toolUseId":"toolu_01abc"}"#,
        )
        .unwrap();
        std::fs::write(agent_dir.join("transcript.jsonl"), b"").unwrap();

        // Create a non-agent directory — should be ignored
        let other_dir = sidechain_dir.join("not-an-agent");
        std::fs::create_dir_all(&other_dir).unwrap();
        std::fs::write(other_dir.join("meta.json"), r#"{"toolUseId":"ignored"}"#).unwrap();

        let known: HashMap<PathBuf, SidechainState> = HashMap::new();
        let mut found = discover_new_sidechains(&sidechain_dir, &known);
        assert_eq!(found.len(), 1, "should find exactly one agent- directory");

        let (key, state) = found.remove(0);
        assert_eq!(key, agent_dir);
        assert_eq!(state.parent_tool_use_id, "toolu_01abc");
        assert_eq!(state.file_path, agent_dir.join("transcript.jsonl"));
        assert_eq!(state.file_pos, 0);
    }

    #[test]
    fn test_discover_sidechains_skips_missing_meta() {
        let dir = TempDir::new().unwrap();
        let sidechain_dir = dir.path().join("subagents");
        std::fs::create_dir_all(&sidechain_dir).unwrap();

        // No meta.json — should be skipped
        let agent_dir = sidechain_dir.join("agent-no-meta");
        std::fs::create_dir_all(&agent_dir).unwrap();
        std::fs::write(agent_dir.join("transcript.jsonl"), b"").unwrap();

        let known: HashMap<PathBuf, SidechainState> = HashMap::new();
        let found = discover_new_sidechains(&sidechain_dir, &known);
        assert_eq!(found.len(), 0, "should skip agent dir with no meta.json");
    }

    #[test]
    fn test_discover_sidechains_skips_known() {
        let dir = TempDir::new().unwrap();
        let sidechain_dir = dir.path().join("subagents");
        std::fs::create_dir_all(&sidechain_dir).unwrap();

        let agent_dir = sidechain_dir.join("agent-abc");
        std::fs::create_dir_all(&agent_dir).unwrap();
        std::fs::write(agent_dir.join("meta.json"), r#"{"toolUseId":"toolu_01"}"#).unwrap();
        std::fs::write(agent_dir.join("transcript.jsonl"), b"").unwrap();

        // Pre-populate known with this agent dir
        let mut known: HashMap<PathBuf, SidechainState> = HashMap::new();
        known.insert(
            agent_dir.clone(),
            SidechainState {
                parent_tool_use_id: "toolu_01".to_string(),
                file_path: agent_dir.join("transcript.jsonl"),
                file_pos: 0,
            },
        );

        let found = discover_new_sidechains(&sidechain_dir, &known);
        assert_eq!(
            found.len(),
            0,
            "should not re-discover already-known agents"
        );
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

    // ============================================================================
    // Sidechain integration tests
    // ============================================================================

    /// Set up a temp directory with a main transcript and one sidechain.
    ///
    /// Returns `(main_transcript_path, sidechain_jsonl_path)`.
    ///
    /// Directory layout:
    ///   dir/session123.jsonl              (main transcript)
    ///   dir/session123/subagents/agent-abc/meta.json
    ///   dir/session123/subagents/agent-abc/<uuid>.jsonl
    fn setup_sidechain_fixture(dir: &Path) -> (PathBuf, PathBuf) {
        let main_path = dir.join("session123.jsonl");

        // Main transcript: Agent tool_use followed by user tool_result with agentId
        let agent_tool_use = serde_json::json!({
            "type": "assistant",
            "message": {
                "content": [{
                    "type": "tool_use",
                    "name": "Agent",
                    "id": "tu_agent_1",
                    "input": {"description": "do work"}
                }]
            }
        });
        let agent_tool_result = serde_json::json!({
            "type": "user",
            "toolUseResult": {"agentId": "agent-abc"},
            "message": {
                "content": [{
                    "type": "tool_result",
                    "tool_use_id": "tu_agent_1",
                    "content": "done"
                }]
            }
        });
        let main_content = format!("{agent_tool_use}\n{agent_tool_result}\n");
        std::fs::write(&main_path, main_content.as_bytes()).unwrap();

        // Sidechain directory structure
        let sidechain_base = dir.join("session123").join("subagents").join("agent-abc");
        std::fs::create_dir_all(&sidechain_base).unwrap();

        // meta.json points back to the parent tool_use_id
        std::fs::write(
            sidechain_base.join("meta.json"),
            r#"{"toolUseId": "tu_agent_1", "agentType": "general-purpose", "description": "do work"}"#,
        )
        .unwrap();

        // Sidechain transcript: tool_use (NO parent_tool_use_id — transcript-file format)
        // then tool_result, then another tool_use
        let sub_tool_use = serde_json::json!({
            "type": "assistant",
            "message": {
                "content": [{
                    "type": "tool_use",
                    "name": "Read",
                    "id": "tu_sub_1",
                    "input": {"file_path": "/foo.rs"}
                }]
            }
        });
        let sub_tool_result = serde_json::json!({
            "type": "user",
            "message": {
                "content": [{
                    "type": "tool_result",
                    "tool_use_id": "tu_sub_1",
                    "content": "file contents"
                }]
            }
        });
        let sub_tool_use_2 = serde_json::json!({
            "type": "assistant",
            "message": {
                "content": [{
                    "type": "tool_use",
                    "name": "Edit",
                    "id": "tu_sub_2",
                    "input": {"file_path": "/bar.rs"}
                }]
            }
        });
        let sidechain_content = format!("{sub_tool_use}\n{sub_tool_result}\n{sub_tool_use_2}\n");
        let sidechain_jsonl = sidechain_base.join("transcript.jsonl");
        std::fs::write(&sidechain_jsonl, sidechain_content.as_bytes()).unwrap();

        (main_path, sidechain_jsonl)
    }

    #[test]
    fn sidechain_events_produce_subagent_log_entries() {
        use orkestra_parser::ClaudeParserService;
        use std::sync::mpsc;

        let dir = TempDir::new().unwrap();
        let (main_path, sidechain_jsonl) = setup_sidechain_fixture(dir.path());

        let (tx, rx) = mpsc::channel();
        let mut parser = ClaudeParserService::new();
        let mut full_output = String::new();
        let mut line_count = 0usize;

        // Parse main transcript — establishes agent_tool_ids in the parser
        read_new_lines(
            &main_path,
            0,
            &mut parser,
            &tx,
            &mut full_output,
            &mut line_count,
        );

        // Now read sidechain lines — inject parent_tool_use_id before parsing
        read_sidechain_lines(&sidechain_jsonl, 0, "tu_agent_1", &mut parser, &tx);

        let events: Vec<_> = rx.try_iter().collect();
        let log_entries: Vec<&LogEntry> = events
            .iter()
            .filter_map(|e| {
                if let RunEvent::LogLine(entry) = e {
                    Some(entry)
                } else {
                    None
                }
            })
            .collect();

        // Verify at least one SubagentToolUse with correct parent_task_id
        let subagent_tool_uses: Vec<_> = log_entries
            .iter()
            .filter(|e| matches!(e, LogEntry::SubagentToolUse { .. }))
            .collect();
        assert!(
            !subagent_tool_uses.is_empty(),
            "expected SubagentToolUse entries from sidechain, got none"
        );

        // Check the first SubagentToolUse has correct parent_task_id
        match subagent_tool_uses[0] {
            LogEntry::SubagentToolUse {
                parent_task_id,
                tool,
                ..
            } => {
                assert_eq!(
                    parent_task_id, "tu_agent_1",
                    "parent_task_id must match Agent tool_use_id"
                );
                assert_eq!(tool, "Read", "first subagent tool should be Read");
            }
            _ => panic!("expected SubagentToolUse"),
        }

        // Verify SubagentToolResult entries — injected parent_tool_use_id makes the
        // parser treat these as subagent events and emit SubagentToolResult.
        let subagent_tool_results: Vec<_> = log_entries
            .iter()
            .filter(|e| matches!(e, LogEntry::SubagentToolResult { .. }))
            .collect();
        assert!(
            !subagent_tool_results.is_empty(),
            "expected SubagentToolResult entries from sidechain, got none"
        );

        match subagent_tool_results[0] {
            LogEntry::SubagentToolResult {
                parent_task_id,
                tool_use_id,
                ..
            } => {
                assert_eq!(parent_task_id, "tu_agent_1");
                assert_eq!(tool_use_id, "tu_sub_1");
            }
            _ => panic!("expected SubagentToolResult"),
        }
    }

    #[test]
    fn sidechain_discovery_finds_new_agents() {
        let dir = TempDir::new().unwrap();
        let main_path = dir.path().join("session123.jsonl");
        std::fs::write(&main_path, b"").unwrap();

        let sidechain_dir = dir.path().join("session123").join("subagents");
        std::fs::create_dir_all(&sidechain_dir).unwrap();

        // Initially no agent directories — should find nothing
        let known: HashMap<PathBuf, SidechainState> = HashMap::new();
        let found = discover_new_sidechains(&sidechain_dir, &known);
        assert!(found.is_empty(), "no agent dirs yet — should find nothing");

        // Create agent directory with meta.json + .jsonl
        let agent_dir = sidechain_dir.join("agent-xyz");
        std::fs::create_dir_all(&agent_dir).unwrap();
        std::fs::write(agent_dir.join("meta.json"), r#"{"toolUseId":"tu_agent_1"}"#).unwrap();
        std::fs::write(agent_dir.join("transcript.jsonl"), b"").unwrap();

        // Should now find the new agent
        let found2 = discover_new_sidechains(&sidechain_dir, &known);
        assert_eq!(found2.len(), 1, "should find the newly-created agent");
        assert_eq!(found2[0].1.parent_tool_use_id, "tu_agent_1");

        // Build a known map from the result and call again — should return empty
        let mut known2: HashMap<PathBuf, SidechainState> = HashMap::new();
        for (k, s) in found2 {
            known2.insert(k, s);
        }
        let found3 = discover_new_sidechains(&sidechain_dir, &known2);
        assert!(
            found3.is_empty(),
            "already-known agents must not be re-discovered"
        );
    }

    /// Build a two-agent fixture: main transcript + two sidechain dirs.
    ///
    /// Returns `(main_path, agent1_dir, agent2_dir)`.
    fn setup_two_agent_fixture(dir: &Path) -> (PathBuf, PathBuf, PathBuf) {
        let main_path = dir.join("session.jsonl");
        let a1 = serde_json::json!({"type":"assistant","message":{"content":[{"type":"tool_use","name":"Agent","id":"tu_agent_1","input":{"description":"task 1"}}]}});
        let r1 = serde_json::json!({"type":"user","toolUseResult":{"agentId":"agent-abc"},"message":{"content":[{"type":"tool_result","tool_use_id":"tu_agent_1","content":"done 1"}]}});
        let a2 = serde_json::json!({"type":"assistant","message":{"content":[{"type":"tool_use","name":"Agent","id":"tu_agent_2","input":{"description":"task 2"}}]}});
        let r2 = serde_json::json!({"type":"user","toolUseResult":{"agentId":"agent-def"},"message":{"content":[{"type":"tool_result","tool_use_id":"tu_agent_2","content":"done 2"}]}});
        std::fs::write(&main_path, format!("{a1}\n{r1}\n{a2}\n{r2}\n").as_bytes()).unwrap();

        let sidechain_base = dir.join("session").join("subagents");
        let agent1_dir = sidechain_base.join("agent-abc");
        let agent2_dir = sidechain_base.join("agent-def");
        std::fs::create_dir_all(&agent1_dir).unwrap();
        std::fs::create_dir_all(&agent2_dir).unwrap();

        std::fs::write(
            agent1_dir.join("meta.json"),
            r#"{"toolUseId":"tu_agent_1"}"#,
        )
        .unwrap();
        let sc1 = serde_json::json!({"type":"assistant","message":{"content":[{"type":"tool_use","name":"Read","id":"tu_sub_1","input":{"file_path":"/a.rs"}}]}});
        std::fs::write(agent1_dir.join("t1.jsonl"), format!("{sc1}\n").as_bytes()).unwrap();

        std::fs::write(
            agent2_dir.join("meta.json"),
            r#"{"toolUseId":"tu_agent_2"}"#,
        )
        .unwrap();
        let sc2 = serde_json::json!({"type":"assistant","message":{"content":[{"type":"tool_use","name":"Edit","id":"tu_sub_2","input":{"file_path":"/b.rs"}}]}});
        std::fs::write(agent2_dir.join("t2.jsonl"), format!("{sc2}\n").as_bytes()).unwrap();

        (main_path, agent1_dir, agent2_dir)
    }

    #[test]
    fn multiple_concurrent_sidechains() {
        use orkestra_parser::ClaudeParserService;
        use std::sync::mpsc;

        let dir = TempDir::new().unwrap();
        let (main_path, agent1_dir, agent2_dir) = setup_two_agent_fixture(dir.path());

        let (tx, rx) = mpsc::channel();
        let mut parser = ClaudeParserService::new();
        let mut full_output = String::new();
        let mut line_count = 0usize;

        // Parse main transcript to register both Agent tool IDs
        read_new_lines(
            &main_path,
            0,
            &mut parser,
            &tx,
            &mut full_output,
            &mut line_count,
        );

        // Read both sidechains
        read_sidechain_lines(
            &agent1_dir.join("t1.jsonl"),
            0,
            "tu_agent_1",
            &mut parser,
            &tx,
        );
        read_sidechain_lines(
            &agent2_dir.join("t2.jsonl"),
            0,
            "tu_agent_2",
            &mut parser,
            &tx,
        );

        let events: Vec<_> = rx.try_iter().collect();
        let subagent_uses: Vec<_> = events
            .iter()
            .filter_map(|e| {
                if let RunEvent::LogLine(LogEntry::SubagentToolUse {
                    parent_task_id,
                    tool,
                    ..
                }) = e
                {
                    Some((parent_task_id.clone(), tool.clone()))
                } else {
                    None
                }
            })
            .collect();

        assert_eq!(
            subagent_uses.len(),
            2,
            "expected two SubagentToolUse entries, one per sidechain"
        );

        // Each sidechain must have its own parent_task_id
        let ids: Vec<&str> = subagent_uses.iter().map(|(id, _)| id.as_str()).collect();
        assert!(
            ids.contains(&"tu_agent_1"),
            "sidechain 1 must reference tu_agent_1"
        );
        assert!(
            ids.contains(&"tu_agent_2"),
            "sidechain 2 must reference tu_agent_2"
        );
    }

    #[test]
    fn missing_meta_json_skips_sidechain() {
        let dir = TempDir::new().unwrap();
        let sidechain_dir = dir.path().join("subagents");
        std::fs::create_dir_all(&sidechain_dir).unwrap();

        // Create agent dir WITHOUT meta.json
        let agent_dir = sidechain_dir.join("agent-no-meta");
        std::fs::create_dir_all(&agent_dir).unwrap();
        std::fs::write(agent_dir.join("transcript.jsonl"), b"").unwrap();

        let known: HashMap<PathBuf, SidechainState> = HashMap::new();
        let found = discover_new_sidechains(&sidechain_dir, &known);
        assert!(
            found.is_empty(),
            "sidechain without meta.json must be skipped without error"
        );
    }

    #[test]
    fn sidechain_lines_not_in_full_output() {
        use orkestra_parser::ClaudeParserService;
        use std::sync::mpsc;

        let dir = TempDir::new().unwrap();
        let (main_path, sidechain_jsonl) = setup_sidechain_fixture(dir.path());

        let (tx, _rx) = mpsc::channel();
        let mut parser = ClaudeParserService::new();
        let mut full_output = String::new();
        let mut line_count = 0usize;

        // Parse main transcript
        read_new_lines(
            &main_path,
            0,
            &mut parser,
            &tx,
            &mut full_output,
            &mut line_count,
        );

        let main_output_snapshot = full_output.clone();

        // Read sidechain — must NOT modify full_output
        read_sidechain_lines(&sidechain_jsonl, 0, "tu_agent_1", &mut parser, &tx);

        assert_eq!(
            full_output, main_output_snapshot,
            "sidechain reading must not append to full_output"
        );
        // Sidechain content must not appear in full_output
        assert!(
            !full_output.contains("tu_sub_1"),
            "sidechain tool IDs must not appear in full_output"
        );
    }
}
