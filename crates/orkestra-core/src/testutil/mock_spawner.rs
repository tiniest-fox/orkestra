//! Mock process spawner implementation for testing.

use crate::error::Result;
use crate::ports::{ProcessSpawner, SpawnConfig, SpawnedProcess};

use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::atomic::{AtomicU32, Ordering};
use std::sync::RwLock;

/// Record of a spawn call for test inspection.
#[derive(Debug, Clone)]
pub struct SpawnCall {
    /// The prompt/stdin content passed to the process.
    pub prompt: String,
    /// The working directory.
    pub cwd: PathBuf,
    /// Whether this was a resume call.
    pub is_resume: bool,
    /// Session ID if this was a resume.
    pub resume_session_id: Option<String>,
}

/// Mock process spawner that simulates Claude Code behavior.
///
/// Instead of actually spawning Claude, it:
/// - Records all spawn calls (prompts, working directories)
/// - Generates fake PIDs and session IDs
/// - Tracks which processes are "running"
///
/// This allows tests to verify correct agent spawning without
/// actually invoking Claude Code.
///
/// # Example
///
/// ```ignore
/// use orkestra_core::testutil::MockProcessSpawner;
/// use orkestra_core::ports::{ProcessSpawner, SpawnConfig};
/// use std::path::Path;
///
/// let spawner = MockProcessSpawner::new();
///
/// let config = SpawnConfig {
///     args: &["--print"],
///     cwd: Path::new("/tmp"),
///     stdin_content: "Hello, Claude!",
/// };
///
/// let result = spawner.spawn(config, Box::new(|| {})).unwrap();
/// assert!(spawner.is_running(result.pid));
///
/// // Verify what was spawned
/// let calls = spawner.get_spawn_calls();
/// assert_eq!(calls[0].prompt, "Hello, Claude!");
/// ```
pub struct MockProcessSpawner {
    spawn_calls: RwLock<Vec<SpawnCall>>,
    next_pid: AtomicU32,
    processes_running: RwLock<HashMap<u32, bool>>,
}

impl MockProcessSpawner {
    /// Create a new mock spawner.
    pub fn new() -> Self {
        Self {
            spawn_calls: RwLock::new(Vec::new()),
            next_pid: AtomicU32::new(1000),
            processes_running: RwLock::new(HashMap::new()),
        }
    }

    /// Get all recorded spawn calls.
    pub fn get_spawn_calls(&self) -> Vec<SpawnCall> {
        self.spawn_calls.read().unwrap().clone()
    }

    /// Get only the prompts from spawn calls.
    pub fn get_prompts(&self) -> Vec<String> {
        self.spawn_calls
            .read()
            .unwrap()
            .iter()
            .map(|c| c.prompt.clone())
            .collect()
    }

    /// Get the number of spawn calls.
    pub fn call_count(&self) -> usize {
        self.spawn_calls.read().unwrap().len()
    }

    /// Mark a process as finished (no longer running).
    pub fn finish_process(&self, pid: u32) {
        self.processes_running.write().unwrap().insert(pid, false);
    }

    /// Mark all processes as finished.
    pub fn finish_all(&self) {
        let mut running = self.processes_running.write().unwrap();
        for (_, v) in running.iter_mut() {
            *v = false;
        }
    }

    /// Clear all recorded calls (useful between test phases).
    pub fn clear_calls(&self) {
        self.spawn_calls.write().unwrap().clear();
    }

    /// Get the last spawn call, if any.
    pub fn last_call(&self) -> Option<SpawnCall> {
        self.spawn_calls.read().unwrap().last().cloned()
    }
}

impl Default for MockProcessSpawner {
    fn default() -> Self {
        Self::new()
    }
}

impl ProcessSpawner for MockProcessSpawner {
    fn spawn(
        &self,
        config: SpawnConfig,
        _on_output: Box<dyn Fn() + Send>,
    ) -> Result<SpawnedProcess> {
        self.spawn_calls.write().unwrap().push(SpawnCall {
            prompt: config.stdin_content.to_string(),
            cwd: config.cwd.to_path_buf(),
            is_resume: false,
            resume_session_id: None,
        });

        let pid = self.next_pid.fetch_add(1, Ordering::SeqCst);
        self.processes_running.write().unwrap().insert(pid, true);

        Ok(SpawnedProcess {
            pid,
            session_id: Some(format!("mock-session-{pid}")),
        })
    }

    fn spawn_and_wait_for_session(
        &self,
        config: SpawnConfig,
        _timeout_secs: u64,
    ) -> Result<SpawnedProcess> {
        self.spawn_calls.write().unwrap().push(SpawnCall {
            prompt: config.stdin_content.to_string(),
            cwd: config.cwd.to_path_buf(),
            is_resume: false,
            resume_session_id: None,
        });

        let pid = self.next_pid.fetch_add(1, Ordering::SeqCst);
        self.processes_running.write().unwrap().insert(pid, true);

        Ok(SpawnedProcess {
            pid,
            session_id: Some(format!("mock-session-{pid}")),
        })
    }

    fn resume(
        &self,
        session_id: &str,
        config: SpawnConfig,
        _on_output: Box<dyn Fn() + Send>,
    ) -> Result<SpawnedProcess> {
        self.spawn_calls.write().unwrap().push(SpawnCall {
            prompt: config.stdin_content.to_string(),
            cwd: config.cwd.to_path_buf(),
            is_resume: true,
            resume_session_id: Some(session_id.to_string()),
        });

        let pid = self.next_pid.fetch_add(1, Ordering::SeqCst);
        self.processes_running.write().unwrap().insert(pid, true);

        Ok(SpawnedProcess {
            pid,
            session_id: Some(session_id.to_string()),
        })
    }

    fn is_running(&self, pid: u32) -> bool {
        self.processes_running
            .read()
            .unwrap()
            .get(&pid)
            .copied()
            .unwrap_or(false)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::path::Path;

    #[test]
    fn test_spawn_records_call() {
        let spawner = MockProcessSpawner::new();

        let config = SpawnConfig {
            args: &["--print"],
            cwd: Path::new("/test"),
            stdin_content: "Test prompt",
        };

        let result = spawner.spawn(config, Box::new(|| {})).unwrap();

        assert!(result.pid >= 1000);
        assert!(result.session_id.is_some());
        assert_eq!(spawner.call_count(), 1);

        let call = spawner.last_call().unwrap();
        assert_eq!(call.prompt, "Test prompt");
        assert!(!call.is_resume);
    }

    #[test]
    fn test_process_lifecycle() {
        let spawner = MockProcessSpawner::new();

        let config = SpawnConfig {
            args: &[],
            cwd: Path::new("/"),
            stdin_content: "",
        };

        let result = spawner.spawn(config, Box::new(|| {})).unwrap();

        assert!(spawner.is_running(result.pid));
        spawner.finish_process(result.pid);
        assert!(!spawner.is_running(result.pid));
    }

    #[test]
    fn test_resume_marks_as_resume() {
        let spawner = MockProcessSpawner::new();

        let config = SpawnConfig {
            args: &[],
            cwd: Path::new("/"),
            stdin_content: "Continue",
        };

        spawner
            .resume("session-123", config, Box::new(|| {}))
            .unwrap();

        let call = spawner.last_call().unwrap();
        assert!(call.is_resume);
        assert_eq!(call.resume_session_id, Some("session-123".to_string()));
    }
}
