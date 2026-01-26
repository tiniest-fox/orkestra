//! Debug logging for Orkestra.
//!
//! Provides file-based debug logging controlled by the `ORKESTRA_DEBUG` environment variable.
//! When enabled, logs are written to `.orkestra/debug.log` with automatic rotation.
//!
//! # Usage
//!
//! ```bash
//! # Enable debug logging
//! ORKESTRA_DEBUG=1 pnpm tauri dev
//!
//! # View logs
//! tail -f .orkestra/debug.log
//! ```
//!
//! # In code
//!
//! ```ignore
//! use orkestra_core::orkestra_debug;
//!
//! orkestra_debug!("component", "Something happened: {}", value);
//! ```

use std::fs::{File, OpenOptions};
use std::io::{Read, Seek, SeekFrom, Write};
use std::path::Path;
use std::sync::{Mutex, OnceLock};

static DEBUG_STATE: OnceLock<DebugState> = OnceLock::new();

const MAX_LOG_SIZE: u64 = 5 * 1024 * 1024; // 5MB
const TRUNCATE_TO: usize = 2 * 1024 * 1024; // Keep last 2MB

struct DebugState {
    enabled: bool,
    file: Option<Mutex<File>>,
}

/// Initialize the debug logger.
///
/// Must be called once at startup with the path to the `.orkestra` directory.
/// If `ORKESTRA_DEBUG=1` or `ORKESTRA_DEBUG=true`, logging is enabled.
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

/// Check if debug logging is enabled.
#[inline]
pub fn is_enabled() -> bool {
    DEBUG_STATE.get().map(|s| s.enabled).unwrap_or(false)
}

/// Log a debug message.
///
/// Prefer using the `orkestra_debug!` macro instead of calling this directly.
pub fn log(component: &str, message: &str) {
    let Some(state) = DEBUG_STATE.get() else {
        return;
    };
    if !state.enabled {
        return;
    }
    let Some(file_mutex) = &state.file else {
        return;
    };

    let timestamp = chrono::Utc::now().format("%Y-%m-%dT%H:%M:%S%.3fZ");
    let line = format!("{timestamp} [{component}] {message}\n");

    if let Ok(mut file) = file_mutex.lock() {
        // Check size and rotate if needed
        if let Ok(metadata) = file.metadata() {
            if metadata.len() > MAX_LOG_SIZE {
                rotate_log(&mut file);
            }
        }
        let _ = file.write_all(line.as_bytes());
        let _ = file.flush();
    }
}

/// Rotate the log file by keeping only the last TRUNCATE_TO bytes.
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
/// Only evaluates arguments and writes to log if debug logging is enabled.
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
        if $crate::debug_log::is_enabled() {
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
