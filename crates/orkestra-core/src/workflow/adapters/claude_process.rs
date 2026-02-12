//! Claude Code process spawner adapter.
//!
//! This adapter implements the `ProcessSpawner` trait for spawning
//! actual Claude Code CLI processes.

use std::path::Path;

use crate::process::{prepare_path_env, spawn_claude_process};
use crate::workflow::ports::{ProcessConfig, ProcessError, ProcessHandle, ProcessSpawner};

// ============================================================================
// Claude Process Spawner
// ============================================================================

/// Spawner for Claude Code CLI processes.
///
/// This is the production implementation of `ProcessSpawner` that
/// spawns real `claude` CLI processes.
pub struct ClaudeProcessSpawner;

impl ClaudeProcessSpawner {
    /// Create a new Claude process spawner.
    pub fn new() -> Self {
        Self
    }
}

impl Default for ClaudeProcessSpawner {
    fn default() -> Self {
        Self::new()
    }
}

impl ProcessSpawner for ClaudeProcessSpawner {
    fn spawn(
        &self,
        working_dir: &Path,
        config: ProcessConfig,
    ) -> Result<ProcessHandle, ProcessError> {
        // Prepare PATH with CLI directory
        let path_env = prepare_path_env();

        // Spawn the process
        let mut child = spawn_claude_process(working_dir, &path_env, &config)
            .map_err(|e| ProcessError::SpawnFailed(e.to_string()))?;

        let pid = child.id();

        // Extract stdin/stdout/stderr
        let stdin = child
            .stdin
            .take()
            .ok_or_else(|| ProcessError::SpawnFailed("No stdin handle".to_string()))?;

        let stdout = child
            .stdout
            .take()
            .ok_or_else(|| ProcessError::SpawnFailed("No stdout handle".to_string()))?;

        let stderr = child.stderr.take();

        // Note: The Child is intentionally dropped here. The process continues running
        // and will be managed via the ProcessGuard in ProcessHandle.

        Ok(ProcessHandle::new(pid, stdin, stdout, stderr))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_claude_process_spawner_default() {
        let spawner = ClaudeProcessSpawner;
        // Can't really test spawn without actual claude CLI
        // but we can verify the struct is created
        let _ = spawner;
    }

    // Integration test would require actual claude CLI installed
    // For now, these are tested via the higher-level E2E tests
}
