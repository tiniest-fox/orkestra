//! Claude Code process spawner adapter.

use std::path::Path;
use std::process::{Child, Command, Stdio};

#[cfg(unix)]
use std::os::unix::process::CommandExt;

use orkestra_process::{ProcessConfig, ProcessError, ProcessHandle, ProcessSpawner};

use super::cli_path::prepare_path_env;

// ============================================================================
// Process Spawning
// ============================================================================

/// Spawns a Claude Code process with the given configuration.
fn spawn_claude_process(
    working_dir: &Path,
    path_env: &str,
    config: &ProcessConfig,
) -> std::io::Result<Child> {
    let mut cmd = Command::new("claude");

    // Pass session ID with appropriate flag
    if let Some(ref sid) = config.session_id {
        if config.is_resume {
            cmd.args(["--resume", sid]);
        } else {
            cmd.args(["--session-id", sid]);
        }
    }

    // Pass model flag if specified
    if let Some(ref model_id) = config.model {
        cmd.args(["--model", model_id]);
    }

    cmd.args(["--print", "--verbose", "--effort", "medium"]);

    cmd.args(["--output-format", "stream-json"]);

    // Only pass --json-schema for structured output (not for chat)
    if let Some(ref schema) = config.json_schema {
        cmd.args(["--json-schema", schema]);
    }

    // Append system prompt if provided (appends to Claude Code's built-in system prompt)
    if let Some(ref sp) = config.system_prompt {
        cmd.args(["--append-system-prompt", sp]);
    }

    // Pass disallowed tools if any are configured
    if !config.disallowed_tools.is_empty() {
        let joined = config.disallowed_tools.join(",");
        cmd.args(["--disallowedTools", &joined]);
    }

    cmd.args(["--dangerously-skip-permissions"])
        .env("PATH", path_env)
        .env("CLAUDE_CODE_DISABLE_BACKGROUND_TASKS", "1")
        .current_dir(working_dir)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());

    // Create new process group so we can kill all descendants (cargo, rustc, etc.)
    // when the agent is terminated. Without this, child processes become orphans.
    #[cfg(unix)]
    cmd.process_group(0);

    cmd.spawn()
}

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

// ============================================================================
// Tests
// ============================================================================

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
}
