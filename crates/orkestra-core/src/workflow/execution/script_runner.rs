//! Async script execution for script-based workflow stages.
//!
//! Script stages run shell commands instead of spawning Claude agents.
//! This module provides async execution with timeout support and output capture.

use std::collections::HashMap;
use std::io::Read;
use std::path::Path;
use std::process::{Child, ChildStderr, ChildStdout, Command, Stdio};
use std::time::{Duration, Instant};

use crate::process::kill_process_tree;

/// Environment variables to pass to script execution.
///
/// These provide task context to scripts so they can make intelligent decisions
/// about what to check based on what changed.
#[derive(Debug, Clone, Default)]
pub struct ScriptEnv {
    vars: HashMap<String, String>,
}

impl ScriptEnv {
    /// Create a new empty script environment.
    pub fn new() -> Self {
        Self::default()
    }

    /// Set an environment variable.
    pub fn set(&mut self, key: impl Into<String>, value: impl Into<String>) -> &mut Self {
        self.vars.insert(key.into(), value.into());
        self
    }

    /// Set an environment variable (builder pattern).
    #[must_use]
    pub fn with(mut self, key: impl Into<String>, value: impl Into<String>) -> Self {
        self.vars.insert(key.into(), value.into());
        self
    }

    /// Set an optional environment variable (only if Some).
    #[must_use]
    pub fn with_opt(mut self, key: impl Into<String>, value: Option<impl Into<String>>) -> Self {
        if let Some(v) = value {
            self.vars.insert(key.into(), v.into());
        }
        self
    }

    /// Get the environment variables as a reference.
    pub fn vars(&self) -> &HashMap<String, String> {
        &self.vars
    }
}

/// Result of a completed script execution.
#[derive(Debug, Clone)]
pub struct ScriptResult {
    /// Exit code of the script (0 = success).
    pub exit_code: i32,
    /// Combined stdout and stderr output.
    pub output: String,
    /// Whether the script timed out.
    pub timed_out: bool,
}

impl ScriptResult {
    /// Check if the script succeeded (exit code 0 and no timeout).
    pub fn is_success(&self) -> bool {
        self.exit_code == 0 && !self.timed_out
    }
}

/// Handle for a running script process.
///
/// Use `try_wait()` to check for completion without blocking.
/// The script will be killed on drop if still running.
pub struct ScriptHandle {
    child: Child,
    stdout: Option<ChildStdout>,
    stderr: Option<ChildStderr>,
    timeout_at: Instant,
    output_buffer: String,
    killed: bool,
}

impl ScriptHandle {
    /// Spawn a script asynchronously.
    ///
    /// # Arguments
    /// * `command` - Shell command to execute (runs via `sh -c`)
    /// * `working_dir` - Directory to run the script in
    /// * `timeout` - Maximum execution time before the script is killed
    ///
    /// # Returns
    /// A handle that can be polled for completion.
    pub fn spawn(command: &str, working_dir: &Path, timeout: Duration) -> std::io::Result<Self> {
        Self::spawn_with_env(command, working_dir, timeout, &ScriptEnv::new())
    }

    /// Spawn a script with custom environment variables.
    ///
    /// # Arguments
    /// * `command` - Shell command to execute (runs via `sh -c`)
    /// * `working_dir` - Directory to run the script in
    /// * `timeout` - Maximum execution time before the script is killed
    /// * `env` - Environment variables to pass to the script
    ///
    /// # Returns
    /// A handle that can be polled for completion.
    pub fn spawn_with_env(
        command: &str,
        working_dir: &Path,
        timeout: Duration,
        env: &ScriptEnv,
    ) -> std::io::Result<Self> {
        let mut cmd = Command::new("sh");
        cmd.args(["-c", command])
            .current_dir(working_dir)
            .stdout(Stdio::piped())
            .stderr(Stdio::piped());

        // Add custom environment variables
        for (key, value) in env.vars() {
            cmd.env(key, value);
        }

        let mut child = cmd.spawn()?;

        let stdout = child.stdout.take();
        let stderr = child.stderr.take();

        Ok(Self {
            child,
            stdout,
            stderr,
            timeout_at: Instant::now() + timeout,
            output_buffer: String::new(),
            killed: false,
        })
    }

