//! Start a Docker container (or Compose service) for a project.

use std::path::Path;
use std::process::Command;

use crate::types::{DevcontainerConfig, ServiceError};

/// Start the container and return its Docker container ID.
///
/// For `Default`/`Image`/`Build`: runs `docker run -d` with port mapping and
/// a bind-mount for the repo. The `orkd` binary is injected separately after
/// creation via `inject_orkd::execute`.
///
/// For `Compose`: writes an override file that injects the port mapping, then
/// runs `docker compose up -d` and inspects the container ID.
///
/// `override_dir` — host directory used for the compose override file
/// (created if it does not exist).
pub fn execute(
    project_id: &str,
    config: &DevcontainerConfig,
    image: &str,
    repo_path: &Path,
    port: u16,
    override_dir: &Path,
) -> Result<String, ServiceError> {
    match config {
        DevcontainerConfig::Default
        | DevcontainerConfig::Image { .. }
        | DevcontainerConfig::Build { .. } => docker_run(project_id, image, repo_path, port),
        DevcontainerConfig::Compose {
            compose_file,
            service,
            ..
        } => {
            let compose_path = repo_path.join(compose_file);
            compose_up(project_id, &compose_path, service, port, override_dir)
        }
    }
}

// -- Helpers --

fn docker_run(
    project_id: &str,
    image: &str,
    repo_path: &Path,
    port: u16,
) -> Result<String, ServiceError> {
    let container_name = format!("orkestra-{project_id}");

    // Mount the host Claude auth directory if the operator has specified one.
    // In DooD, bind mounts use HOST paths, so the env var must hold the path
    // on the host filesystem (not the service container's filesystem).
    // Set CLAUDE_AUTH_DIR on the service container to enable this.
    //
    // Target is /home/orkestra/.claude because orkd runs as uid 1000 (orkestra)
    // and claude CLI resolves config from $HOME/.claude.
    // Mount read-write so claude can refresh tokens and write session state.
    let claude_auth_mount = std::env::var("CLAUDE_AUTH_DIR")
        .ok()
        .map(|dir| format!("{dir}:/home/orkestra/.claude"));
    let workspace_mount = format!("{}:/workspace", repo_path.display());
    let port_bind = format!("127.0.0.1:{port}:{port}");

    // Forward git author identity into the container using git's native env vars.
    // GIT_USER_EMAIL / GIT_USER_NAME can be set on the service container to
    // control commit attribution. Falls back to the Dockerfile-baked git config.
    let git_email =
        std::env::var("GIT_USER_EMAIL").unwrap_or_else(|_| "agent@orkestra.local".to_string());
    let git_name = std::env::var("GIT_USER_NAME").unwrap_or_else(|_| "Orkestra Agent".to_string());
    let git_author_email = format!("GIT_AUTHOR_EMAIL={git_email}");
    let git_committer_email = format!("GIT_COMMITTER_EMAIL={git_email}");
    let git_author_name = format!("GIT_AUTHOR_NAME={git_name}");
    let git_committer_name = format!("GIT_COMMITTER_NAME={git_name}");

    let mut args = vec![
        "run",
        "-d",
        "--name",
        &container_name,
        "-v",
        &workspace_mount,
        "-p",
        &port_bind,
        "-w",
        "/workspace",
        "-e",
        &git_author_email,
        "-e",
        &git_committer_email,
        "-e",
        &git_author_name,
        "-e",
        &git_committer_name,
    ];

    if let Some(ref mount) = claude_auth_mount {
        args.push("-v");
        args.push(mount);
    }

    // Forward GH_TOKEN so the git credential helper can authenticate pushes.
    let gh_token_env = std::env::var("GH_TOKEN")
        .ok()
        .map(|t| format!("GH_TOKEN={t}"));
    if let Some(ref token) = gh_token_env {
        args.push("-e");
        args.push(token);
    }

    args.extend_from_slice(&[image, "sleep", "infinity"]);

    let output = Command::new("docker")
        .args(&args)
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
    port: u16,
    override_dir: &Path,
) -> Result<String, ServiceError> {
    std::fs::create_dir_all(override_dir)
        .map_err(|e| ServiceError::Other(format!("Failed to create override dir: {e}")))?;

    let override_path = override_dir.join("orkestra-override.yml");
    let override_content =
        format!("services:\n  {service}:\n    ports:\n      - \"127.0.0.1:{port}:{port}\"\n");
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
