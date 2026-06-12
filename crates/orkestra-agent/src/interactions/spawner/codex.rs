//! Codex process spawner adapter.

use std::path::Path;
use std::process::{Command, Stdio};

#[cfg(unix)]
use std::os::unix::process::CommandExt;

use orkestra_process::{ProcessConfig, ProcessError, ProcessHandle, ProcessSpawner};

use crate::orkestra_debug;

// ============================================================================
// Codex Process Spawner
// ============================================================================

/// Spawner for `OpenAI` Codex CLI processes.
///
/// This is the production implementation of `ProcessSpawner` for the
/// Codex CLI. It spawns `codex` in non-interactive (`--full-auto`) mode.
///
/// Key differences from Claude Code:
/// - Uses `codex --full-auto` instead of `claude`
/// - Does not support session resume
/// - Does not support native `--json-schema` enforcement
/// - Does not support system prompts via CLI flags
/// - Does not support disallowed tools via CLI flags
pub struct CodexProcessSpawner;

impl CodexProcessSpawner {
    /// Create a new Codex process spawner.
    pub fn new() -> Self {
        Self
    }
}

impl Default for CodexProcessSpawner {
    fn default() -> Self {
        Self::new()
    }
}

impl ProcessSpawner for CodexProcessSpawner {
    fn spawn(
        &self,
        working_dir: &Path,
        config: ProcessConfig,
    ) -> Result<ProcessHandle, ProcessError> {
        // Codex does NOT support system prompts via CLI flags.
        if config.system_prompt.is_some() {
            orkestra_debug!(
                "codex",
                "WARNING: system_prompt is Some but Codex does not support it; ignoring"
            );
        }

        // Codex does NOT support disallowed_tools via CLI flags.
        if !config.disallowed_tools.is_empty() {
            orkestra_debug!(
                "codex",
                "WARNING: disallowed_tools configured but Codex does not support --disallowedTools flag; relying on prompt-level restrictions only"
            );
        }

        // Codex does NOT support session resume.
        if config.is_resume {
            orkestra_debug!(
                "codex",
                "WARNING: is_resume=true but Codex does not support session resume; starting fresh"
            );
        }

        let mut cmd = Command::new("codex");

        // Non-interactive full-auto mode (no approval prompts)
        cmd.arg("--full-auto");

        // Pass model if specified
        if let Some(ref model) = config.model {
            cmd.args(["--model", model]);
        }

        // Apply environment when resolved: env_clear + envs replaces inherited env.
        // When None, prepend ork CLI dir to PATH for discoverability.
        if let Some(ref env_map) = config.env {
            cmd.env_clear();
            cmd.envs(env_map);
        } else {
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

        let mut child = cmd.spawn().map_err(|e| {
            let path = config
                .env
                .as_ref()
                .and_then(|m| m.get("PATH").cloned())
                .unwrap_or_else(|| std::env::var("PATH").unwrap_or_else(|_| "<not set>".into()));
            ProcessError::SpawnFailed(format!("command=codex PATH={path}: {e}"))
        })?;

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
    fn test_codex_process_spawner_default() {
        let spawner = CodexProcessSpawner;
        let _ = spawner;
    }

    #[test]
    fn test_codex_process_spawner_new() {
        let spawner = CodexProcessSpawner::new();
        let _ = spawner;
    }
}
