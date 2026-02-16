//! Process spawner trait for agent process backends.

use std::path::Path;

use crate::types::{ProcessConfig, ProcessError, ProcessHandle};

/// Port for spawning agent processes.
///
/// This trait abstracts over the actual process spawning mechanism,
/// allowing different implementations:
/// - `ClaudeProcessSpawner`: Spawns real `claude` CLI processes
/// - `OpenCodeProcessSpawner`: Spawns real `opencode` CLI processes
/// - `MockProcessSpawner`: Returns canned output for testing
pub trait ProcessSpawner: Send + Sync {
    /// Spawn an agent process.
    ///
    /// # Arguments
    /// * `working_dir` - Working directory for the process
    /// * `config` - Process configuration (resume session, JSON schema)
    ///
    /// # Returns
    /// A handle to the spawned process with access to stdin/stdout.
    fn spawn(
        &self,
        working_dir: &Path,
        config: ProcessConfig,
    ) -> Result<ProcessHandle, ProcessError>;
}
