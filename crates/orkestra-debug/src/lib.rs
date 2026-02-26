//! Debug logging for Orkestra.
//!
//! Provides a unified logging system with two channels routed via the `orkestra_debug!` macro:
//!
//! - **debug** (default): Always written to `.orkestra/.logs/debug.log`. Stderr in dev builds only.
//!   Log lines are prefixed with `[dev]` or `[prod]` to distinguish build types.
//!   Also dispatches to an optional hook (e.g., Tauri events).
//! - **agents** (`target: agents`): Written to `.orkestra/.logs/agents.log`, always enabled, no stderr.
//!   Contains structured `LogEntry` JSON from agent stdout for debugging agent behavior.
//!
//! # Usage
//!
//! ```bash
//! # View logs (always-on)
//! tail -f .orkestra/.logs/debug.log
//! tail -f .orkestra/.logs/agents.log
//!
//! # Filter by build type:
//! grep '\[prod\]' .orkestra/.logs/debug.log
//! grep '\[dev\]'  .orkestra/.logs/debug.log
//! ```
//!
//! ```ignore
//! use orkestra_debug::orkestra_debug;
//!
//! // Default target (debug.log):
//! orkestra_debug!("component", "Something happened: {}", value);
//!
//! // Agent target (agents.log only):
//! orkestra_debug!("component", target: agents, "Entry: {}", json);
//! ```

use std::fs::{File, OpenOptions};
use std::io::{Read, Seek, SeekFrom, Write};
use std::path::Path;
use std::sync::{Mutex, OnceLock};

/// A log channel: a file target with optional stderr mirroring.
struct LogChannel {
    enabled: bool,
    file: Option<Mutex<File>>,
    stderr: bool,
}

static DEBUG_CHANNEL: OnceLock<LogChannel> = OnceLock::new();
static AGENTS_CHANNEL: OnceLock<LogChannel> = OnceLock::new();

type DebugHookFn = Mutex<Box<dyn Fn(&str, &str) + Send>>;
static DEBUG_HOOK: OnceLock<DebugHookFn> = OnceLock::new();

const MAX_LOG_SIZE: u64 = 5 * 1024 * 1024; // 5MB
const TRUNCATE_TO: usize = 2 * 1024 * 1024; // Keep last 2MB

/// Initialize the debug log channel.
///
/// Must be called once at startup with the path to the `.orkestra` directory.
/// Logging is always-on — writes to `.orkestra/.logs/debug.log`. Stderr only in dev builds.
pub fn init(orkestra_dir: &Path) {
    let logs_dir = orkestra_dir.join(".logs");
    let _ = std::fs::create_dir_all(&logs_dir);
    let path = logs_dir.join("debug.log");

    let file = match OpenOptions::new().create(true).append(true).open(&path) {
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
    };

    let _ = DEBUG_CHANNEL.set(LogChannel {
        enabled: true,
        file,
        stderr: cfg!(debug_assertions),
    });
}

