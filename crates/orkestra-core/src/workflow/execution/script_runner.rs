//! Async script execution for script-based workflow stages.
//!
//! Script stages run shell commands instead of spawning Claude agents.
//! This module provides async execution with timeout support and output capture.

use std::collections::HashMap;
use std::io::{BufRead, BufReader};
use std::path::Path;
use std::process::{Child, Command, Stdio};
use std::sync::mpsc::{self, Receiver, Sender};
use std::thread::{self, JoinHandle};
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

/// Result of polling a script handle.
pub enum ScriptPollState {
    /// Script is still running, with any new output since last poll.
    Running {
        /// New output received since the last poll (may be empty).
        new_output: Option<String>,
    },
    /// Script has completed.
    Completed(ScriptResult),
}

/// Handle for a running script process.
///
/// Use `try_wait()` to check for completion without blocking.
/// The script will be killed on drop if still running.
pub struct ScriptHandle {
    child: Child,
    /// Receiver for output lines from reader threads.
    output_receiver: Receiver<String>,
    /// Join handles for reader threads.
    reader_handles: Vec<JoinHandle<()>>,
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

        // Set up channel for output streaming
        let (sender, receiver) = mpsc::channel();

        // Spawn reader threads for stdout and stderr
        let mut reader_handles = Vec::new();

        if let Some(stdout) = child.stdout.take() {
            let handle = spawn_output_reader(stdout, sender.clone());
            reader_handles.push(handle);
        }

        if let Some(stderr) = child.stderr.take() {
            let handle = spawn_output_reader(stderr, sender);
            reader_handles.push(handle);
        }