    /// Get the process ID of the running script.
    pub fn pid(&self) -> u32 {
        self.child.id()
    }

    /// Check if the script has completed (non-blocking).
    ///
    /// Returns `Some(ScriptResult)` if the script has finished,
    /// `None` if still running.
    ///
    /// If the script has timed out, this will kill it and return
    /// a timeout result.
    pub fn try_wait(&mut self) -> std::io::Result<Option<ScriptResult>> {
        // Check for timeout first
        if self.is_timed_out() && !self.killed {
            self.kill();
            // Collect any output we got before timeout
            self.collect_available_output();
            return Ok(Some(ScriptResult {
                exit_code: -1,
                output: format!(
                    "Script timed out after {:?}\n\n{}",
                    self.timeout_at.elapsed(),
                    self.output_buffer
                ),
                timed_out: true,
            }));
        }

        // Try to collect available output (non-blocking)
        self.collect_available_output();

        // Check if process has exited
        match self.child.try_wait()? {
            Some(status) => {
                // Process exited - collect remaining output
                self.collect_remaining_output();

                Ok(Some(ScriptResult {
                    exit_code: status.code().unwrap_or(-1),
                    output: std::mem::take(&mut self.output_buffer),
                    timed_out: false,
                }))
            }
            None => Ok(None), // Still running
        }
    }

    /// Check if the script has exceeded its timeout.
    pub fn is_timed_out(&self) -> bool {
        Instant::now() > self.timeout_at
    }

    /// Kill the script process tree.
    pub fn kill(&mut self) {
        if !self.killed {
            self.killed = true;
            let pid = self.child.id();
            if let Err(e) = kill_process_tree(pid) {
                eprintln!("[script] Warning: failed to kill process tree {pid}: {e}");
            }
            // Also try regular kill in case process tree kill failed
            let _ = self.child.kill();
        }
    }

    /// Collect available output without blocking.
    #[allow(clippy::unused_self)]
    fn collect_available_output(&mut self) {
        // Note: This is a simplified implementation.
        // For true non-blocking reads, we'd need platform-specific code
        // or async I/O. For now, we rely on the process having exited
        // or the timeout being hit for output collection.
    }

    /// Collect all remaining output after process exits.
    fn collect_remaining_output(&mut self) {
        // Read stdout
        if let Some(mut stdout) = self.stdout.take() {
            let mut stdout_buf = String::new();
            if stdout.read_to_string(&mut stdout_buf).is_ok() && !stdout_buf.is_empty() {
                self.output_buffer.push_str(&stdout_buf);
            }
        }

        // Read stderr
        if let Some(mut stderr) = self.stderr.take() {
            let mut stderr_buf = String::new();
            if stderr.read_to_string(&mut stderr_buf).is_ok() && !stderr_buf.is_empty() {
                if !self.output_buffer.is_empty() {
                    self.output_buffer.push_str("\n\n--- stderr ---\n");
                }
                self.output_buffer.push_str(&stderr_buf);
            }
        }
    }
}

