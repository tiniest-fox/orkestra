//! Generic process infrastructure for spawning and managing Claude Code agents.
//!
//! This module contains pure process management utilities that are decoupled from
//! the task/workflow domain. It can be used by any orchestrator implementation.
//!
//! # Contents
//! - `ProcessGuard`: RAII guard for process cleanup
//! - `spawn_claude_process`: Core process spawning
//! - `kill_process_tree`: Process tree cleanup
//! - `is_process_running`: PID liveness check
//! - Stream parsing utilities

use std::io::BufRead;
use std::path::{Path, PathBuf};
use std::process::{Child, ChildStderr, ChildStdout, Command, Stdio};
use std::sync::atomic::{AtomicBool, Ordering};
use std::thread::JoinHandle;

#[cfg(unix)]
use std::os::unix::process::CommandExt;

// ============================================================================
// Process Guard
// ============================================================================

/// RAII guard that ensures a spawned process is killed when dropped.
/// This provides defense-in-depth: if code panics or takes an unexpected path,
/// the process will still be cleaned up.
///
/// Call `disarm()` when the process exits normally to prevent killing on drop.
pub struct ProcessGuard {
    pid: u32,
    disarmed: AtomicBool,
}

impl ProcessGuard {
    /// Create a new process guard for the given PID.
    pub fn new(pid: u32) -> Self {
        Self {
            pid,
            disarmed: AtomicBool::new(false),
        }
    }

    /// Disarm the guard to prevent killing the process on drop.
    /// Call this when the process exits normally.
    pub fn disarm(&self) {
        self.disarmed.store(true, Ordering::Relaxed);
    }
}

impl Drop for ProcessGuard {
    fn drop(&mut self) {
        if !self.disarmed.load(Ordering::Relaxed) {
            eprintln!(
                "[ProcessGuard] Killing orphaned process {} on drop",
                self.pid
            );
            let _ = kill_process_tree(self.pid);
        }
    }
}

// ============================================================================
// Process Spawning
// ============================================================================

/// Finds the ork CLI binary path.
pub fn find_cli_path() -> Option<PathBuf> {
    // First check if ork is in PATH
    if let Ok(output) = Command::new("which").arg("ork").output() {
        if output.status.success() {
            let path = String::from_utf8_lossy(&output.stdout).trim().to_string();
            if !path.is_empty() {
                return Some(PathBuf::from(path));
            }
        }
    }

    // Check relative to current directory (development mode)
    let dev_path = std::env::current_dir().ok()?.join("target/debug/ork");
    if dev_path.exists() {
        return Some(dev_path);
    }

    // Check relative to git repo root (for worktrees)
    if let Ok(output) = Command::new("git")
        .args(["rev-parse", "--show-toplevel"])
        .output()
    {
        if output.status.success() {
            let repo_root = String::from_utf8_lossy(&output.stdout).trim().to_string();
            let git_root_path = PathBuf::from(&repo_root).join("target/debug/ork");
            if git_root_path.exists() {
                return Some(git_root_path);
            }
        }
    }

    // Walk up the directory tree looking for target/debug/ork
    if let Ok(cwd) = std::env::current_dir() {
        let mut path = cwd.as_path();
        while let Some(parent) = path.parent() {
            let candidate = parent.join("target/debug/ork");
            if candidate.exists() {
                return Some(candidate);
            }
            path = parent;
        }
    }

    None
}

/// Prepares the PATH environment variable with the CLI directory.
pub fn prepare_path_env() -> String {
    let cli_path = find_cli_path();
    let mut path_env = std::env::var("PATH").unwrap_or_default();
    if let Some(ref cli) = cli_path {
        if let Some(parent) = cli.parent() {
            path_env = format!("{}:{}", parent.display(), path_env);
        }
    }
    path_env
}

/// Spawns a Claude process with common arguments.
///
/// # Arguments
/// * `project_root` - Working directory for the process
/// * `path_env` - PATH environment variable value
/// * `resume_session` - Optional session ID to resume
/// * `json_schema` - Optional JSON schema for structured output (uses --output-format json)
pub fn spawn_claude_process(
    project_root: &Path,
    path_env: &str,
    resume_session: Option<&str>,
    json_schema: Option<&str>,
) -> std::io::Result<Child> {
    let mut cmd = Command::new("claude");

    if let Some(session_id) = resume_session {
        cmd.args(["--resume", session_id]);
    }

    cmd.args(["--print", "--verbose"]);

    // When using JSON schema, use --output-format json for structured output
    // Otherwise use stream-json for real-time updates
    if let Some(schema) = json_schema {
        cmd.args(["--output-format", "json", "--json-schema", schema]);
    } else {
        cmd.args(["--output-format", "stream-json"]);
    }

    cmd.args(["--dangerously-skip-permissions"])
        .env("PATH", path_env)
        .current_dir(project_root)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());

    // Create new process group so we can kill all descendants (cargo, rustc, etc.)
    // when the agent is terminated. Without this, child processes become orphans.
    #[cfg(unix)]
    cmd.process_group(0);

    cmd.spawn()
}

