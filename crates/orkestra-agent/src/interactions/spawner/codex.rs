//! Codex CLI process spawner adapter.

use std::io::Write;
use std::path::Path;
use std::process::{Command, Stdio};

#[cfg(unix)]
use std::os::unix::process::CommandExt;

use tempfile::NamedTempFile;

use orkestra_process::{ProcessConfig, ProcessError, ProcessHandle, ProcessSpawner};

use crate::orkestra_debug;

// ============================================================================
// Codex Process Spawner
// ============================================================================

/// Spawner for Codex CLI processes.
///
/// This is the production implementation of `ProcessSpawner` for the Codex CLI.
/// It spawns `codex exec` in non-interactive mode with `--json` for structured
/// JSONL event output.
///
/// Key differences from Claude Code and `OpenCode`:
/// - Uses `codex exec` for fresh sessions, `codex exec resume <id> -` to resume
/// - Session ID is extracted from the `thread.started` JSONL event (like `OpenCode`)
/// - Structured output uses file-based `--output-schema`, not an inline flag
/// - No system prompt flag (`--system` is not supported)
/// - Resume does not use `-C`; CWD is set via `cmd.current_dir()` instead
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
        if config.system_prompt.is_some() {
            orkestra_debug!(
                "codex",
                "WARNING: system_prompt is Some but Codex does not support it; ignoring"
            );
        }

        if !config.disallowed_tools.is_empty() {
            orkestra_debug!(
                "codex",
                "WARNING: disallowed_tools configured but Codex does not support --disallowedTools flag; relying on prompt-level restrictions only"
            );
        }

        let mut cmd = Command::new("codex");
        cmd.arg("exec");

        if config.is_resume {
            // Resume: `codex exec resume <session-id> -`
            // The `-` tells Codex to read the continuation prompt from stdin.
            // No `-C` flag — CWD is set via cmd.current_dir() below.
            if let Some(ref sid) = config.session_id {
                cmd.args(["resume", sid, "-"]);
            }
        } else {
            // Fresh: set the working directory via the -C flag (in addition to current_dir).
            cmd.arg("-C");
            cmd.arg(working_dir);
        }

        // Request JSONL event output
        cmd.arg("--json");

        // Pass model if specified
        if let Some(ref model) = config.model {
            cmd.args(["-m", model]);
        }

        // Bypass approval system and ignore user/project config
        cmd.args([
            "--dangerously-bypass-approvals-and-sandbox",
            "--ignore-rules",
            "--ignore-user-config",
        ]);

        // Structured output: write schema to a temp file that outlives this call.
        // NamedTempFile::into_temp_path().keep() persists the file in the OS temp dir,
        // avoiding lifetime issues with ProcessHandle which outlives this function.
        if let Some(ref schema) = config.json_schema {
            let mut tmpfile = NamedTempFile::new()
                .map_err(|e| ProcessError::SpawnFailed(format!("codex schema temp file: {e}")))?;
            tmpfile
                .write_all(schema.as_bytes())
                .map_err(|e| ProcessError::SpawnFailed(format!("codex schema write: {e}")))?;
            let schema_path = tmpfile
                .into_temp_path()
                .keep()
                .map_err(|e| ProcessError::SpawnFailed(format!("codex schema persist: {e}")))?;
            cmd.args(["--output-schema", &schema_path.to_string_lossy()]);
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
    fn codex_process_spawner_new() {
        let spawner = CodexProcessSpawner::new();
        let _ = spawner;
    }

    #[test]
    fn codex_process_spawner_default() {
        let spawner = CodexProcessSpawner;
        let _ = spawner;
    }
}
