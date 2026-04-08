//! Start a Docker container (or Compose service) for a project.

use std::fmt::Write as FmtWrite;
use std::io::{BufRead, BufReader, Write};
use std::path::Path;
use std::process::{Command, Stdio};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

use crate::interactions::devcontainer::ensure_toolbox_volume::{
    TOOLBOX_MOUNT_PATH, TOOLBOX_VOLUME_NAME,
};
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
///
/// `log_path` — if provided, compose stdout/stderr is streamed to this file
/// in real-time so callers can tail it while the command is running.
///
/// `force_build` — passes `--build` to `docker compose up`, forcing a fresh
/// image build even when the cached image is up-to-date. Only effective for
/// `Compose` configs; silently ignored for `Default`/`Image`/`Build` configs
/// (those use `docker run` which has no build step).
///
/// `secrets` — decrypted `(key, value)` pairs to inject as environment
/// variables into the container. Each pair becomes a `-e KEY=VALUE` flag for
/// `docker run`, or a YAML environment entry for `docker compose`.
#[allow(clippy::too_many_arguments)]
pub fn execute(
    project_id: &str,
    config: &DevcontainerConfig,
    image: &str,
    repo_path: &Path,
    port: u16,
    override_dir: &Path,
    log_path: Option<&Path>,
    force_build: bool,
    secrets: &[(String, String)],
) -> Result<String, ServiceError> {
    match config {
        DevcontainerConfig::Default
        | DevcontainerConfig::Image { .. }
        | DevcontainerConfig::Build { .. } => {
            docker_run(project_id, image, repo_path, port, secrets)
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
                port,
                override_dir,
                log_path,
                force_build,
                secrets,
            )
        }
    }
}

// -- Helpers --

/// Separate git-identity secrets (`GIT_USER_NAME`, `GIT_USER_EMAIL`) from
/// regular secrets. Returns `(git_email, git_name, remaining_secrets)` where
/// the git values are `Some` only when found in the input. Found keys are
/// removed from the returned secrets vec to prevent double-injection.
fn extract_git_identity(
    secrets: &[(String, String)],
) -> (Option<String>, Option<String>, Vec<(String, String)>) {
    let mut git_email = None;
    let mut git_name = None;
    let mut remaining = Vec::with_capacity(secrets.len());
    for (key, value) in secrets {
        match key.as_str() {
            "GIT_USER_EMAIL" => git_email = Some(value.clone()),
            "GIT_USER_NAME" => git_name = Some(value.clone()),
            _ => remaining.push((key.clone(), value.clone())),
        }
    }
    (git_email, git_name, remaining)
}