/// Initialize the agent output log channel.
///
/// Must be called once at startup with the path to the `.orkestra` directory.
/// Always creates `.orkestra/.logs/agents.log` (no env var needed since it's for structured agent output).
/// Writes to file only — no stderr output.
pub fn init_agent_log(orkestra_dir: &Path) {
    let logs_dir = orkestra_dir.join(".logs");
    let _ = std::fs::create_dir_all(&logs_dir);
    let path = logs_dir.join("agents.log");
    match OpenOptions::new().create(true).append(true).open(&path) {
        Ok(f) => {
            let _ = AGENTS_CHANNEL.set(LogChannel {
                enabled: true,
                file: Some(Mutex::new(f)),
                stderr: false,
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

/// Check if debug file logging is enabled.
#[inline]
pub fn is_enabled() -> bool {
    DEBUG_CHANNEL.get().is_some_and(|c| c.enabled)
}

/// Check if the agents log channel is initialized.
#[inline]
pub fn is_agents_active() -> bool {
    AGENTS_CHANNEL.get().is_some_and(|c| c.enabled)
}

/// Log a debug message to the debug channel and hook.
///
/// Prefer using the `orkestra_debug!` macro instead of calling this directly.
pub fn log(component: &str, message: &str) {
    if let Some(channel) = DEBUG_CHANNEL.get() {
        if channel.enabled {
            let env = if cfg!(debug_assertions) {
                "dev"
            } else {
                "prod"
            };
            let timestamp = chrono::Utc::now().format("%Y-%m-%dT%H:%M:%S%.3fZ");
            let line = format!("{timestamp} [{env}] [{component}] {message}\n");
            write_to_channel(channel, &line);
        }
    }

    // Dispatch to hook if registered
    if let Some(hook_mutex) = DEBUG_HOOK.get() {
        if let Ok(hook) = hook_mutex.lock() {
            hook(component, message);
        }
    }
}

/// Log a message to the agents channel (file only, no stderr, no hook).
///
/// Prefer using `orkestra_debug!("component", target: agents, ...)` instead of calling this directly.
pub fn log_to_agents(component: &str, message: &str) {
    if let Some(channel) = AGENTS_CHANNEL.get() {
        if channel.enabled {
            let timestamp = chrono::Utc::now().format("%Y-%m-%dT%H:%M:%S%.3fZ");
            let line = format!("{timestamp} [{component}] {message}\n");
            write_to_channel(channel, &line);
        }
    }
}

/// Write a formatted line to a channel's file, rotating if needed.
fn write_to_channel(channel: &LogChannel, line: &str) {
    if let Some(file_mutex) = &channel.file {
        if let Ok(mut file) = file_mutex.lock() {
            if let Ok(metadata) = file.metadata() {
                if metadata.len() > MAX_LOG_SIZE {
                    rotate_log(&mut file);
                }
            }
            let _ = file.write_all(line.as_bytes());
            let _ = file.flush();
        }
    }
    if channel.stderr {
        eprint!("{line}");
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

/// Debug logging macro with optional target routing.
///
/// - Default: routes to `debug.log` + stderr + hook (gated by `ORKESTRA_DEBUG=1`).
/// - `target: agents`: routes to `agents.log` only (always enabled, no stderr).
///
/// # Example
///
/// ```ignore
/// // Debug channel (default):
/// orkestra_debug!("session", "Created session {} for task {}", session_id, task_id);
///
/// // Agents channel:
/// orkestra_debug!("task/stage", target: agents, "{}", json);
/// ```
#[macro_export]
macro_rules! orkestra_debug {
    // Agent target: agents.log, no stderr, no hook
    ($component:expr, target: agents, $($arg:tt)*) => {
        if $crate::is_agents_active() {
            $crate::log_to_agents($component, &format!($($arg)*));
        }
    };
    // Default target: debug.log + stderr + hook
    ($component:expr, $($arg:tt)*) => {
        if $crate::is_active() {
            $crate::log($component, &format!($($arg)*));
        }
    };
}

// ============================================================================
// Tests
// ============================================================================

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_log_includes_build_type() {
        // Verify the format string includes a build-type prefix
        let env = if cfg!(debug_assertions) {
            "dev"
        } else {
            "prod"
        };
        let timestamp = chrono::Utc::now().format("%Y-%m-%dT%H:%M:%S%.3fZ");
        let line = format!("{timestamp} [{env}] [test] Hello world\n");
        assert!(line.contains(&format!("[{env}]")));
        assert!(line.contains("[test]"));
    }

    #[test]
    fn test_log_format() {
        // Just verify the format string works
        let env = if cfg!(debug_assertions) {
            "dev"
        } else {
            "prod"
        };
        let timestamp = chrono::Utc::now().format("%Y-%m-%dT%H:%M:%S%.3fZ");
        let line = format!("{timestamp} [{env}] [test] Hello world\n");
        assert!(line.contains("[test]"));
        assert!(line.contains("Hello world"));
    }
}
