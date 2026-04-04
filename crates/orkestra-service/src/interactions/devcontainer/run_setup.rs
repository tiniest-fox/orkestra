//! Run post-creation setup inside a container.

use std::io::{BufRead, BufReader, Write};
use std::path::Path;
use std::process::{Command, Stdio};
use std::thread;
use std::time::{Duration, Instant};

use crate::types::{DevcontainerConfig, ServiceError};

/// Run the `postCreateCommand` inside `container_id`, if one is configured.
///
/// For `DevcontainerConfig::Default`, runs `mise install` when a `.mise.toml`
/// is found in the project root.
///
/// If `log_path` is provided, the command's stdout and stderr are streamed to
/// that file in real time so users can see setup progress.
pub fn execute(
    container_id: &str,
    config: &DevcontainerConfig,
    repo_path: &Path,
    log_path: Option<&Path>,
) -> Result<(), ServiceError> {
    let cmd = match config {
        DevcontainerConfig::Image {
            post_create_command: Some(cmd),
            ..
        }
        | DevcontainerConfig::Build {
            post_create_command: Some(cmd),
            ..
        }
        | DevcontainerConfig::Compose {
            post_create_command: Some(cmd),
            ..
        } => Some(cmd.as_str()),

        DevcontainerConfig::Default => {
            // Run mise install if the project declares tool versions.
            if repo_path.join(".mise.toml").exists() {
                Some("mise install")
            } else {
                None
            }
        }

        _ => None,
    };

    if let Some(cmd) = cmd {
        if let Some(lp) = log_path {
            append_log(lp, &format!("$ {cmd}"));
        }
        docker_exec(container_id, cmd, log_path)?;
    }

    Ok(())
}

// -- Helpers --

const TIMEOUT: Duration = Duration::from_secs(1800);

fn docker_exec(container_id: &str, cmd: &str, log_path: Option<&Path>) -> Result<(), ServiceError> {
    let mut child = Command::new("docker")
        .args(["exec", container_id, "sh", "-c", cmd])
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|e| ServiceError::Other(format!("Failed to run `docker exec`: {e}")))?;

    let stdout_handle = child.stdout.take().expect("stdout was piped");
    let stderr_handle = child.stderr.take().expect("stderr was piped");

    // Stream both stdout and stderr to the log file concurrently.
    let stdout_thread = stream_to_log(stdout_handle, log_path);
    let stderr_thread = stream_to_log(stderr_handle, log_path);

    let deadline = Instant::now() + TIMEOUT;

    loop {
        match child.try_wait() {
            Ok(Some(status)) => {
                let stdout_out = stdout_thread.join().unwrap_or_default();
                let stderr_out = stderr_thread.join().unwrap_or_default();
                if status.success() {
                    return Ok(());
                }
                // Prefer stderr for the error message since it usually has the
                // relevant failure detail; fall back to stdout if stderr is empty.
                let detail = if stderr_out.trim().is_empty() {
                    stdout_out
                } else {
                    stderr_out
                };
                return Err(ServiceError::Other(format!(
                    "Container setup command failed: {detail}"
                )));
            }
            Ok(None) => {
                if Instant::now() >= deadline {
                    let _ = child.kill();
                    let _ = child.wait();
                    return Err(ServiceError::Other(format!(
                        "Container setup command timed out after {} minutes: {cmd}",
                        TIMEOUT.as_secs() / 60
                    )));
                }
                thread::sleep(Duration::from_secs(1));
            }
            Err(e) => {
                return Err(ServiceError::Other(format!(
                    "Failed to wait on docker exec: {e}"
                )))
            }
        }
    }
}

/// Spawn a thread that reads `reader` line by line, writing each line to
/// `log_path` (if provided) and accumulating for error reporting.
fn stream_to_log(
    reader: impl std::io::Read + Send + 'static,
    log_path: Option<&Path>,
) -> thread::JoinHandle<String> {
    let log_path = log_path.map(Path::to_path_buf);
    thread::spawn(move || {
        let mut accumulated = String::new();
        let mut log_file = log_path.as_deref().and_then(|p| {
            std::fs::OpenOptions::new()
                .create(true)
                .append(true)
                .open(p)
                .ok()
        });
        for line in BufReader::new(reader).lines().map_while(Result::ok) {
            if let Some(ref mut f) = log_file {
                let _ = writeln!(f, "{line}");
            }
            accumulated.push_str(&line);
            accumulated.push('\n');
        }
        accumulated
    })
}

fn append_log(log_path: &Path, line: &str) {
    if let Ok(mut f) = std::fs::OpenOptions::new()
        .create(true)
        .append(true)
        .open(log_path)
    {
        let _ = writeln!(f, "{line}");
    }
}
