//! Claude-specific process helpers.
//!
//! Generic process management lives in the `orkestra-process` crate.
//! These Claude-specific helpers move to `orkestra-agent` in Phase 5.

use std::path::{Path, PathBuf};
use std::process::{Child, Command, Stdio};

#[cfg(unix)]
use std::os::unix::process::CommandExt;

// Re-export from orkestra-process for backward compatibility.
// Callers using orkestra_core::process::kill_process_tree etc. still work.
pub use orkestra_process::{
    is_process_running, kill_process_tree, parse_stream_event, spawn_stderr_reader,
    ParsedStreamEvent, ProcessGuard,
};

// ============================================================================
// CLI Path Discovery
// ============================================================================

/// Finds the ork CLI binary path.
pub fn find_cli_path() -> Option<PathBuf> {
    // First check if ork is in PATH
    if let Ok(output) = Command::new("which").arg("ork").output() {
        if output.status.success() {
            let path = String::from_utf8_lossy(&output.stdout).trim().to_string();
            if !path.is_empty() {
                return Some(PathBuf::from(path));
            }
        }
    }

    // Check relative to current directory (development mode)
    let dev_path = std::env::current_dir().ok()?.join("target/debug/ork");
    if dev_path.exists() {
        return Some(dev_path);
    }

    // Check relative to git repo root (for worktrees)
    if let Ok(output) = Command::new("git")
        .args(["rev-parse", "--show-toplevel"])
        .output()
    {
        if output.status.success() {
            let repo_root = String::from_utf8_lossy(&output.stdout).trim().to_string();
            let git_root_path = PathBuf::from(&repo_root).join("target/debug/ork");
            if git_root_path.exists() {
                return Some(git_root_path);
            }
        }
    }

    // Walk up the directory tree looking for target/debug/ork
    if let Ok(cwd) = std::env::current_dir() {
        let mut path = cwd.as_path();
        while let Some(parent) = path.parent() {
            let candidate = parent.join("target/debug/ork");
            if candidate.exists() {
                return Some(candidate);
            }
            path = parent;
        }
    }

    None
}

/// Prepares the PATH environment variable with the CLI directory.
pub fn prepare_path_env() -> String {
    let cli_path = find_cli_path();
    let mut path_env = std::env::var("PATH").unwrap_or_default();
    if let Some(ref cli) = cli_path {
        if let Some(parent) = cli.parent() {
            path_env = format!("{}:{}", parent.display(), path_env);
        }
    }
    path_env
}

// ============================================================================
// Assistant Process Spawning
// ============================================================================

/// Spawns a Claude process for the assistant (free-form chat, no JSON schema).
///
/// # Arguments
/// * `project_root` - Working directory for the process (the actual workspace root)
/// * `path_env` - PATH environment variable value
/// * `session_id` - Session ID (generated upfront). If provided:
///   - `is_resume=false`: passes `--session-id <uuid>` (first spawn)
///   - `is_resume=true`: passes `--resume <uuid>` (continuing session)
/// * `is_resume` - Whether this is resuming an existing session
/// * `system_prompt` - System prompt content (only passed on first spawn)
pub fn spawn_claude_assistant_process(
    project_root: &Path,
    path_env: &str,
    session_id: Option<&str>,
    is_resume: bool,
    system_prompt: &str,
) -> std::io::Result<Child> {
    let mut cmd = Command::new("claude");

    // Pass session ID with appropriate flag
    if let Some(sid) = session_id {
        if is_resume {
            cmd.args(["--resume", sid]);
        } else {
            cmd.args(["--session-id", sid]);
        }
    }

    cmd.args(["--print", "--verbose"]);
    cmd.args(["--output-format", "stream-json"]);
    cmd.args(["--dangerously-skip-permissions"]);

    // Restrict to read-only tools — the assistant investigates and creates
    // Orkestra tasks but never modifies files directly
    cmd.args([
        "--disallowedTools",
        "Edit,Write,NotebookEdit,AskUserQuestion",
    ]);

    // No --json-schema (free-form conversation)

    // System prompt only on first spawn (not resume)
    if !is_resume {
        cmd.args(["--system-prompt", system_prompt]);
    }

    cmd.env("PATH", path_env)
        .env("CLAUDE_CODE_DISABLE_BACKGROUND_TASKS", "1")
        .current_dir(project_root)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());

    // Create new process group so we can kill all descendants
    #[cfg(unix)]
    cmd.process_group(0);

    cmd.spawn()
}

/// Writes prompt to stdin and closes it.
pub fn write_prompt_to_stdin(child: &mut Child, prompt: &str) -> std::io::Result<()> {
    use std::io::Write as IoWrite;
    if let Some(mut stdin) = child.stdin.take() {
        stdin.write_all(prompt.as_bytes())?;
    }
    Ok(())
}
