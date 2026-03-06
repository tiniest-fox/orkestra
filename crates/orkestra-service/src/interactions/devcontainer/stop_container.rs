//! Stop and remove a project's Docker container (or Compose services).

use std::path::Path;
use std::process::Command;

use crate::types::{DevcontainerConfig, ServiceError};

/// Stop and remove the container.
///
/// - `Default`/`Image`/`Build`: `docker stop {container_id}` then `docker rm {container_id}`
/// - `Compose`: `docker compose -f {compose_file} -f {override_file} down`
///
/// `compose_file` is only required for `Compose` configs.
pub fn execute(
    config: &DevcontainerConfig,
    container_id: &str,
    compose_file: Option<&Path>,
    override_dir: &Path,
) -> Result<(), ServiceError> {
    match config {
        DevcontainerConfig::Default
        | DevcontainerConfig::Image { .. }
        | DevcontainerConfig::Build { .. } => docker_stop_and_rm(container_id),

        DevcontainerConfig::Compose { service, .. } => {
            let compose_path = compose_file.ok_or_else(|| {
                ServiceError::Other("compose_file required for Compose stop".into())
            })?;
            let override_path = override_dir.join("orkestra-override.yml");
            // Derive the project name from the container ID prefix or use the
            // well-known format. We pass --project-name to match how the
            // compose project was started.
            let project_name = compose_project_name_from_container(container_id);
            compose_down(compose_path, &override_path, &project_name, service)
        }
    }
}

// -- Helpers --

fn docker_stop_and_rm(container_id: &str) -> Result<(), ServiceError> {
    // Stop (best-effort — may already be stopped).
    let _ = Command::new("docker")
        .args(["stop", container_id])
        .stdin(std::process::Stdio::null())
        .stdout(std::process::Stdio::null())
        .stderr(std::process::Stdio::null())
        .status();

    // Remove.
    let status = Command::new("docker")
        .args(["rm", "-f", container_id])
        .stdin(std::process::Stdio::null())
        .stdout(std::process::Stdio::null())
        .stderr(std::process::Stdio::null())
        .status()?;

    if status.success() {
        Ok(())
    } else {
        Err(ServiceError::Other(format!(
            "docker rm {container_id} failed with exit code {}",
            status.code().unwrap_or(-1)
        )))
    }
}

fn compose_down(
    compose_file: &Path,
    override_path: &Path,
    project_name: &str,
    _service: &str,
) -> Result<(), ServiceError> {
    let mut args = vec!["compose", "-f", compose_file.to_str().unwrap_or("")];

    if override_path.exists() {
        args.extend(["-f", override_path.to_str().unwrap_or("")]);
    }

    args.extend(["--project-name", project_name, "down"]);

    let status = Command::new("docker")
        .args(&args)
        .stdin(std::process::Stdio::null())
        .stdout(std::process::Stdio::null())
        .stderr(std::process::Stdio::null())
        .status()?;

    if status.success() {
        Ok(())
    } else {
        Err(ServiceError::Other(format!(
            "docker compose down failed with exit code {}",
            status.code().unwrap_or(-1)
        )))
    }
}

/// Derive the compose project name from a stored `container_id`.
///
/// Container IDs are the full SHA256. We stored the `project_name` under the
/// format `orkestra-{project_id}` when starting, so we can re-derive it if we
/// have the `project_id`. However, this function receives a `container_id` that
/// is opaque — we use `docker inspect` to find the project label.
fn compose_project_name_from_container(container_id: &str) -> String {
    // Attempt to read the compose project label from the container.
    if let Ok(output) = Command::new("docker")
        .args([
            "inspect",
            "--format",
            "{{index .Config.Labels \"com.docker.compose.project\"}}",
            container_id,
        ])
        .stdin(std::process::Stdio::null())
        .stdout(std::process::Stdio::piped())
        .stderr(std::process::Stdio::null())
        .output()
    {
        let name = String::from_utf8_lossy(&output.stdout).trim().to_string();
        if !name.is_empty() {
            return name;
        }
    }

    // Fall back to an empty string (compose will pick the directory name).
    String::new()
}
