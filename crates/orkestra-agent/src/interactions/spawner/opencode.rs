//! `OpenCode` process spawner adapter.

use std::path::Path;
use std::process::{Command, Stdio};

#[cfg(unix)]
use std::os::unix::process::CommandExt;

use orkestra_process::{ProcessConfig, ProcessError, ProcessHandle, ProcessSpawner};

use crate::orkestra_debug;

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
        // Note: OpenCode does NOT support system prompts via CLI flags.
        // The fallback concatenation (prepending system prompt to user message)
        // already happened in agent_execution.rs, so config.system_prompt will be None.
        // We simply ignore the field here as per the design.
        if config.system_prompt.is_some() {
            orkestra_debug!(
                "opencode",
                "WARNING: system_prompt is Some but OpenCode does not support it; ignoring"
            );
        }

        // Note: OpenCode does NOT support disallowed_tools via CLI flags.
        // The restriction messages are injected into the system prompt upstream,
        // but CLI-level enforcement (like Claude Code's --disallowedTools) is not available.
        if !config.disallowed_tools.is_empty() {
            orkestra_debug!(
                "opencode",
                "WARNING: disallowed_tools configured but OpenCode does not support --disallowedTools flag; relying on prompt-level restrictions only"
            );
        }

        let mut cmd = Command::new("opencode");

        // Non-interactive run mode
        cmd.arg("run");

        // Pass session ID only when resuming.
        // Unlike Claude Code, OpenCode generates its own session IDs on first run.
        // The --session flag means "continue this session", not "create with this ID".
        if config.is_resume {
            if let Some(ref sid) = config.session_id {
                cmd.args(["--session", sid]);
            }
        }

        // Pass model if specified
        if let Some(ref model) = config.model {
            cmd.args(["--model", model]);
        }

        // Request JSON event output and log internal state to stderr
        cmd.args(["--format", "json", "--print-logs"]);

        // Apply environment when resolved: env_clear + envs replaces inherited env.
        // When None, prepend ork CLI dir to PATH for discoverability (matches Claude spawner).
        if let Some(ref env_map) = config.env {
            cmd.env_clear();
            cmd.envs(env_map);
        } else {
            // Prepend ork CLI dir to PATH for discoverability (matches Claude spawner)
            let path_env = super::cli_path::prepare_path_env();
            cmd.env("PATH", &path_env);
        }

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

// ============================================================================
// Tests
// ============================================================================

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
