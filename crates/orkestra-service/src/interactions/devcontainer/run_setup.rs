//! Run post-creation setup inside a container.

use std::io::Read;
use std::path::Path;
use std::process::{Command, Stdio};
use std::thread;
use std::time::{Duration, Instant};

use crate::types::{DevcontainerConfig, ServiceError};

/// Run the `postCreateCommand` inside `container_id`, if one is configured.
///
/// For `DevcontainerConfig::Default`, runs `mise install` when a `.mise.toml`
/// is found in the project root.
pub fn execute(
    container_id: &str,
    config: &DevcontainerConfig,
    repo_path: &Path,
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
        docker_exec(container_id, cmd)?;
    }

    Ok(())
}

// -- Helpers --

const TIMEOUT: Duration = Duration::from_secs(600);

fn docker_exec(container_id: &str, cmd: &str) -> Result<(), ServiceError> {
    let mut child = Command::new("docker")
        .args(["exec", container_id, "sh", "-c", cmd])
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|e| ServiceError::Other(format!("Failed to run `docker exec`: {e}")))?;

    let stderr_handle = child.stderr.take().expect("stderr was piped");
    let stderr_thread = std::thread::spawn(move || {
        let mut buf = Vec::new();
        let mut handle = stderr_handle;
        let _ = handle.read_to_end(&mut buf);
        buf
    });

    let deadline = Instant::now() + TIMEOUT;

    loop {
        match child.try_wait() {
            Ok(Some(status)) => {
                let stderr_bytes = stderr_thread.join().unwrap_or_default();
                if status.success() {
                    return Ok(());
                }
                let stderr = String::from_utf8_lossy(&stderr_bytes);
                return Err(ServiceError::Other(format!(
                    "Container setup command failed: {stderr}"
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
