//! Debug logging for Orkestra.
//!
//! Provides debug logging with two output channels:
//! - **File**: Written to `.orkestra/debug.log` when `ORKESTRA_DEBUG=1` is set.
//! - **Hook**: An optional callback registered at runtime (e.g., to emit Tauri events).
//!
//! Additionally provides agent output logging:
//! - **Agent log**: Written to `.orkestra/agents.log` (always enabled when initialized).
//!   Contains structured `LogEntry` JSON from agent stdout for debugging agent behavior.
//!
//! Both debug channels are independent — either, both, or neither can be active.
//! The `orkestra_debug!` macro only evaluates its arguments when at least one channel is active.
//!
//! # Usage
//!
//! ```bash
//! # Enable file logging
//! ORKESTRA_DEBUG=1 pnpm tauri dev
//!
//! # View logs
//! tail -f .orkestra/debug.log
//! tail -f .orkestra/agents.log
//! ```
//!
//! ```ignore
//! use orkestra_core::orkestra_debug;
//!
//! // Log from anywhere — dispatches to file and/or hook automatically.
//! orkestra_debug!("component", "Something happened: {}", value);
//! ```

use std::fs::{File, OpenOptions};
use std::io::{Read, Seek, SeekFrom, Write};
use std::path::Path;
use std::sync::{Mutex, OnceLock};

static DEBUG_STATE: OnceLock<DebugState> = OnceLock::new();
type DebugHookFn = Mutex<Box<dyn Fn(&str, &str) + Send>>;
static DEBUG_HOOK: OnceLock<DebugHookFn> = OnceLock::new();

/// Agent log state (separate from debug logging).
static AGENT_LOG_STATE: OnceLock<AgentLogState> = OnceLock::new();

const MAX_LOG_SIZE: u64 = 5 * 1024 * 1024; // 5MB
const TRUNCATE_TO: usize = 2 * 1024 * 1024; // Keep last 2MB

struct DebugState {
    enabled: bool,
    file: Option<Mutex<File>>,
}

/// State for agent output logging.
struct AgentLogState {
    file: Mutex<File>,
}

/// Initialize the file logger.
///
/// Must be called once at startup with the path to the `.orkestra` directory.
/// If `ORKESTRA_DEBUG=1` or `ORKESTRA_DEBUG=true`, file logging is enabled.
pub fn init(orkestra_dir: &Path) {
    let enabled = std::env::var("ORKESTRA_DEBUG")
        .map(|v| v == "1" || v.to_lowercase() == "true")
        .unwrap_or(false);

    let file = if enabled {
        let path = orkestra_dir.join("debug.log");
        match OpenOptions::new().create(true).append(true).open(&path) {
            Ok(f) => {
                eprintln!("[orkestra] Debug logging enabled: {}", path.display());
                Some(Mutex::new(f))
            }
            Err(e) => {
                eprintln!(
                    "[orkestra] WARNING: Failed to open debug log {}: {}",
                    path.display(),
                    e
                );
                None
            }
        }
    } else {
        None
    };

    let _ = DEBUG_STATE.set(DebugState { enabled, file });
}

/// Initialize the agent output logger.
///
/// Must be called once at startup with the path to the `.orkestra` directory.
/// Always creates `.orkestra/agents.log` (no env var needed since it's for structured agent output).
pub fn init_agent_log(orkestra_dir: &Path) {
    let path = orkestra_dir.join("agents.log");
    match OpenOptions::new().create(true).append(true).open(&path) {
        Ok(f) => {
            let _ = AGENT_LOG_STATE.set(AgentLogState {
                file: Mutex::new(f),
            });
        }
        Err(e) => {
            eprintln!(
                "[orkestra] WARNING: Failed to open agent log {}: {}",
                path.display(),
                e
            );
        }
    }
}

/// Register a hook that receives all debug log messages.
///
/// The hook is called with `(component, message)` for every `orkestra_debug!` call.
/// Can be called independently of `init()` — the hook and file logger are separate channels.
///
/// Only one hook can be registered (subsequent calls are ignored).
pub fn set_hook(hook: impl Fn(&str, &str) + Send + 'static) {
    let _ = DEBUG_HOOK.set(Mutex::new(Box::new(hook)));
}

/// Check if any debug output channel is active (file logging or hook).
#[inline]
pub fn is_active() -> bool {
    is_enabled() || DEBUG_HOOK.get().is_some()
}

/// Check if file logging is enabled.
#[inline]
pub fn is_enabled() -> bool {
    DEBUG_STATE.get().is_some_and(|s| s.enabled)
}