        Ok(Self {
            child,
            output_receiver: receiver,
            reader_handles,
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
    /// Returns the current poll state with any new output since the last poll.
    ///
    /// If the script has timed out, this will kill it and return
    /// a timeout result.
    pub fn try_wait(&mut self) -> std::io::Result<ScriptPollState> {
        // Collect any available output from reader threads
        let new_output = self.collect_available_output();

        // Always append new output to the buffer first
        if let Some(ref output) = new_output {
            self.output_buffer.push_str(output);
        }

        // Check for timeout
        if self.is_timed_out() && !self.killed {
            self.kill();
            // Wait for reader threads to finish
            self.wait_for_readers();
            // Collect any remaining output
            if let Some(remaining) = self.collect_available_output() {
                self.output_buffer.push_str(&remaining);
            }

            return Ok(ScriptPollState::Completed(ScriptResult {
                exit_code: -1,
                output: format!(
                    "Script timed out after {:?}\n\n{}",
                    self.timeout_at.elapsed(),
                    self.output_buffer
                ),
                timed_out: true,
            }));
        }

        // Check if process has exited
        match self.child.try_wait()? {
            Some(status) => {
                // Process exited - wait for reader threads and collect remaining output
                self.wait_for_readers();
                if let Some(remaining) = self.collect_available_output() {
                    self.output_buffer.push_str(&remaining);
                }

                Ok(ScriptPollState::Completed(ScriptResult {
                    exit_code: status.code().unwrap_or(-1),
                    output: std::mem::take(&mut self.output_buffer),
                    timed_out: false,
                }))
            }
            None => {
                // Still running - return the new output for this poll
                Ok(ScriptPollState::Running { new_output })
            }
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

    /// Collect available output from reader threads without blocking.
    ///
    /// Returns any new lines received since the last call, or None if no new output.
    fn collect_available_output(&mut self) -> Option<String> {
        let mut new_lines = Vec::new();

        // Drain all available messages from the channel
        while let Ok(line) = self.output_receiver.try_recv() {
            new_lines.push(line);
        }

        if new_lines.is_empty() {
            None
        } else {
            Some(new_lines.join(""))
        }
    }

    /// Wait for reader threads to complete.
    fn wait_for_readers(&mut self) {
        for handle in self.reader_handles.drain(..) {
            let _ = handle.join();
        }
    }
}

/// Spawn a thread to read lines from a reader and send them through a channel.
fn spawn_output_reader<R: std::io::Read + Send + 'static>(
    reader: R,
    sender: Sender<String>,
) -> JoinHandle<()> {
    thread::spawn(move || {
        let buf_reader = BufReader::new(reader);
        for line in buf_reader.lines() {
            match line {
                Ok(line) => {
                    // Send line with newline to preserve formatting
                    if sender.send(format!("{line}\n")).is_err() {
                        // Receiver dropped, stop reading
                        break;
                    }
                }
                Err(_) => break,
            }
        }
    })
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
            match handle.try_wait().unwrap() {
                ScriptPollState::Completed(result) => {
                    assert!(result.is_success());
                    assert!(result.output.contains("hello_from_orkestra"));
                    assert!(result.output.contains("42"));
                    break;
                }
                ScriptPollState::Running { .. } => {
                    std::thread::sleep(Duration::from_millis(10));
                }
            }
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
            match handle.try_wait().unwrap() {
                ScriptPollState::Completed(result) => {
                    assert!(result.is_success());
                    assert_eq!(result.exit_code, 0);
                    assert!(result.output.contains("hello world"));
                    assert!(!result.timed_out);
                    break;
                }
                ScriptPollState::Running { .. } => {
                    std::thread::sleep(Duration::from_millis(10));
                }
            }
        }
    }

    #[test]
    fn test_script_failure() {
        let temp_dir = TempDir::new().unwrap();
        let mut handle =
            ScriptHandle::spawn("exit 42", temp_dir.path(), Duration::from_secs(10)).unwrap();

        // Wait for completion
        loop {
            match handle.try_wait().unwrap() {
                ScriptPollState::Completed(result) => {
                    assert!(!result.is_success());
                    assert_eq!(result.exit_code, 42);
                    assert!(!result.timed_out);
                    break;
                }
                ScriptPollState::Running { .. } => {
                    std::thread::sleep(Duration::from_millis(10));
                }
            }
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

        match handle.try_wait().unwrap() {
            ScriptPollState::Completed(result) => {
                assert!(!result.is_success());
                assert!(result.timed_out);
            }
            ScriptPollState::Running { .. } => {
                panic!("Expected script to be timed out");
            }
        }
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
            match handle.try_wait().unwrap() {
                ScriptPollState::Completed(result) => {
                    assert!(result.is_success());
                    assert!(result.output.contains("stdout"));
                    assert!(result.output.contains("stderr"));
                    break;
                }
                ScriptPollState::Running { .. } => {
                    std::thread::sleep(Duration::from_millis(10));
                }
            }
        }
    }

    #[test]
    fn test_script_working_directory() {
        let temp_dir = TempDir::new().unwrap();
        let expected_path = temp_dir.path().to_str().unwrap();

        let mut handle =
            ScriptHandle::spawn("pwd", temp_dir.path(), Duration::from_secs(10)).unwrap();

        loop {
            match handle.try_wait().unwrap() {
                ScriptPollState::Completed(result) => {
                    assert!(result.is_success());
                    assert!(result.output.trim().contains(expected_path));
                    break;
                }
                ScriptPollState::Running { .. } => {
                    std::thread::sleep(Duration::from_millis(10));
                }
            }
        }
    }

    #[test]
    fn test_script_streaming_output() {
        let temp_dir = TempDir::new().unwrap();
        // Script that produces output over time
        let mut handle = ScriptHandle::spawn(
            "for i in 1 2 3; do echo \"line $i\"; sleep 0.05; done",
            temp_dir.path(),
            Duration::from_secs(10),
        )
        .unwrap();

        let mut collected_incremental = Vec::new();

        // Poll and collect incremental output
        loop {
            match handle.try_wait().unwrap() {
                ScriptPollState::Completed(result) => {
                    assert!(result.is_success());
                    // Final output should contain all lines
                    assert!(result.output.contains("line 1"));
                    assert!(result.output.contains("line 2"));
                    assert!(result.output.contains("line 3"));
                    break;
                }
                ScriptPollState::Running { new_output } => {
                    if let Some(output) = new_output {
                        collected_incremental.push(output);
                    }
                    std::thread::sleep(Duration::from_millis(20));
                }
            }
        }

        // We should have received some incremental output while the script was running
        // (may vary based on timing, so just check we got at least something)
        assert!(
            !collected_incremental.is_empty(),
            "Should have received incremental output"
        );
    }
}
