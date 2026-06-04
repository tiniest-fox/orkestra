//! PTY-based agent execution for interactive Claude Code sessions.
//!
//! Spawns Claude Code in a PTY, injects the prompt via keystrokes, waits for
//! the hook-based Stop callback, reads the JSONL transcript, classifies output,
//! and emits `RunEvents` matching the (u32, Receiver<RunEvent>) contract.

use std::io::{BufRead, BufReader, Write};
use std::path::{Path, PathBuf};
use std::sync::mpsc::{self, Receiver, Sender};
use std::sync::Arc;
use std::thread;
use std::time::Duration;

use orkestra_parser::interactions::stream::parse_resume_marker;
use orkestra_parser::AgentParser;
use orkestra_process::ProcessGuard;
use orkestra_types::domain::LogEntry;
use portable_pty::{CommandBuilder, PtySize};
use tempfile::NamedTempFile;

use crate::interactions::hooks::types::{HookReceiver, HookServer};
use crate::orkestra_debug;
use crate::registry::ProviderRegistry;
use crate::types::{AgentCompletionError, RunConfig, RunError, RunEvent};

use super::classify_output::{self, OutputClassification};

// ============================================================================
// PTY Handle
// ============================================================================

/// Owns the PTY process lifecycle. `ProcessGuard` fires SIGTERM on drop.
///
/// `child` and `guard` are held for their drop-side effects rather than read
/// access — `child` keeps the PTY slave open, `guard` sends SIGTERM on drop.
#[allow(dead_code)]
struct PtyHandle {
    writer: Box<dyn Write + Send>,
    child: Box<dyn portable_pty::Child + Send + Sync>,
    guard: ProcessGuard,
}

// ============================================================================
// Entry Point
// ============================================================================

/// Run an agent in a PTY session with event streaming.
///
/// Spawns Claude Code in a PTY, writes the prompt via keystrokes, waits for
/// the hook-based Stop callback, reads the JSONL transcript, classifies output,
/// and emits `RunEvents`. Returns `(pid, receiver)` matching the standard contract.
pub fn execute(
    registry: &Arc<ProviderRegistry>,
    config: &RunConfig,
    hook_server: &Arc<HookServer>,
) -> Result<(u32, Receiver<RunEvent>), RunError> {
    // Resolve provider
    let resolved = registry
        .resolve(config.model.as_deref())
        .map_err(|e| RunError::SpawnFailed(e.to_string()))?;

    // Create parser — claude-pty uses the same JSONL format as claudecode
    let parser = registry
        .create_parser(&resolved.provider_name)
        .map_err(|e| RunError::SpawnFailed(e.to_string()))?;

    // Parse schema for validation
    let schema: Option<serde_json::Value> = serde_json::from_str(&config.json_schema).ok();

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

    // Register task with hook server before spawning PTY so no events are missed
    let hook_rx = hook_server.register_task(&task_id);
    let socket_path = hook_server.socket_path().to_string_lossy().to_string();

    // Write hook settings to a temp file; kept alive until the session ends
    let settings_file = build_settings_file(&session_id, &socket_path)
        .map_err(|e| RunError::SpawnFailed(format!("failed to write hook settings: {e}")))?;

    let settings_path = settings_file.path().to_path_buf();

    // Spawn PTY
    let pty_system = portable_pty::native_pty_system();
    let pair = pty_system
        .openpty(PtySize {
            rows: 24,
            cols: 80,
            pixel_width: 0,
            pixel_height: 0,
        })
        .map_err(|e| RunError::SpawnFailed(format!("failed to open PTY: {e}")))?;

    let mut cmd = CommandBuilder::new("claude");
    if is_resume {
        cmd.args(["--resume", &session_id]);
    } else {
        cmd.args(["--session-id", &session_id]);
    }
    cmd.args(["--permission-mode", "acceptEdits"]);
    cmd.args(["--settings", settings_path.to_str().unwrap_or_default()]);
    if let Some(ref model) = resolved_model_id {
        cmd.args(["--model", model]);
    }
    cmd.cwd(&working_dir);
    cmd.env("ORK_TASK_ID", &task_id);
    cmd.env("CLAUDE_CODE_DISABLE_BACKGROUND_TASKS", "1");
    if let Some(ref env_map) = env {
        for (k, v) in env_map {
            cmd.env(k, v);
        }
    }

    let child = pair
        .slave
        .spawn_command(cmd)
        .map_err(|e| RunError::SpawnFailed(format!("failed to spawn PTY process: {e}")))?;

    let pid = child
        .process_id()
        .ok_or_else(|| RunError::SpawnFailed("PTY child has no process ID".into()))?
        as u32;

    orkestra_debug!("runner", "run_pty: spawned pid={}", pid);

    let writer = pair
        .master
        .take_writer()
        .map_err(|e| RunError::SpawnFailed(format!("failed to get PTY writer: {e}")))?;

    let pty_handle = PtyHandle {
        writer,
        child,
        guard: ProcessGuard::new(pid),
    };

    // Create event channel
    let (tx, rx) = mpsc::channel();

    // Emit UserMessage log entry (same pattern as run_async)
    if let Some(marker) = parse_resume_marker::execute(&prompt) {
        let _ = tx.send(RunEvent::LogLine(LogEntry::UserMessage {
            resume_type: marker.marker_type.as_str().to_string(),
            content: marker.content,
            sections: prompt_sections,
        }));
    } else {
        let _ = tx.send(RunEvent::LogLine(LogEntry::UserMessage {
            resume_type: "user_message".to_string(),
            content: prompt.clone(),
            sections: prompt_sections,
        }));
    }

    // Clone Arc for the background thread
    let hook_server_thread = Arc::clone(hook_server);

    thread::spawn(move || {
        // Keep settings_file alive until the PTY session ends
        let _settings_file = settings_file;

        let ctx = SessionCtx {
            task_id: &task_id,
            session_id: &session_id,
            working_dir: &working_dir,
            prompt: &prompt,
            schema: schema.as_ref(),
        };
        run_background(pty_handle, &hook_rx, &hook_server_thread, &tx, parser, ctx);
    });

    Ok((pid, rx))
}

