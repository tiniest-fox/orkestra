use std::path::PathBuf;

use crate::error::Result;
use crate::ports::{ProcessSpawner, SpawnConfig, SpawnedProcess};

/// Service for agent spawning operations.
///
/// This service encapsulates agent-related operations,
/// using an injected `ProcessSpawner` trait for actual process creation.
pub struct AgentService<P: ProcessSpawner> {
    spawner: P,
    project_root: PathBuf,
}

/// Agent types that can be spawned.
#[derive(Debug, Clone, Copy, PartialEq)]
#[allow(dead_code)]
pub enum AgentType {
    Planner,
    Breakdown,
    Worker,
}

impl<P: ProcessSpawner> AgentService<P> {
    pub fn new(spawner: P, project_root: PathBuf) -> Self {
        Self {
            spawner,
            project_root,
        }
    }

    /// Get the base Claude arguments.
    fn base_args() -> Vec<&'static str> {
        vec![
            "--print",
            "--verbose",
            "--output-format",
            "stream-json",
            "--dangerously-skip-permissions",
        ]
    }

    /// Spawn an agent to work on a task.
    pub fn spawn(&self, prompt: &str, on_update: Box<dyn Fn() + Send>) -> Result<SpawnedProcess> {
        let args = Self::base_args();
        let config = SpawnConfig {
            args: &args.clone(),
            cwd: &self.project_root,
            stdin_content: prompt,
        };

        self.spawner.spawn(config, on_update)
    }

    /// Spawn an agent and wait for session initialization.
    pub fn spawn_sync(&self, prompt: &str, timeout_secs: u64) -> Result<SpawnedProcess> {
        let args = Self::base_args();
        let config = SpawnConfig {
            args: &args.clone(),
            cwd: &self.project_root,
            stdin_content: prompt,
        };

        self.spawner
            .spawn_and_wait_for_session(config, timeout_secs)
    }

    /// Resume an existing session with a continuation prompt.
    pub fn resume(
        &self,
        session_id: &str,
        prompt: &str,
        on_update: Box<dyn Fn() + Send>,
    ) -> Result<SpawnedProcess> {
        let args = Self::base_args();
        let config = SpawnConfig {
            args: &args.clone(),
            cwd: &self.project_root,
            stdin_content: prompt,
        };

        self.spawner.resume(session_id, config, on_update)
    }

    /// Check if a process is still running.
    pub fn is_running(&self, pid: u32) -> bool {
        self.spawner.is_running(pid)
    }
}
