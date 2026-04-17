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
    cpu_limit: Option<f64>,
    memory_limit_mb: Option<i64>,
) -> Result<String, ServiceError> {
    match config {
        DevcontainerConfig::Default
        | DevcontainerConfig::Image { .. }
        | DevcontainerConfig::Build { .. } => docker_run(
            project_id,
            image,
            repo_path,
            port,
            override_dir,
            secrets,
            cpu_limit,
            memory_limit_mb,
        ),
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
                cpu_limit,
                memory_limit_mb,
            )
        }
    }
}

// -- Helpers --

/// Separate git-identity secrets (`GIT_USER_NAME`, `GIT_USER_EMAIL`) from
/// regular secrets and resolve the final values. Returns `(git_email,
/// git_name, remaining_secrets)` with fully resolved strings: secret value →
/// service env var → hardcoded default. Found keys are removed from the
/// returned secrets vec to prevent double-injection.
fn extract_git_identity(secrets: &[(String, String)]) -> (String, String, Vec<(String, String)>) {
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
    let resolved_email = git_email.unwrap_or_else(|| {
        std::env::var("GIT_USER_EMAIL").unwrap_or_else(|_| "agent@orkestra.local".to_string())
    });
    let resolved_name = git_name.unwrap_or_else(|| {
        std::env::var("GIT_USER_NAME").unwrap_or_else(|_| "Orkestra Agent".to_string())
    });
    (resolved_email, resolved_name, remaining)
}

/// All resolved inputs needed to build `docker run` arguments.
struct DockerRunConfig {
    container_name: String,
    workspace_mount: String,
    port_bind: String,
    git_email: String,
    git_name: String,
    claude_auth_mount: Option<String>,
    gh_token: Option<String>,
    secret_envs: Vec<String>,
    image: String,
    cpu_limit: Option<String>,
    memory_limit: Option<String>,
}

/// Build the `docker run` argument list from resolved config values.
///
/// Pure function — takes resolved inputs and returns the full args vec.
/// Separated from `docker_run` so arg construction can be tested without
/// spawning a Docker process.
fn build_docker_run_args(config: &DockerRunConfig) -> Vec<String> {
    let git_author_email = format!("GIT_AUTHOR_EMAIL={}", config.git_email);
    let git_committer_email = format!("GIT_COMMITTER_EMAIL={}", config.git_email);
    let git_author_name = format!("GIT_AUTHOR_NAME={}", config.git_name);
    let git_committer_name = format!("GIT_COMMITTER_NAME={}", config.git_name);
    let toolbox_mount = format!("{TOOLBOX_VOLUME_NAME}:{TOOLBOX_MOUNT_PATH}:ro");

    let mut args = vec![
        "run".to_string(),
        "-d".to_string(),
        "--name".to_string(),
        config.container_name.clone(),
        "-v".to_string(),
        config.workspace_mount.clone(),
        "-p".to_string(),
        config.port_bind.clone(),
        "-w".to_string(),
        "/workspace".to_string(),
        "-e".to_string(),
        git_author_email,
        "-e".to_string(),
        git_committer_email,
        "-e".to_string(),
        git_author_name,
        "-e".to_string(),
        git_committer_name,
    ];

    if let Some(ref mount) = config.claude_auth_mount {
        args.push("-v".to_string());
        args.push(mount.clone());
    }

    // Mount the shared toolbox volume read-only so agents have access to
    // the claude CLI, gh, and other pre-built tools without baking them
    // into the per-project image.
    args.push("-v".to_string());
    args.push(toolbox_mount);

    // Ensure the claude CLI finds auth tokens under /home/orkestra/.claude.
    args.push("-e".to_string());
    args.push("HOME=/home/orkestra".to_string());

    // Forward GH_TOKEN so the git credential helper can authenticate pushes.
    if let Some(ref token) = config.gh_token {
        args.push("-e".to_string());
        args.push(format!("GH_TOKEN={token}"));
    }

    for env in &config.secret_envs {
        args.push("-e".to_string());
        args.push(env.clone());
    }

    if let Some(ref cpus) = config.cpu_limit {
        args.push("--cpus".to_string());
        args.push(cpus.clone());
    }
    if let Some(ref mem) = config.memory_limit {
        args.push("--memory".to_string());
        args.push(mem.clone());
    }

    args.push(config.image.clone());
    args.push("sleep".to_string());
    args.push("infinity".to_string());

    args
}

