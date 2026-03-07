//! Start a Docker container (or Compose service) for a project.

use std::path::Path;
use std::process::Command;

use crate::types::{DevcontainerConfig, ServiceError};

/// Start the container and return its Docker container ID.
///
/// For `Default`/`Image`/`Build`: runs `docker run -d` with port mapping and
/// bind-mounts for the repo and the `orkd` binary.
///
/// For `Compose`: writes an override file that injects the port mapping and
/// `orkd` mount, then runs `docker compose up -d` and inspects the container ID.
///
/// `override_dir` — host directory used for the compose override file
/// (created if it does not exist).
#[allow(clippy::too_many_arguments)]
pub fn execute(
    project_id: &str,
    config: &DevcontainerConfig,
    image: &str,
    repo_path: &Path,
    orkd_path: &Path,
    port: u16,
    override_dir: &Path,
) -> Result<String, ServiceError> {
    match config {
        DevcontainerConfig::Default
        | DevcontainerConfig::Image { .. }
        | DevcontainerConfig::Build { .. } => {
            docker_run(project_id, image, repo_path, orkd_path, port)
        }
        DevcontainerConfig::Compose {
            compose_file,
            service,
            ..
        } => {
            let compose_path = repo_path.join(compose_file);
            compose_up(
                project_id,
                &compose_path,
                service,
                orkd_path,
                port,
                override_dir,
            )
        }
    }
}

// -- Helpers --

fn docker_run(
    project_id: &str,
    image: &str,
    repo_path: &Path,
    orkd_path: &Path,
    port: u16,
) -> Result<String, ServiceError> {
    let container_name = format!("orkestra-{project_id}");

    let output = Command::new("docker")
        .args([
            "run",
            "-d",
            "--name",
            &container_name,
            "-v",
            &format!("{}:/workspace", repo_path.display()),
            "-v",
            &format!("{}:/usr/local/bin/orkd:ro", orkd_path.display()),
            "-p",
            &format!("127.0.0.1:{port}:{port}"),
            "-w",
            "/workspace",
            image,
            "sleep",
            "infinity",
        ])
        .stdin(std::process::Stdio::null())
        .stdout(std::process::Stdio::piped())
        .stderr(std::process::Stdio::piped())
        .output()
        .map_err(|e| ServiceError::Other(format!("Failed to run `docker run`: {e}")))?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        return Err(ServiceError::Other(format!(
            "`docker run` failed: {stderr}"
        )));
    }

    let container_id = String::from_utf8_lossy(&output.stdout).trim().to_string();
    Ok(container_id)
}

fn compose_up(
    project_id: &str,
    compose_file: &Path,
    service: &str,
    orkd_path: &Path,
    port: u16,
    override_dir: &Path,
) -> Result<String, ServiceError> {
    std::fs::create_dir_all(override_dir)
        .map_err(|e| ServiceError::Other(format!("Failed to create override dir: {e}")))?;

    let override_path = override_dir.join("orkestra-override.yml");
    let override_content = format!(
        "services:\n  {service}:\n    ports:\n      - \"127.0.0.1:{port}:{port}\"\n    volumes:\n      - \"{orkd}:/usr/local/bin/orkd:ro\"\n",
        service = service,
        port = port,
        orkd = orkd_path.display(),
    );
    std::fs::write(&override_path, override_content)
        .map_err(|e| ServiceError::Other(format!("Failed to write compose override: {e}")))?;

    let output = Command::new("docker")
        .args([
            "compose",
            "-f",
            &compose_file.display().to_string(),
            "-f",
            &override_path.display().to_string(),
            "--project-name",
            &format!("orkestra-{project_id}"),
            "up",
            "-d",
        ])
        .stdin(std::process::Stdio::null())
        .stdout(std::process::Stdio::null())
        .stderr(std::process::Stdio::piped())
        .output()
        .map_err(|e| ServiceError::Other(format!("Failed to run `docker compose up`: {e}")))?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        return Err(ServiceError::Other(format!(
            "`docker compose up` failed: {stderr}"
        )));
    }

    // Get the container ID for the named service.
    let output = Command::new("docker")
        .args([
            "compose",
            "-f",
            &compose_file.display().to_string(),
            "-f",
            &override_path.display().to_string(),
            "--project-name",
            &format!("orkestra-{project_id}"),
            "ps",
            "-q",
            service,
        ])
        .stdin(std::process::Stdio::null())
        .stdout(std::process::Stdio::piped())
        .stderr(std::process::Stdio::piped())
        .output()
        .map_err(|e| ServiceError::Other(format!("Failed to run `docker compose ps`: {e}")))?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        return Err(ServiceError::Other(format!(
            "`docker compose ps -q {service}` failed: {stderr}"
        )));
    }

    let container_id = String::from_utf8_lossy(&output.stdout).trim().to_string();
    if container_id.is_empty() {
        return Err(ServiceError::Other(format!(
            "docker compose ps -q {service} returned no container ID"
        )));
    }

    Ok(container_id)
}
