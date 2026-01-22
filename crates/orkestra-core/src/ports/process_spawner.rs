use std::path::Path;
use crate::error::Result;

/// Result of spawning a process.
#[derive(Debug)]
pub struct SpawnedProcess {
    pub pid: u32,
    pub session_id: Option<String>,
}

/// Configuration for spawning a process.
pub struct SpawnConfig<'a> {
    pub args: &'a [&'a str],
    pub cwd: &'a Path,
    pub stdin_content: &'a str,
}

/// Abstraction over process spawning.
///
/// This trait allows the agent service to work with different process spawning
/// mechanisms and enables testing without actually spawning processes.
pub trait ProcessSpawner: Send + Sync {
    /// Spawn a process with the given configuration.
    ///
    /// The `on_output` callback is invoked when meaningful output is received.
    fn spawn(&self, config: SpawnConfig, on_output: Box<dyn Fn() + Send>) -> Result<SpawnedProcess>;

    /// Spawn a process and wait for the session ID.
    ///
    /// This is used when we need the session ID before returning (e.g., for resume support).
    fn spawn_and_wait_for_session(
        &self,
        config: SpawnConfig,
        timeout_secs: u64,
    ) -> Result<SpawnedProcess>;

    /// Resume an existing session with a continuation prompt.
    fn resume(
        &self,
        session_id: &str,
        config: SpawnConfig,
        on_output: Box<dyn Fn() + Send>,
    ) -> Result<SpawnedProcess>;

    /// Check if a process is still running.
    fn is_running(&self, pid: u32) -> bool;
}
