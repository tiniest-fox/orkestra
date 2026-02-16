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
/// Doesn't spawn real processes - returns configured mock output.
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

        // Get next PID
        let pid = {
            let mut next = self.next_pid.lock().unwrap();
            let pid = *next;
            *next += 1;
            pid
        };

        // Get output (or empty string)
        let output = self.outputs.lock().unwrap().pop_front().unwrap_or_default();

        // Create mock handle
        // Note: This is a simplified mock - real implementation would need
        // proper mock streams. For now we return an error since we can't
        // easily mock ChildStdin/ChildStdout.
        Err(ProcessError::SpawnFailed(format!(
            "MockProcessSpawner cannot create real handles. PID would be {pid}, output: {output}"
        )))
    }
}