#[allow(clippy::too_many_arguments)]
fn docker_run(
    project_id: &str,
    image: &str,
    repo_path: &Path,
    port: u16,
    override_dir: &Path,
    secrets: &[(String, String)],
    cpu_limit: Option<f64>,
    memory_limit_mb: Option<i64>,
) -> Result<String, ServiceError> {
    let container_name = format!("orkestra-{project_id}");

    // Prefer a per-project Claude auth directory over the global fallback.
    //
    // Per-project: {override_dir}/.claude  — created by the operator via:
    //   CLAUDE_CONFIG_DIR={override_dir}/.claude claude login
    //
    // Global fallback: CLAUDE_AUTH_DIR env var (set to the HOST path in DooD
    // deployments where the service runs inside its own container, since Docker
    // bind mounts require host-side paths).
    //
    // Note: {override_dir} is the service-container path. In non-DooD deployments
    // it equals the host path and works as a volume source. In DooD, use the
    // global CLAUDE_AUTH_DIR instead — per-project auth is not supported there.
    //
    // Target is /home/orkestra/.claude because orkd runs as uid 1000 (orkestra)
    // and claude CLI resolves config from $HOME/.claude.
    // Mount read-write so claude can refresh tokens and write session state.
    let project_claude_dir = override_dir.join(".claude");
    let claude_auth_mount = if project_claude_dir.exists() {
        Some(format!(
            "{}:/home/orkestra/.claude",
            project_claude_dir.display()
        ))
    } else {
        std::env::var("CLAUDE_AUTH_DIR")
            .ok()
            .map(|dir| format!("{dir}:/home/orkestra/.claude"))
    };
    let workspace_mount = format!("{}:/workspace", repo_path.display());
    let port_bind = format!("127.0.0.1:{port}:{port}");

    // Forward git author identity into the container using git's native env vars.
    // Project secrets GIT_USER_EMAIL / GIT_USER_NAME take precedence; falls back
    // to service-wide env vars, then the hardcoded defaults.
    let (git_email, git_name, filtered_secrets) = extract_git_identity(secrets);
    let gh_token = std::env::var("GH_TOKEN").ok();
    let secret_envs: Vec<String> = filtered_secrets
        .iter()
        .map(|(k, v)| format!("{k}={v}"))
        .collect();

    let config = DockerRunConfig {
        container_name,
        workspace_mount,
        port_bind,
        git_email,
        git_name,
        claude_auth_mount,
        gh_token,
        secret_envs,
        image: image.to_string(),
        cpu_limit: cpu_limit.map(|v| format!("{v:.1}")),
        memory_limit: memory_limit_mb.map(|v| format!("{v}m")),
    };
    let args = build_docker_run_args(&config);

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
    cpu_limit: Option<f64>,
    memory_limit_mb: Option<i64>,
) -> Result<String, ServiceError> {
    // 10 minutes is generous for even the heaviest healthcheck chains.
    const TIMEOUT: Duration = Duration::from_secs(600);

    std::fs::create_dir_all(override_dir)
        .map_err(|e| ServiceError::Other(format!("Failed to create override dir: {e}")))?;

    let override_path = override_dir.join("orkestra-override.yml");
    let project_claude_dir = override_dir.join(".claude");
    let claude_config_dir = project_claude_dir
        .exists()
        .then_some(project_claude_dir.as_path());
    let override_content = build_compose_override(
        service,
        port,
        secrets,
        claude_config_dir,
        cpu_limit,
        memory_limit_mb,
    );
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
///
/// `claude_config_dir` — when `Some`, mounts this host path at
/// `/home/orkestra/.claude` (per-project auth). When `None`, falls back to the
/// global `CLAUDE_AUTH_DIR` env var.
fn build_compose_override(
    service: &str,
    port: u16,
    secrets: &[(String, String)],
    claude_config_dir: Option<&std::path::Path>,
    cpu_limit: Option<f64>,
    memory_limit_mb: Option<i64>,
) -> String {
    const I: &str = "      "; // 6-space indent for items under a 4-space key

    // Project secrets GIT_USER_EMAIL / GIT_USER_NAME take precedence over
    // service-wide env vars. They are removed from the regular secrets list
    // to prevent double-injection as plain env vars.
    let (git_email, git_name, filtered_secrets) = extract_git_identity(secrets);
    let claude_auth_dir = claude_config_dir
        .map(|p| p.display().to_string())
        .or_else(|| std::env::var("CLAUDE_AUTH_DIR").ok());
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

    let mut resource_limits = String::new();
    if let Some(cpus) = cpu_limit {
        let _ = writeln!(resource_limits, "    cpus: {cpus:.1}");
    }
    if let Some(mem) = memory_limit_mb {
        let _ = writeln!(resource_limits, "    mem_limit: {mem}m");
    }

    format!(
        "services:\n  {service}:\n{resource_limits}    ports:\n      - \"127.0.0.1:{port}:{port}\"\n    volumes:\n{volumes}    environment:\n{environment}volumes:\n  {TOOLBOX_VOLUME_NAME}:\n    external: true\n"
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
    use super::{
        build_compose_override, build_docker_run_args, extract_git_identity, DockerRunConfig,
    };

    #[test]
    fn build_compose_override_escapes_secret_special_chars() {
        let secrets = vec![
            ("PLAIN".to_string(), "simple_value".to_string()),
            ("WITH_COLON".to_string(), "host:port".to_string()),
            ("WITH_HASH".to_string(), "value#comment".to_string()),
            ("WITH_QUOTE".to_string(), r#"val"ue"#.to_string()),
            ("WITH_BACKSLASH".to_string(), r"val\ue".to_string()),
        ];

        let yaml = build_compose_override("app", 3000, &secrets, None, None, None);

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
        let yaml = build_compose_override("app", 3000, &secrets, None, None, None);
        // Literal newlines must be escaped as \n in the YAML double-quoted string.
        assert!(yaml.contains(r#"PEM_KEY: "-----BEGIN KEY-----\nbase64data\n-----END KEY-----""#));
        // The value must NOT contain unescaped literal newlines.
        assert!(!yaml.contains("-----BEGIN KEY-----\n"));
    }

    #[test]
    fn build_compose_override_no_secrets_produces_valid_structure() {
        let yaml = build_compose_override("myservice", 8080, &[], None, None, None);

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

        assert_eq!(email, "dev@example.com");
        assert_eq!(name, "Dev User");
        assert_eq!(remaining.len(), 1);
        assert_eq!(remaining[0].0, "API_KEY");
        assert_eq!(remaining[0].1, "secret123");
    }

    #[test]
    fn extract_git_identity_returns_defaults_when_no_secrets_no_env() {
        // Save and remove git identity env vars to force hardcoded defaults.
        let saved_email = std::env::var("GIT_USER_EMAIL").ok();
        let saved_name = std::env::var("GIT_USER_NAME").ok();
        unsafe {
            std::env::remove_var("GIT_USER_EMAIL");
            std::env::remove_var("GIT_USER_NAME");
        }

        let (email, name, remaining) = extract_git_identity(&[]);

        // Restore env vars before any assertion so they are always restored.
        unsafe {
            if let Some(v) = saved_email {
                std::env::set_var("GIT_USER_EMAIL", v);
            }
            if let Some(v) = saved_name {
                std::env::set_var("GIT_USER_NAME", v);
            }
        }

        assert_eq!(email, "agent@orkestra.local");
        assert_eq!(name, "Orkestra Agent");
        assert!(remaining.is_empty());
    }

    #[test]
    fn extract_git_identity_passes_through_non_git_secrets() {
        let secrets = vec![
            ("API_KEY".to_string(), "secret123".to_string()),
            ("DB_URL".to_string(), "postgres://localhost/db".to_string()),
        ];

        let (_email, _name, remaining) = extract_git_identity(&secrets);

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

        let yaml = build_compose_override("app", 3000, &secrets, None, None, None);

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

        let yaml = build_compose_override("app", 3000, &secrets, None, None, None);

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

    fn default_run_config() -> DockerRunConfig {
        DockerRunConfig {
            container_name: "orkestra-test".to_string(),
            workspace_mount: "/repo:/workspace".to_string(),
            port_bind: "127.0.0.1:9000:9000".to_string(),
            git_email: "agent@orkestra.local".to_string(),
            git_name: "Orkestra Agent".to_string(),
            claude_auth_mount: None,
            gh_token: None,
            secret_envs: vec![],
            image: "myimage:latest".to_string(),
            cpu_limit: None,
            memory_limit: None,
        }
    }

    #[test]
    fn build_docker_run_args_includes_git_identity() {
        let config = DockerRunConfig {
            git_email: "test@example.com".to_string(),
            git_name: "Test User".to_string(),
            ..default_run_config()
        };

        let args = build_docker_run_args(&config);

        assert!(args.contains(&"GIT_AUTHOR_EMAIL=test@example.com".to_string()));
        assert!(args.contains(&"GIT_COMMITTER_EMAIL=test@example.com".to_string()));
        assert!(args.contains(&"GIT_AUTHOR_NAME=Test User".to_string()));
        assert!(args.contains(&"GIT_COMMITTER_NAME=Test User".to_string()));
    }

    #[test]
    fn build_docker_run_args_uses_secret_git_identity() {
        let secrets = vec![
            (
                "GIT_USER_EMAIL".to_string(),
                "project@example.com".to_string(),
            ),
            ("GIT_USER_NAME".to_string(), "Project Bot".to_string()),
            ("API_KEY".to_string(), "mykey".to_string()),
        ];
        let (git_email, git_name, filtered_secrets) = extract_git_identity(&secrets);
        let config = DockerRunConfig {
            git_email,
            git_name,
            secret_envs: filtered_secrets
                .iter()
                .map(|(k, v)| format!("{k}={v}"))
                .collect(),
            ..default_run_config()
        };

        let args = build_docker_run_args(&config);

        assert!(args.contains(&"GIT_AUTHOR_EMAIL=project@example.com".to_string()));
        assert!(args.contains(&"GIT_COMMITTER_EMAIL=project@example.com".to_string()));
        assert!(args.contains(&"GIT_AUTHOR_NAME=Project Bot".to_string()));
        assert!(args.contains(&"GIT_COMMITTER_NAME=Project Bot".to_string()));
        // Regular secret is still injected.
        assert!(args.contains(&"API_KEY=mykey".to_string()));
    }

    #[test]
    fn build_docker_run_args_filters_git_secrets() {
        let secrets = vec![
            (
                "GIT_USER_EMAIL".to_string(),
                "project@example.com".to_string(),
            ),
            ("GIT_USER_NAME".to_string(), "Project Bot".to_string()),
            ("API_KEY".to_string(), "mykey".to_string()),
        ];
        let (git_email, git_name, filtered_secrets) = extract_git_identity(&secrets);
        let config = DockerRunConfig {
            git_email,
            git_name,
            secret_envs: filtered_secrets
                .iter()
                .map(|(k, v)| format!("{k}={v}"))
                .collect(),
            ..default_run_config()
        };

        let args = build_docker_run_args(&config);

        // Regular secret appears.
        assert!(args.contains(&"API_KEY=mykey".to_string()));
        // Git identity secrets must NOT appear as raw env vars — only as the
        // GIT_AUTHOR_*/GIT_COMMITTER_* variants.
        assert!(!args.iter().any(|a| a.starts_with("GIT_USER_EMAIL=")));
        assert!(!args.iter().any(|a| a.starts_with("GIT_USER_NAME=")));
    }

    #[test]
    fn build_docker_run_args_includes_cpu_and_memory_when_set() {
        let config = DockerRunConfig {
            cpu_limit: Some("2.0".to_string()),
            memory_limit: Some("4096m".to_string()),
            ..default_run_config()
        };
        let args = build_docker_run_args(&config);
        let cpus_pos = args.iter().position(|a| a == "--cpus");
        let mem_pos = args.iter().position(|a| a == "--memory");
        assert!(cpus_pos.is_some(), "--cpus flag should be present");
        assert_eq!(args[cpus_pos.unwrap() + 1], "2.0");
        assert!(mem_pos.is_some(), "--memory flag should be present");
        assert_eq!(args[mem_pos.unwrap() + 1], "4096m");
    }

    #[test]
    fn build_docker_run_args_omits_cpu_and_memory_when_none() {
        let config = default_run_config();
        let args = build_docker_run_args(&config);
        assert!(
            !args.iter().any(|a| a == "--cpus"),
            "--cpus should be absent"
        );
        assert!(
            !args.iter().any(|a| a == "--memory"),
            "--memory should be absent"
        );
    }

    #[test]
    fn build_compose_override_includes_resource_limits_when_set() {
        let yaml = build_compose_override("app", 3000, &[], None, Some(2.0), Some(4096));
        assert!(yaml.contains("cpus: 2.0"), "cpus should be in YAML");
        assert!(
            yaml.contains("mem_limit: 4096m"),
            "mem_limit should be in YAML"
        );
    }

    #[test]
    fn build_compose_override_omits_resource_limits_when_none() {
        let yaml = build_compose_override("app", 3000, &[], None, None, None);
        assert!(!yaml.contains("cpus:"), "cpus should be absent");
        assert!(!yaml.contains("mem_limit:"), "mem_limit should be absent");
    }
}