// ============================================================================
// Background Thread
// ============================================================================

/// Session parameters bundled to keep `run_background`'s argument count in check.
#[derive(Copy, Clone)]
struct SessionCtx<'a> {
    task_id: &'a str,
    session_id: &'a str,
    working_dir: &'a Path,
    prompt: &'a str,
    schema: Option<&'a serde_json::Value>,
}

fn run_background(
    mut pty_handle: PtyHandle,
    hook_rx: &HookReceiver,
    hook_server: &HookServer,
    tx: &Sender<RunEvent>,
    mut parser: Box<dyn AgentParser>,
    ctx: SessionCtx<'_>,
) {
    // Write prompt to PTY master, then send Enter
    let write_result = pty_handle
        .writer
        .write_all(ctx.prompt.as_bytes())
        .and_then(|()| pty_handle.writer.write_all(b"\n"));

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
    // Emitting this LogLine triggers `has_confirmed_output` in ActiveAgent::poll(),
    // persisting `has_activity=true` for crash recovery.
    let transcript_hint = compute_transcript_path(ctx.working_dir, ctx.session_id);
    if poll_for_file(&transcript_hint, Duration::from_secs(30)) {
        let _ = tx.send(RunEvent::LogLine(LogEntry::Text {
            content: "PTY session active".to_string(),
        }));
    }

    // Wait for Stop hook (turn completion signal from Claude Code)
    let hook_result = hook_rx.recv_timeout(Duration::from_hours(1));

    let hook_event = match hook_result {
        Ok(event) => {
            orkestra_debug!(
                "runner",
                "run_pty: got hook event {:?} for session {}",
                event.event_type,
                event.session_id
            );
            Some(event)
        }
        Err(e) => {
            orkestra_debug!("runner", "run_pty: hook recv failed: {e:?}");
            None
        }
    };

    // Use transcript path from hook event if available, else computed fallback
    let transcript_path = hook_event
        .as_ref()
        .and_then(|e| e.transcript_path.clone())
        .unwrap_or(transcript_hint);

    // Wait briefly for file flush before reading
    thread::sleep(Duration::from_millis(100));

    // Read and parse JSONL transcript, emit log events
    let (full_output, line_count) = read_and_parse_transcript(&transcript_path, &mut *parser, tx);

    // Kill PTY process — ProcessGuard fires SIGTERM on drop (not disarmed)
    drop(pty_handle);

    // Cleanup
    hook_server.unregister_task(ctx.task_id);

    // Timeout with no output = crash
    if hook_event.is_none() && line_count == 0 {
        let _ = tx.send(RunEvent::Completed(Err(AgentCompletionError::Crash(
            "PTY session timed out with no output".to_string(),
        ))));
        return;
    }

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

/// Write Claude Code hook settings JSON to a temp file.
///
/// The Stop hook sends the turn-done signal to the UDS server. `SessionEnd`
/// fires when the process terminates. Both commands use `$ORK_TASK_ID` (set
/// in the PTY environment) for server-side routing.
fn build_settings_file(
    session_id: &str,
    socket_path: &str,
) -> Result<NamedTempFile, Box<dyn std::error::Error + Send + Sync>> {
    let stop_cmd = format!(
        "echo '{{\"event\":\"stop\",\"task_id\":\"'\"$ORK_TASK_ID\"'\",\"session_id\":\"{session_id}\",\"transcript_path\":\"'\"$CLAUDE_TRANSCRIPT_PATH\"'\"}}' | nc -U {socket_path}"
    );
    let session_end_cmd = format!(
        "echo '{{\"event\":\"session_end\",\"task_id\":\"'\"$ORK_TASK_ID\"'\",\"session_id\":\"{session_id}\"}}' | nc -U {socket_path}"
    );

    let settings = serde_json::json!({
        "hooks": {
            "Stop": [{"matcher": "", "command": stop_cmd}],
            "SessionEnd": [{"matcher": "", "command": session_end_cmd}]
        }
    });

    let mut file = NamedTempFile::new()?;
    let json_bytes = serde_json::to_vec(&settings)?;
    file.write_all(&json_bytes)?;
    Ok(file)
}

/// Compute the JSONL transcript path Claude Code uses for a given session.
///
/// Claude Code writes `~/.claude/projects/<encoded-cwd>/<session-id>.jsonl`
/// where encoded-cwd replaces every `/` with `-`.
fn compute_transcript_path(working_dir: &Path, session_id: &str) -> PathBuf {
    let home = std::env::var("HOME").unwrap_or_else(|_| "/root".to_string());
    let encoded_cwd = working_dir.to_string_lossy().replace('/', "-");
    PathBuf::from(home)
        .join(".claude")
        .join("projects")
        .join(encoded_cwd)
        .join(format!("{session_id}.jsonl"))
}

/// Poll until the given file exists or the deadline is reached.
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

/// Read a JSONL transcript, pass each line through the parser to emit log events,
/// and return `(full_output, line_count)`.
fn read_and_parse_transcript(
    path: &Path,
    parser: &mut dyn AgentParser,
    tx: &Sender<RunEvent>,
) -> (String, usize) {
    let file = match std::fs::File::open(path) {
        Ok(f) => f,
        Err(e) => {
            orkestra_debug!("runner", "run_pty: could not open transcript {path:?}: {e}");
            return (String::new(), 0);
        }
    };

    let mut full_output = String::new();
    let mut line_count = 0usize;

    for line_result in BufReader::new(file).lines() {
        match line_result {
            Ok(line) => {
                if line.trim().is_empty() {
                    continue;
                }
                line_count += 1;

                let update = parser.parse_line(&line);

                if let Some(sid) = update.session_id {
                    let _ = tx.send(RunEvent::SessionId(sid));
                }

                for entry in update.log_entries {
                    if tx.send(RunEvent::LogLine(entry)).is_err() {
                        return (full_output, line_count);
                    }
                }

                full_output.push_str(&line);
                full_output.push('\n');
            }
            Err(e) => {
                orkestra_debug!("runner", "run_pty: error reading transcript line: {e}");
                break;
            }
        }
    }

    (full_output, line_count)
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

    #[test]
    fn settings_file_contains_stop_and_session_end_hooks() {
        let file = build_settings_file("ses-123", "/tmp/hooks.sock").unwrap();
        let content = std::fs::read_to_string(file.path()).unwrap();
        let parsed: serde_json::Value = serde_json::from_str(&content).unwrap();

        let stop_hooks = &parsed["hooks"]["Stop"];
        assert!(stop_hooks.is_array(), "Stop hooks should be an array");
        let stop_cmd = stop_hooks[0]["command"].as_str().unwrap();
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
        let se_cmd = se_hooks[0]["command"].as_str().unwrap();
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
    fn compute_transcript_path_replaces_slashes() {
        let dir = PathBuf::from("/home/user/projects/my-repo");
        let path = compute_transcript_path(&dir, "ses-456");
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

    #[test]
    fn read_and_parse_transcript_returns_empty_for_missing_file() {
        use orkestra_parser::types::ParsedUpdate;
        use orkestra_parser::AgentParser;
        use orkestra_parser::ExtractionResult;
        use std::sync::mpsc;

        struct NullParser;
        impl AgentParser for NullParser {
            fn parse_line(&mut self, _line: &str) -> ParsedUpdate {
                ParsedUpdate {
                    log_entries: vec![],
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

        let (tx, _rx) = mpsc::channel();
        let mut parser = NullParser;
        let (output, count) =
            read_and_parse_transcript(&PathBuf::from("/nonexistent/path.jsonl"), &mut parser, &tx);
        assert_eq!(output, "");
        assert_eq!(count, 0);
    }
}