/// Writes prompt to stdin and closes it.
pub fn write_prompt_to_stdin(child: &mut Child, prompt: &str) -> std::io::Result<()> {
    use std::io::Write as IoWrite;
    if let Some(mut stdin) = child.stdin.take() {
        stdin.write_all(prompt.as_bytes())?;
    }
    Ok(())
}

// ============================================================================
// Process Management
// ============================================================================

/// Recursively finds all descendant PIDs of a given process.
/// Uses pgrep -P to find children at each level.
#[cfg(unix)]
fn get_descendant_pids(pid: u32) -> Vec<u32> {
    let mut descendants = Vec::new();
    let mut to_check = vec![pid];

    while let Some(parent_pid) = to_check.pop() {
        if let Ok(output) = Command::new("pgrep")
            .args(["-P", &parent_pid.to_string()])
            .output()
        {
            if output.status.success() {
                let stdout = String::from_utf8_lossy(&output.stdout);
                for line in stdout.lines() {
                    if let Ok(child_pid) = line.trim().parse::<u32>() {
                        descendants.push(child_pid);
                        to_check.push(child_pid);
                    }
                }
            }
        }
    }

    descendants
}

/// Kills an agent and all its descendant processes.
/// This ensures that when an agent is terminated, all spawned processes
/// (cargo, rustc, shells, etc.) are also killed, preventing orphaned processes.
///
/// Strategy:
/// 1. First collect all descendant PIDs (children create their own process groups)
/// 2. Kill the main process group (catches direct children in same group)
/// 3. Kill any remaining descendants that were in different process groups
#[cfg(unix)]
#[allow(clippy::cast_possible_wrap)]
pub fn kill_process_tree(pid: u32) -> std::io::Result<()> {
    // Collect all descendants BEFORE killing (they may reparent to init otherwise)
    let descendants = get_descendant_pids(pid);

    // The PID is the process group ID since we spawn with process_group(0)
    let pgid = pid as i32;

    // First try SIGTERM for graceful shutdown of the main process group
    let result = unsafe { libc::kill(-pgid, libc::SIGTERM) };

    if result != 0 {
        let err = std::io::Error::last_os_error();
        // ESRCH means process doesn't exist - that's fine
        if err.raw_os_error() != Some(libc::ESRCH) {
            // If SIGTERM failed for another reason, try SIGKILL
            unsafe { libc::kill(-pgid, libc::SIGKILL) };
        }
    }

    // Now kill any descendants that were in different process groups
    for desc_pid in descendants {
        let desc_pgid = desc_pid as i32;
        let result = unsafe { libc::kill(-desc_pgid, libc::SIGTERM) };
        if result != 0 {
            unsafe { libc::kill(desc_pgid, libc::SIGTERM) };
        }
    }

    Ok(())
}

#[cfg(not(unix))]
pub fn kill_process_tree(pid: u32) -> std::io::Result<()> {
    // On Windows, use taskkill with /T to kill the tree
    Command::new("taskkill")
        .args(["/PID", &pid.to_string(), "/T", "/F"])
        .output()?;
    Ok(())
}

/// Check if a process with the given PID is still running.
///
/// On Unix, uses `kill(pid, 0)` which checks if the process exists without sending a signal.
/// On Windows, uses `OpenProcess` to check if the process handle can be opened.
#[allow(clippy::cast_possible_wrap)]
pub fn is_process_running(pid: u32) -> bool {
    #[cfg(unix)]
    {
        unsafe { libc::kill(pid as i32, 0) == 0 }
    }
    #[cfg(windows)]
    {
        unsafe {
            let handle = windows_sys::Win32::System::Threading::OpenProcess(
                windows_sys::Win32::System::Threading::PROCESS_QUERY_LIMITED_INFORMATION,
                0,
                pid,
            );
            if handle.is_null() {
                false
            } else {
                windows_sys::Win32::Foundation::CloseHandle(handle);
                true
            }
        }
    }
    #[cfg(not(any(unix, windows)))]
    {
        let _ = pid;
        false
    }
}

// ============================================================================
// Stderr Handling
// ============================================================================

/// Spawns a thread to read stderr and collect lines.
pub fn spawn_stderr_reader(stderr: Option<ChildStderr>) -> Option<JoinHandle<Vec<String>>> {
    stderr.map(|stderr| {
        std::thread::spawn(move || {
            let reader = std::io::BufReader::new(stderr);
            let mut lines = Vec::new();
            for line in reader.lines().map_while(std::result::Result::ok) {
                lines.push(line);
            }
            lines
        })
    })
}

/// Logs stderr output if present.
pub fn log_stderr(task_id: &str, prefix: &str, stderr_handle: Option<JoinHandle<Vec<String>>>) {
    if let Some(handle) = stderr_handle {
        if let Ok(lines) = handle.join() {
            if !lines.is_empty() {
                eprintln!("{} {} stderr: {}", prefix, task_id, lines.join("\n"));
            }
        }
    }
}

// ============================================================================
// Stream Event Parsing
// ============================================================================

/// Result from parsing a stream event.
#[derive(Debug, Default)]
pub struct ParsedStreamEvent {
    /// Session ID if this event contains one (from system init).
    pub session_id: Option<String>,
    /// True if this event indicates new content was written to the session file.
    pub has_new_content: bool,
}

