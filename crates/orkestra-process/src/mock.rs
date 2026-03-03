//! Mock process spawner for testing.

use std::collections::VecDeque;
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};

use crate::interface::ProcessSpawner;
use crate::types::{ProcessConfig, ProcessError, ProcessHandle};

/// Recorded spawn call.
#[derive(Debug, Clone)]
pub struct SpawnCall {
    pub working_dir: PathBuf,
    pub config: ProcessConfig,
}

/// Mock process spawner for testing.
///
/// Spawns a real `cat` subprocess to produce valid stdio handles.
/// `cat` echoes stdin to stdout and exits when stdin closes — safe and
/// deterministic for tests. The mock queue controls what gets returned
/// on stdout; callers can inspect recorded `SpawnCall`s.
pub struct MockProcessSpawner {
    calls: Arc<Mutex<Vec<SpawnCall>>>,
    outputs: Arc<Mutex<VecDeque<String>>>,
    next_pid: Arc<Mutex<u32>>,
}

impl Default for MockProcessSpawner {
    fn default() -> Self {
        Self::new()
    }
}

impl MockProcessSpawner {
    /// Create a new mock spawner.
    pub fn new() -> Self {
        Self {
            calls: Arc::new(Mutex::new(Vec::new())),
            outputs: Arc::new(Mutex::new(VecDeque::new())),
            next_pid: Arc::new(Mutex::new(10000)),
        }
    }

    /// Add an output to return for the next spawn.
    pub fn add_output(&self, output: impl Into<String>) {
        self.outputs.lock().unwrap().push_back(output.into());
    }

    /// Get recorded spawn calls.
    pub fn calls(&self) -> Vec<SpawnCall> {
        self.calls.lock().unwrap().clone()
    }

    /// Clear recorded calls.
    pub fn clear_calls(&self) {
        self.calls.lock().unwrap().clear();
    }
}

impl ProcessSpawner for MockProcessSpawner {
    fn spawn(
        &self,
        working_dir: &Path,
        config: ProcessConfig,
    ) -> Result<ProcessHandle, ProcessError> {
        // Record the call
        self.calls.lock().unwrap().push(SpawnCall {
            working_dir: working_dir.to_path_buf(),
            config: config.clone(),
        });

        // Increment logical PID counter (unused for real pid below, kept for API stability)
        {
            let mut next = self.next_pid.lock().unwrap();
            *next += 1;
        }

        // Get queued output (unused here — `cat` echoes stdin, but callers
        // that need specific stdout content should use real processes).
        let _output = self.outputs.lock().unwrap().pop_front().unwrap_or_default();

        // Spawn `cat` to get valid ChildStdin/ChildStdout handles.
        // cat echoes stdin → stdout and exits when stdin closes, making it
        // a safe, deterministic subprocess for test environments.
        let working_dir = if working_dir.exists() {
            working_dir.to_path_buf()
        } else {
            std::env::temp_dir()
        };

        let mut child = std::process::Command::new("cat")
            .stdin(std::process::Stdio::piped())
            .stdout(std::process::Stdio::piped())
            .stderr(std::process::Stdio::piped())
            .current_dir(&working_dir)
            .spawn()
            .map_err(|e| ProcessError::SpawnFailed(e.to_string()))?;

        let pid = child.id();

        let stdin = child
            .stdin
            .take()
            .ok_or_else(|| ProcessError::SpawnFailed("No stdin".to_string()))?;
        let stdout = child
            .stdout
            .take()
            .ok_or_else(|| ProcessError::SpawnFailed("No stdout".to_string()))?;
        let stderr = child.stderr.take();

        Ok(ProcessHandle::new(pid, stdin, stdout, stderr))
    }
}