impl Drop for ScriptHandle {
    fn drop(&mut self) {
        // Kill the script if still running when handle is dropped
        if !self.killed {
            if let Ok(None) = self.child.try_wait() {
                // Process still running - kill it
                self.kill();
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::time::Duration;
    use tempfile::TempDir;

    #[test]
    fn test_script_env_builder() {
        let env = ScriptEnv::new()
            .with("KEY1", "value1")
            .with("KEY2", "value2")
            .with_opt("KEY3", Some("value3"))
            .with_opt("KEY4", None::<String>);

        assert_eq!(env.vars().get("KEY1"), Some(&"value1".to_string()));
        assert_eq!(env.vars().get("KEY2"), Some(&"value2".to_string()));
        assert_eq!(env.vars().get("KEY3"), Some(&"value3".to_string()));
        assert!(env.vars().get("KEY4").is_none());
    }

    #[test]
    fn test_script_with_env_vars() {
        let temp_dir = TempDir::new().unwrap();
        let env = ScriptEnv::new()
            .with("TEST_VAR", "hello_from_orkestra")
            .with("ANOTHER_VAR", "42");

        let mut handle = ScriptHandle::spawn_with_env(
            "echo $TEST_VAR $ANOTHER_VAR",
            temp_dir.path(),
            Duration::from_secs(10),
            &env,
        )
        .unwrap();

        // Wait for completion
        loop {
            if let Some(result) = handle.try_wait().unwrap() {
                assert!(result.is_success());
                assert!(result.output.contains("hello_from_orkestra"));
                assert!(result.output.contains("42"));
                break;
            }
            std::thread::sleep(Duration::from_millis(10));
        }
    }

    #[test]
    fn test_script_success() {
        let temp_dir = TempDir::new().unwrap();
        let mut handle = ScriptHandle::spawn(
            "echo 'hello world'",
            temp_dir.path(),
            Duration::from_secs(10),
        )
        .unwrap();

        // Wait for completion
        loop {
            if let Some(result) = handle.try_wait().unwrap() {
                assert!(result.is_success());
                assert_eq!(result.exit_code, 0);
                assert!(result.output.contains("hello world"));
                assert!(!result.timed_out);
                break;
            }
            std::thread::sleep(Duration::from_millis(10));
        }
    }

    #[test]
    fn test_script_failure() {
        let temp_dir = TempDir::new().unwrap();
        let mut handle =
            ScriptHandle::spawn("exit 42", temp_dir.path(), Duration::from_secs(10)).unwrap();

        // Wait for completion
        loop {
            if let Some(result) = handle.try_wait().unwrap() {
                assert!(!result.is_success());
                assert_eq!(result.exit_code, 42);
                assert!(!result.timed_out);
                break;
            }
            std::thread::sleep(Duration::from_millis(10));
        }
    }

    #[test]
    fn test_script_timeout() {
        let temp_dir = TempDir::new().unwrap();
        let mut handle = ScriptHandle::spawn(
            "sleep 60",
            temp_dir.path(),
            Duration::from_millis(100), // Very short timeout
        )
        .unwrap();

        // Wait for timeout
        std::thread::sleep(Duration::from_millis(200));

        let result = handle.try_wait().unwrap().unwrap();
        assert!(!result.is_success());
        assert!(result.timed_out);
    }

    #[test]
    fn test_script_stderr_capture() {
        let temp_dir = TempDir::new().unwrap();
        let mut handle = ScriptHandle::spawn(
            "echo 'stdout' && echo 'stderr' >&2",
            temp_dir.path(),
            Duration::from_secs(10),
        )
        .unwrap();

        // Wait for completion
        loop {
            if let Some(result) = handle.try_wait().unwrap() {
                assert!(result.is_success());
                assert!(result.output.contains("stdout"));
                assert!(result.output.contains("stderr"));
                break;
            }
            std::thread::sleep(Duration::from_millis(10));
        }
    }

    #[test]
    fn test_script_working_directory() {
        let temp_dir = TempDir::new().unwrap();
        let expected_path = temp_dir.path().to_str().unwrap();

        let mut handle =
            ScriptHandle::spawn("pwd", temp_dir.path(), Duration::from_secs(10)).unwrap();

        loop {
            if let Some(result) = handle.try_wait().unwrap() {
                assert!(result.is_success());
                assert!(result.output.trim().contains(expected_path));
                break;
            }
            std::thread::sleep(Duration::from_millis(10));
        }
    }
}