/// Parses a streaming JSON event to extract useful information.
/// Only fires update events when meaningful content is produced.
pub fn parse_stream_event(json_line: &str) -> ParsedStreamEvent {
    let v: serde_json::Value = match serde_json::from_str(json_line) {
        Ok(v) => v,
        Err(_) => return ParsedStreamEvent::default(),
    };

    let event_type = v.get("type").and_then(|t| t.as_str()).unwrap_or("");

    // Check for system init events which contain session_id
    if event_type == "system" && v.get("subtype").and_then(|s| s.as_str()) == Some("init") {
        let session_id = v
            .get("session_id")
            .and_then(|s| s.as_str())
            .map(std::string::ToString::to_string);
        return ParsedStreamEvent {
            session_id,
            has_new_content: true,
        };
    }

    // Check for assistant message events (these are written to session file)
    if event_type == "assistant" && v.get("message").is_some() {
        return ParsedStreamEvent {
            session_id: None,
            has_new_content: true,
        };
    }

    // Check for result events (tool results, which update the session)
    if event_type == "result" {
        return ParsedStreamEvent {
            session_id: None,
            has_new_content: true,
        };
    }

    ParsedStreamEvent::default()
}

/// Extracts session_id from a JSON output string.
pub fn extract_session_id(json_str: &str) -> Option<String> {
    serde_json::from_str::<serde_json::Value>(json_str)
        .ok()
        .and_then(|v| v.get("session_id")?.as_str().map(String::from))
}

/// Extracts structured_output from a Claude JSON response.
/// Returns the structured_output as a Value if present.
pub fn extract_structured_output(json_str: &str) -> Option<serde_json::Value> {
    serde_json::from_str::<serde_json::Value>(json_str)
        .ok()
        .and_then(|v| v.get("structured_output").cloned())
}

/// Waits synchronously for session_id from stdout, with timeout.
/// Returns the session_id and a receiver for remaining lines.
pub fn wait_for_session_id_sync(
    stdout: Option<ChildStdout>,
    timeout_secs: u64,
) -> (Option<String>, Option<std::sync::mpsc::Receiver<std::io::Result<String>>>) {
    let Some(stdout) = stdout else {
        return (None, None);
    };

    let reader = std::io::BufReader::new(stdout);
    let start_time = std::time::Instant::now();
    let timeout = std::time::Duration::from_secs(timeout_secs);

    let (tx, rx) = std::sync::mpsc::channel();
    std::thread::spawn(move || {
        for line in reader.lines() {
            if tx.send(line).is_err() {
                break;
            }
        }
    });

    let mut captured_session_id: Option<String> = None;

    loop {
        if start_time.elapsed() > timeout {
            eprintln!("Warning: Timeout waiting for session_id after {timeout_secs} seconds");
            break;
        }

        match rx.recv_timeout(std::time::Duration::from_millis(100)) {
            Ok(Ok(json_line)) => {
                if json_line.trim().is_empty() {
                    continue;
                }
                let parsed = parse_stream_event(&json_line);
                if let Some(sid) = parsed.session_id {
                    captured_session_id = Some(sid);
                    break;
                }
            }
            Ok(Err(e)) => {
                eprintln!("Error reading stdout: {e}");
                break;
            }
            Err(std::sync::mpsc::RecvTimeoutError::Timeout) => {}
            Err(std::sync::mpsc::RecvTimeoutError::Disconnected) => break,
        }
    }

    (captured_session_id, Some(rx))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_parse_stream_event_init() {
        let json = r#"{"type":"system","subtype":"init","session_id":"abc123"}"#;
        let parsed = parse_stream_event(json);
        assert_eq!(parsed.session_id, Some("abc123".to_string()));
        assert!(parsed.has_new_content);
    }

    #[test]
    fn test_parse_stream_event_assistant() {
        let json = r#"{"type":"assistant","message":{"content":"hello"}}"#;
        let parsed = parse_stream_event(json);
        assert!(parsed.session_id.is_none());
        assert!(parsed.has_new_content);
    }

    #[test]
    fn test_parse_stream_event_result() {
        let json = r#"{"type":"result","data":"some data"}"#;
        let parsed = parse_stream_event(json);
        assert!(parsed.session_id.is_none());
        assert!(parsed.has_new_content);
    }

    #[test]
    fn test_parse_stream_event_invalid() {
        let json = "not valid json";
        let parsed = parse_stream_event(json);
        assert!(parsed.session_id.is_none());
        assert!(!parsed.has_new_content);
    }

    #[test]
    fn test_extract_session_id() {
        let json = r#"{"session_id":"test-session-123","result":"ok"}"#;
        assert_eq!(
            extract_session_id(json),
            Some("test-session-123".to_string())
        );
    }

    #[test]
    fn test_is_process_running_current() {
        // Our own process should be running
        assert!(is_process_running(std::process::id()));
    }

    #[test]
    fn test_is_process_running_invalid() {
        // Very high PID should not exist
        assert!(!is_process_running(u32::MAX - 1));
    }
}
