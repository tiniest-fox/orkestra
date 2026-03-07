//! Run post-creation setup inside a container.

use std::path::Path;
use std::process::Command;

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

fn docker_exec(container_id: &str, cmd: &str) -> Result<(), ServiceError> {
    let output = Command::new("docker")
        .args(["exec", container_id, "sh", "-c", cmd])
        .stdin(std::process::Stdio::null())
        .stdout(std::process::Stdio::null())
        .stderr(std::process::Stdio::piped())
        .output()
        .map_err(|e| ServiceError::Other(format!("Failed to run `docker exec`: {e}")))?;

    if output.status.success() {
        Ok(())
    } else {
        let stderr = String::from_utf8_lossy(&output.stderr);
        Err(ServiceError::Other(format!(
            "Container setup command failed: {stderr}"
        )))
    }
}