fn docker_run(
    project_id: &str,
    image: &str,
    repo_path: &Path,
    port: u16,
    secrets: &[(String, String)],
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
    // Project secrets GIT_USER_EMAIL / GIT_USER_NAME take precedence; falls back
    // to service-wide env vars, then the Dockerfile-baked git config.
    let (secret_email, secret_name, filtered_secrets) = extract_git_identity(secrets);
    let git_email = secret_email.unwrap_or_else(|| {
        std::env::var("GIT_USER_EMAIL").unwrap_or_else(|_| "agent@orkestra.local".to_string())
    });
    let git_name = secret_name.unwrap_or_else(|| {
        std::env::var("GIT_USER_NAME").unwrap_or_else(|_| "Orkestra Agent".to_string())
    });
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

    // Mount the shared toolbox volume read-only so agents have access to
    // the claude CLI, gh, and other pre-built tools without baking them
    // into the per-project image.
    let toolbox_mount = format!("{TOOLBOX_VOLUME_NAME}:{TOOLBOX_MOUNT_PATH}:ro");
    args.push("-v");
    args.push(&toolbox_mount);

    // Ensure the claude CLI finds auth tokens under /home/orkestra/.claude.
    let home_env = "HOME=/home/orkestra".to_string();
    args.push("-e");
    args.push(&home_env);

    // Forward GH_TOKEN so the git credential helper can authenticate pushes.
    let gh_token_env = std::env::var("GH_TOKEN")
        .ok()
        .map(|t| format!("GH_TOKEN={t}"));
    if let Some(ref token) = gh_token_env {
        args.push("-e");
        args.push(token);
    }

    let secret_envs: Vec<String> = filtered_secrets
        .iter()
        .map(|(k, v)| format!("{k}={v}"))
        .collect();
    for env in &secret_envs {
        args.push("-e");
        args.push(env);
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

#[allow(clippy::too_many_arguments)]
fn compose_up(
    project_id: &str,
    compose_file: &Path,
    service: &str,
    port: u16,
    override_dir: &Path,
    log_path: Option<&Path>,
    force_build: bool,
    secrets: &[(String, String)],
) -> Result<String, ServiceError> {
    // 10 minutes is generous for even the heaviest healthcheck chains.
    const TIMEOUT: Duration = Duration::from_secs(600);

    std::fs::create_dir_all(override_dir)
        .map_err(|e| ServiceError::Other(format!("Failed to create override dir: {e}")))?;

    let override_path = override_dir.join("orkestra-override.yml");
    let override_content = build_compose_override(service, port, secrets);
    std::fs::write(&override_path, override_content)
        .map_err(|e| ServiceError::Other(format!("Failed to write compose override: {e}")))?;

    // Open the log file once and share it between the stdout/stderr reader threads.
    let log_file = log_path.and_then(|p| {
        if let Some(parent) = p.parent() {
            let _ = std::fs::create_dir_all(parent);
        }
        std::fs::OpenOptions::new()
            .create(true)
            .append(true)
            .open(p)
            .ok()
            .map(|f| Arc::new(Mutex::new(f)))
    });

    let compose_file_str = compose_file.display().to_string();
    let override_path_str = override_path.display().to_string();
    let project_name = format!("orkestra-{project_id}");
    let mut args = vec![
        "compose",
        "--progress",
        "plain",
        "-f",
        &compose_file_str,
        "-f",
        &override_path_str,
        "--project-name",
        &project_name,
        "up",
        "-d",
    ];
    if force_build {
        args.push("--build");
    }
    args.push("--remove-orphans");

    let mut child = Command::new("docker")
        .args(&args)
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|e| ServiceError::Other(format!("Failed to run `docker compose up`: {e}")))?;

    let stdout = child.stdout.take().expect("stdout was piped");
    let stderr = child.stderr.take().expect("stderr was piped");

    let stdout_thread = pipe_to_log(stdout, log_file.clone());
    let stderr_thread = pipe_to_log(stderr, log_file);

    // Poll with a timeout rather than blocking indefinitely on wait().
    // docker compose up -d occasionally hangs after all containers are started
    // (a DooD socket round-trip that never completes).
    let deadline = Instant::now() + TIMEOUT;

    let status = loop {
        let maybe = child
            .try_wait()
            .map_err(|e| ServiceError::Other(format!("Failed to poll `docker compose up`: {e}")))?;
        if let Some(s) = maybe {
            break s;
        }
        if Instant::now() >= deadline {
            let _ = child.kill();
            return Err(ServiceError::Other(format!(
                "`docker compose up` did not exit after {} minutes — killed",
                TIMEOUT.as_secs() / 60
            )));
        }
        std::thread::sleep(Duration::from_millis(500));
    };

    let stdout_output = stdout_thread.join().unwrap_or_default();
    let stderr_output = stderr_thread.join().unwrap_or_default();

    if !status.success() {
        return Err(ServiceError::Other(format!(
            "`docker compose up` failed:\n{stdout_output}{stderr_output}"
        )));
    }

    resolve_compose_container_id(compose_file, &override_path, project_id, service)
}

/// Query Docker Compose for the container ID of a named service.
fn resolve_compose_container_id(
    compose_file: &Path,
    override_path: &Path,
    project_id: &str,
    service: &str,
) -> Result<String, ServiceError> {
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
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
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

/// Build the Docker Compose override YAML that injects Orkestra's runtime
/// requirements into the project's app service.
///
/// Mirrors the mounts and environment variables that `docker_run` sets for
/// non-compose containers: toolbox volume, Claude auth directory, git identity,
/// `HOME`, and `GH_TOKEN`.
fn build_compose_override(service: &str, port: u16, secrets: &[(String, String)]) -> String {
    const I: &str = "      "; // 6-space indent for items under a 4-space key

    // Project secrets GIT_USER_EMAIL / GIT_USER_NAME take precedence over
    // service-wide env vars. They are removed from the regular secrets list
    // to prevent double-injection as plain env vars.
    let (secret_email, secret_name, filtered_secrets) = extract_git_identity(secrets);
    let git_email = secret_email.unwrap_or_else(|| {
        std::env::var("GIT_USER_EMAIL").unwrap_or_else(|_| "agent@orkestra.local".to_string())
    });
    let git_name = secret_name.unwrap_or_else(|| {
        std::env::var("GIT_USER_NAME").unwrap_or_else(|_| "Orkestra Agent".to_string())
    });
    let claude_auth_dir = std::env::var("CLAUDE_AUTH_DIR").ok();
    let gh_token = std::env::var("GH_TOKEN").ok();

    let mut volumes = String::new();
    let _ = writeln!(
        volumes,
        "{I}- {TOOLBOX_VOLUME_NAME}:{TOOLBOX_MOUNT_PATH}:ro"
    );
    if let Some(ref dir) = claude_auth_dir {
        let _ = writeln!(volumes, "{I}- \"{dir}:/home/orkestra/.claude\"");
    }

    let mut environment = String::new();
    let _ = writeln!(environment, "{I}HOME: /home/orkestra");
    let _ = writeln!(environment, "{I}GIT_AUTHOR_EMAIL: \"{git_email}\"");
    let _ = writeln!(environment, "{I}GIT_COMMITTER_EMAIL: \"{git_email}\"");
    let _ = writeln!(environment, "{I}GIT_AUTHOR_NAME: \"{git_name}\"");
    let _ = writeln!(environment, "{I}GIT_COMMITTER_NAME: \"{git_name}\"");
    if let Some(ref token) = gh_token {
        let _ = writeln!(environment, "{I}GH_TOKEN: \"{token}\"");
    }
    for (key, value) in &filtered_secrets {
        // Escape for YAML double-quoted string: backslash first, then double-quote,
        // then control characters that would break the single-line string.
        let escaped = value
            .replace('\\', "\\\\")
            .replace('"', "\\\"")
            .replace('\n', "\\n")
            .replace('\r', "\\r")
            .replace('\t', "\\t");
        let _ = writeln!(environment, "{I}{key}: \"{escaped}\"");
    }

    format!(
        "services:\n  {service}:\n    ports:\n      - \"127.0.0.1:{port}:{port}\"\n    volumes:\n{volumes}    environment:\n{environment}volumes:\n  {TOOLBOX_VOLUME_NAME}:\n    external: true\n"
    )
}

/// Drain `reader` line-by-line in a background thread.
///
/// Each line is written to `log` (if provided) immediately so callers can
/// tail the file while the command runs. Returns a handle whose join value
/// is the full output as a string, used for error messages.
fn pipe_to_log(
    reader: impl std::io::Read + Send + 'static,
    log: Option<Arc<Mutex<std::fs::File>>>,
) -> std::thread::JoinHandle<String> {
    std::thread::spawn(move || {
        let mut collected = String::new();
        for line in BufReader::new(reader).lines().map_while(Result::ok) {
            if let Some(ref f) = log {
                if let Ok(mut guard) = f.lock() {
                    let _ = writeln!(guard, "{line}");
                }
            }
            collected.push_str(&line);
            collected.push('\n');
        }
        collected
    })
}

// ============================================================================
// Tests
// ============================================================================

#[cfg(test)]
mod tests {
    use super::{build_compose_override, extract_git_identity};

    #[test]
    fn build_compose_override_escapes_secret_special_chars() {
        let secrets = vec![
            ("PLAIN".to_string(), "simple_value".to_string()),
            ("WITH_COLON".to_string(), "host:port".to_string()),
            ("WITH_HASH".to_string(), "value#comment".to_string()),
            ("WITH_QUOTE".to_string(), r#"val"ue"#.to_string()),
            ("WITH_BACKSLASH".to_string(), r"val\ue".to_string()),
        ];

        let yaml = build_compose_override("app", 3000, &secrets);

        // Plain value is quoted but not escaped.
        assert!(yaml.contains("PLAIN: \"simple_value\""));
        // Colon in value is safe inside double-quoted string.
        assert!(yaml.contains("WITH_COLON: \"host:port\""));
        // Hash in value is safe inside double-quoted string.
        assert!(yaml.contains("WITH_HASH: \"value#comment\""));
        // Double-quote must be escaped as \".
        assert!(yaml.contains(r#"WITH_QUOTE: "val\"ue""#));
        // Backslash must be escaped as \\.
        assert!(yaml.contains(r#"WITH_BACKSLASH: "val\\ue""#));
    }

    #[test]
    fn build_compose_override_escapes_multiline_secrets() {
        let secrets = vec![(
            "PEM_KEY".to_string(),
            "-----BEGIN KEY-----\nbase64data\n-----END KEY-----".to_string(),
        )];
        let yaml = build_compose_override("app", 3000, &secrets);
        // Literal newlines must be escaped as \n in the YAML double-quoted string.
        assert!(yaml.contains(r#"PEM_KEY: "-----BEGIN KEY-----\nbase64data\n-----END KEY-----""#));
        // The value must NOT contain unescaped literal newlines.
        assert!(!yaml.contains("-----BEGIN KEY-----\n"));
    }

    #[test]
    fn build_compose_override_no_secrets_produces_valid_structure() {
        let yaml = build_compose_override("myservice", 8080, &[]);

        assert!(yaml.contains("services:"));
        assert!(yaml.contains("myservice:"));
        assert!(yaml.contains("8080:8080"));
        assert!(yaml.contains("HOME: /home/orkestra"));
    }

    #[test]
    fn extract_git_identity_extracts_and_filters() {
        let secrets = vec![
            ("GIT_USER_EMAIL".to_string(), "dev@example.com".to_string()),
            ("GIT_USER_NAME".to_string(), "Dev User".to_string()),
            ("API_KEY".to_string(), "secret123".to_string()),
        ];

        let (email, name, remaining) = extract_git_identity(&secrets);

        assert_eq!(email, Some("dev@example.com".to_string()));
        assert_eq!(name, Some("Dev User".to_string()));
        assert_eq!(remaining.len(), 1);
        assert_eq!(remaining[0].0, "API_KEY");
        assert_eq!(remaining[0].1, "secret123");
    }

    #[test]
    fn extract_git_identity_returns_none_when_absent() {
        let secrets = vec![
            ("API_KEY".to_string(), "secret123".to_string()),
            ("DB_URL".to_string(), "postgres://localhost/db".to_string()),
        ];

        let (email, name, remaining) = extract_git_identity(&secrets);

        assert!(email.is_none());
        assert!(name.is_none());
        assert_eq!(remaining.len(), 2);
    }

    #[test]
    fn build_compose_override_uses_secret_git_identity() {
        let secrets = vec![
            (
                "GIT_USER_EMAIL".to_string(),
                "project@example.com".to_string(),
            ),
            ("GIT_USER_NAME".to_string(), "Project Bot".to_string()),
            ("API_KEY".to_string(), "mykey".to_string()),
        ];

        let yaml = build_compose_override("app", 3000, &secrets);

        // Git identity env vars use the secret values.
        assert!(yaml.contains("GIT_AUTHOR_EMAIL: \"project@example.com\""));
        assert!(yaml.contains("GIT_COMMITTER_EMAIL: \"project@example.com\""));
        assert!(yaml.contains("GIT_AUTHOR_NAME: \"Project Bot\""));
        assert!(yaml.contains("GIT_COMMITTER_NAME: \"Project Bot\""));

        // Regular secret is still injected.
        assert!(yaml.contains("API_KEY: \"mykey\""));

        // Git identity secrets must NOT be double-injected as regular env vars.
        assert!(!yaml.contains("GIT_USER_EMAIL:"));
        assert!(!yaml.contains("GIT_USER_NAME:"));
    }

    #[test]
    fn build_compose_override_partial_secret_override() {
        let secrets = vec![(
            "GIT_USER_EMAIL".to_string(),
            "project@example.com".to_string(),
        )];

        let yaml = build_compose_override("app", 3000, &secrets);

        // Email uses the secret value.
        assert!(yaml.contains("GIT_AUTHOR_EMAIL: \"project@example.com\""));
        assert!(yaml.contains("GIT_COMMITTER_EMAIL: \"project@example.com\""));

        // Name falls back to env/default (no GIT_USER_NAME secret provided).
        // We can't assert the exact value since it depends on env, but we can
        // confirm the key is present.
        assert!(yaml.contains("GIT_AUTHOR_NAME:"));
        assert!(yaml.contains("GIT_COMMITTER_NAME:"));

        // GIT_USER_EMAIL must NOT appear as a regular env var.
        assert!(!yaml.contains("GIT_USER_EMAIL:"));
    }
}
