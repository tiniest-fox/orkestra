//! `OpenCode` process spawner adapter.
//!
//! This adapter implements the `ProcessSpawner` trait for spawning
//! `OpenCode` CLI processes in non-interactive mode.

use std::path::Path;
use std::process::{Command, Stdio};

#[cfg(unix)]
use std::os::unix::process::CommandExt;

use crate::workflow::ports::{ProcessConfig, ProcessError, ProcessHandle, ProcessSpawner};

// ============================================================================
// OpenCode Process Spawner
// ============================================================================

/// Spawner for `OpenCode` CLI processes.
///
/// This is the production implementation of `ProcessSpawner` for the
/// `OpenCode` CLI. It spawns `opencode run` in non-interactive mode with
/// `--format json` for structured output.
///
/// Key differences from Claude Code:
/// - Uses `opencode run` subcommand instead of `claude`
/// - Session resume uses `--continue` instead of `--resume`
/// - Does not support native `--json-schema` enforcement
/// - Uses `--format json` for JSON event output
pub struct OpenCodeProcessSpawner;

impl OpenCodeProcessSpawner {
    /// Create a new `OpenCode` process spawner.
    pub fn new() -> Self {
        Self
    }
}

impl Default for OpenCodeProcessSpawner {
    fn default() -> Self {
        Self::new()
    }
}

impl ProcessSpawner for OpenCodeProcessSpawner {
    fn spawn(
        &self,
        working_dir: &Path,
        config: ProcessConfig,
    ) -> Result<ProcessHandle, ProcessError> {
        let mut cmd = Command::new("opencode");

        // Non-interactive run mode
        cmd.arg("run");

        // Pass session ID with appropriate flag
        if let Some(ref sid) = config.session_id {
            if config.is_resume {
                cmd.args(["--continue", sid]);
            } else {
                cmd.args(["--session", sid]);
            }
        }

        // Pass model if specified
        if let Some(ref model) = config.model {
            cmd.args(["--model", model]);
        }

        // Request JSON event output
        cmd.args(["--format", "json"]);

        cmd.current_dir(working_dir)
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped());

        // Create new process group so we can kill all descendants
        #[cfg(unix)]
        cmd.process_group(0);

        let mut child = cmd
            .spawn()
            .map_err(|e| ProcessError::SpawnFailed(e.to_string()))?;

        let pid = child.id();

        let stdin = child
            .stdin
            .take()
            .ok_or_else(|| ProcessError::SpawnFailed("No stdin handle".to_string()))?;

        let stdout = child
            .stdout
            .take()
            .ok_or_else(|| ProcessError::SpawnFailed("No stdout handle".to_string()))?;

        let stderr = child.stderr.take();

        Ok(ProcessHandle::new(pid, stdin, stdout, stderr))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_opencode_process_spawner_default() {
        let spawner = OpenCodeProcessSpawner;
        let _ = spawner;
    }

    #[test]
    fn test_opencode_process_spawner_new() {
        let spawner = OpenCodeProcessSpawner::new();
        let _ = spawner;
    }
}