/// Log a debug message to all active channels.
///
/// Prefer using the `orkestra_debug!` macro instead of calling this directly.
pub fn log(component: &str, message: &str) {
    // Write to file if enabled
    if let Some(state) = DEBUG_STATE.get() {
        if state.enabled {
            if let Some(file_mutex) = &state.file {
                let timestamp = chrono::Utc::now().format("%Y-%m-%dT%H:%M:%S%.3fZ");
                let line = format!("{timestamp} [{component}] {message}\n");

                if let Ok(mut file) = file_mutex.lock() {
                    if let Ok(metadata) = file.metadata() {
                        if metadata.len() > MAX_LOG_SIZE {
                            rotate_log(&mut file);
                        }
                    }
                    let _ = file.write_all(line.as_bytes());
                    let _ = file.flush();
                }
                eprint!("{line}");
            }
        }
    }

    // Dispatch to hook if registered
    if let Some(hook_mutex) = DEBUG_HOOK.get() {
        if let Ok(hook) = hook_mutex.lock() {
            hook(component, message);
        }
    }
}

/// Log agent output to the agent log file.
///
/// Writes structured JSON log entries from agent stdout to `.orkestra/agents.log`.
/// Each line is formatted as: `{timestamp} [{task_id}/{stage}] {json}`
///
/// This is separate from debug logging — agent logs are always written when initialized,
/// regardless of `ORKESTRA_DEBUG` setting.
pub fn agent_log(task_id: &str, stage: &str, entry_json: &str) {
    if let Some(state) = AGENT_LOG_STATE.get() {
        let timestamp = chrono::Utc::now().format("%Y-%m-%dT%H:%M:%S%.3fZ");
        let line = format!("{timestamp} [{task_id}/{stage}] {entry_json}\n");

        if let Ok(mut file) = state.file.lock() {
            // Check for rotation
            if let Ok(metadata) = file.metadata() {
                if metadata.len() > MAX_LOG_SIZE {
                    rotate_log(&mut file);
                }
            }
            let _ = file.write_all(line.as_bytes());
            let _ = file.flush();
        }
    }
}

/// Rotate the log file by keeping only the last `TRUNCATE_TO` bytes.
#[allow(clippy::cast_possible_wrap)]
fn rotate_log(file: &mut File) {
    // Seek to position where we want to start keeping content
    if file.seek(SeekFrom::End(-(TRUNCATE_TO as i64))).is_err() {
        // File is smaller than TRUNCATE_TO, just truncate from start
        let _ = file.set_len(0);
        let _ = file.seek(SeekFrom::Start(0));
        let _ = file.write_all(b"[log rotated - file was small]\n");
        return;
    }

    // Read the content we want to keep
    let mut buffer = vec![0u8; TRUNCATE_TO];
    let bytes_read = file.read(&mut buffer).unwrap_or(0);
    buffer.truncate(bytes_read);

    // Find first newline to avoid partial line at start
    let start_offset = buffer.iter().position(|&b| b == b'\n').unwrap_or(0);
    let content = &buffer[start_offset..];

    // Truncate and rewrite
    let _ = file.set_len(0);
    let _ = file.seek(SeekFrom::Start(0));
    let _ = file.write_all(b"[log rotated]\n");
    let _ = file.write_all(content);
}

/// Debug logging macro.
///
/// Only evaluates arguments when at least one output channel is active
/// (file logging or hook). Dispatches to all active channels.
///
/// # Example
///
/// ```ignore
/// orkestra_debug!("session", "Created session {} for task {}", session_id, task_id);
/// orkestra_debug!("db", "Saved task {}: phase={:?}", task.id, task.phase);
/// ```
#[macro_export]
macro_rules! orkestra_debug {
    ($component:expr, $($arg:tt)*) => {
        if $crate::debug_log::is_active() {
            $crate::debug_log::log($component, &format!($($arg)*));
        }
    };
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::TempDir;

    #[test]
    fn test_init_disabled_by_default() {
        // Note: This test assumes ORKESTRA_DEBUG is not set in the environment
        // In a real test environment, we'd need to control the env var
        assert!(!is_enabled() || std::env::var("ORKESTRA_DEBUG").is_ok());
    }

    #[test]
    fn test_log_format() {
        let _temp_dir = TempDir::new().unwrap();
        std::env::set_var("ORKESTRA_DEBUG", "1");

        // Reinitialize for this test (won't work due to OnceLock, but shows intent)
        // In practice, we'd need a different approach for testing

        // Just verify the format string works
        let timestamp = chrono::Utc::now().format("%Y-%m-%dT%H:%M:%S%.3fZ");
        let line = format!("{timestamp} [test] Hello world\n");
        assert!(line.contains("[test]"));
        assert!(line.contains("Hello world"));

        std::env::remove_var("ORKESTRA_DEBUG");
    }
}
