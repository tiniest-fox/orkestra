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
use crate::types::{DevcontainerConfig, ResourceLimits, ServiceError};

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
    resource_limits: &ResourceLimits,
) -> Result<String, ServiceError> {
    match config {
        DevcontainerConfig::Default
        | DevcontainerConfig::Image { .. }
        | DevcontainerConfig::Build { .. } => docker_run(
            project_id,
            image,
            repo_path,
            port,
            secrets,
            resource_limits,
            mounts_from_config(config),
        ),
        DevcontainerConfig::Compose {
            compose_file,
            service,
            mounts,
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
                resource_limits,
                mounts,
            )
        }
    }
}

// -- Helpers --

/// Extract the `mounts` field from a non-Default `DevcontainerConfig` variant.
fn mounts_from_config(config: &DevcontainerConfig) -> &[String] {
    match config {
        DevcontainerConfig::Image { mounts, .. }
        | DevcontainerConfig::Build { mounts, .. }
        | DevcontainerConfig::Compose { mounts, .. } => mounts,
        DevcontainerConfig::Default => &[],
    }
}

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

/// Separate the `CLAUDE_CODE_OAUTH_TOKEN` secret from regular secrets and resolve
/// the final value. Returns `(resolved_token, remaining_secrets)`. Unlike git
/// identity there is no hardcoded default — `None` means no token is available.
/// Found key is removed from the returned secrets vec to prevent double-injection.
fn extract_claude_token(secrets: &[(String, String)]) -> (Option<String>, Vec<(String, String)>) {
    let mut token = None;
    let mut remaining = Vec::with_capacity(secrets.len());
    for (key, value) in secrets {
        if key == "CLAUDE_CODE_OAUTH_TOKEN" {
            token = Some(value.clone());
        } else {
            remaining.push((key.clone(), value.clone()));
        }
    }
    let resolved = token.or_else(|| std::env::var("CLAUDE_CODE_OAUTH_TOKEN").ok());
    (resolved, remaining)
}

/// Separate the `OPENCODE_API_KEY` secret from regular secrets and resolve
/// the final value. Returns `(resolved_key, remaining_secrets)`. `None` means
/// no key is available. Found key is removed from the returned secrets vec to
/// prevent double-injection.
fn extract_opencode_api_key(
    secrets: &[(String, String)],
) -> (Option<String>, Vec<(String, String)>) {
    let mut token = None;
    let mut remaining = Vec::with_capacity(secrets.len());
    for (key, value) in secrets {
        if key == "OPENCODE_API_KEY" {
            token = Some(value.clone());
        } else {
            remaining.push((key.clone(), value.clone()));
        }
    }
    let resolved = token.or_else(|| std::env::var("OPENCODE_API_KEY").ok());
    (resolved, remaining)
}

/// Named volume for persisting Claude Code session `.jsonl` files across container restarts.
///
/// Returns the volume name for the given project. The volume is auto-created by Docker
/// on first `docker run` and should be removed on project deletion.
pub fn claude_sessions_volume_name(project_id: &str) -> String {
    format!("orkestra-claude-sessions-{project_id}")
}

/// Container path where Claude Code stores per-project session history.
const CLAUDE_SESSIONS_MOUNT_PATH: &str = "/home/orkestra/.claude/projects";

/// All resolved inputs needed to build `docker run` arguments.
struct DockerRunConfig {
    container_name: String,
    workspace_mount: String,
    port_bind: String,
    git_email: String,
    git_name: String,
    /// OAuth token injected as `CLAUDE_CODE_OAUTH_TOKEN` env var. `None` when
    /// neither a per-project secret nor the service env var is set.
    claude_code_oauth_token: Option<String>,
    /// `OpenCode` API key injected as `OPENCODE_API_KEY` env var. `None` when
    /// neither a per-project secret nor the service env var is set.
    opencode_api_key: Option<String>,
    gh_token: Option<String>,
    secret_envs: Vec<String>,
    image: String,
    cpu_limit: Option<String>,
    memory_limit: Option<String>,
    extra_mounts: Vec<String>,
    /// Named volume for persisting Claude session files.
    claude_sessions_volume: String,
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

    // Mount the shared toolbox volume read-only so agents have access to
    // the claude CLI, gh, and other pre-built tools without baking them
    // into the per-project image.
    args.push("-v".to_string());
    args.push(toolbox_mount);

    // Per-project named volume that persists Claude Code session history
    // (.jsonl files) across container restarts.
    args.push("-v".to_string());
    args.push(format!(
        "{}:{CLAUDE_SESSIONS_MOUNT_PATH}",
        config.claude_sessions_volume
    ));

    // User-declared mounts from devcontainer.json `mounts` field.
    for mount in &config.extra_mounts {
        args.push("-v".to_string());
        args.push(mount.clone());
    }

    args.push("-e".to_string());
    args.push("HOME=/home/orkestra".to_string());
    args.push("-e".to_string());
    args.push("XDG_CACHE_HOME=/home/orkestra/.local/cache".to_string());

    // Inject Claude OAuth token so the agent can authenticate.
    if let Some(ref token) = config.claude_code_oauth_token {
        args.push("-e".to_string());
        args.push(format!("CLAUDE_CODE_OAUTH_TOKEN={token}"));
    }

    // Inject OpenCode API key so the opencode agent can authenticate.
    if let Some(ref key) = config.opencode_api_key {
        args.push("-e".to_string());
        args.push(format!("OPENCODE_API_KEY={key}"));
    }

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

fn docker_run(
    project_id: &str,
    image: &str,
    repo_path: &Path,
    port: u16,
    secrets: &[(String, String)],
    resource_limits: &ResourceLimits,
    extra_mounts: &[String],
) -> Result<String, ServiceError> {
    let container_name = format!("orkestra-{project_id}");
    let workspace_mount = format!("{}:/workspace", repo_path.display());
    let port_bind = format!("127.0.0.1:{port}:{port}");

    // Forward git author identity into the container using git's native env vars.
    // Project secrets GIT_USER_EMAIL / GIT_USER_NAME take precedence; falls back
    // to service-wide env vars, then the hardcoded defaults.
    let (git_email, git_name, filtered_secrets) = extract_git_identity(secrets);
    let (claude_token, filtered_after_claude) = extract_claude_token(&filtered_secrets);
    let (opencode_key, final_secrets) = extract_opencode_api_key(&filtered_after_claude);
    let gh_token = std::env::var("GH_TOKEN").ok();
    let secret_envs: Vec<String> = final_secrets
        .iter()
        .map(|(k, v)| format!("{k}={v}"))
        .collect();

    let config = DockerRunConfig {
        container_name,
        workspace_mount,
        port_bind,
        git_email,
        git_name,
        claude_code_oauth_token: claude_token,
        opencode_api_key: opencode_key,
        gh_token,
        secret_envs,
        image: image.to_string(),
        cpu_limit: resource_limits.cpu_limit.map(|v| format!("{v:.1}")),
        memory_limit: resource_limits.memory_limit_mb.map(|v| format!("{v}m")),
        extra_mounts: extra_mounts.to_vec(),
        claude_sessions_volume: claude_sessions_volume_name(project_id),
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
    resource_limits: &ResourceLimits,
    extra_mounts: &[String],
) -> Result<String, ServiceError> {
    // 10 minutes is generous for even the heaviest healthcheck chains.
    const TIMEOUT: Duration = Duration::from_mins(10);

    std::fs::create_dir_all(override_dir)
        .map_err(|e| ServiceError::Other(format!("Failed to create override dir: {e}")))?;

    let override_path = override_dir.join("orkestra-override.yml");
    let (claude_token, _) = extract_claude_token(secrets);
    let (opencode_key, _) = extract_opencode_api_key(secrets);
    let sessions_volume = claude_sessions_volume_name(project_id);
    let override_content = build_compose_override(
        service,
        port,
        secrets,
        claude_token.as_deref(),
        opencode_key.as_deref(),
        resource_limits,
        extra_mounts,
        &sessions_volume,
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

/// Return true when a mount source is a named Docker volume (not a host path).
fn is_named_volume(mount_spec: &str) -> bool {
    let source = mount_spec.split(':').next().unwrap_or("");
    !source.starts_with('/')
        && !source.starts_with('.')
        && !source.starts_with('~')
        && !source.is_empty()
}

/// Build the Docker Compose override YAML that injects Orkestra's runtime
/// requirements into the project's app service.
///
/// Mirrors the mounts and environment variables that `docker_run` sets for
/// non-compose containers: toolbox volume, claude sessions volume, git identity,
/// `HOME`, `GH_TOKEN`, and `CLAUDE_CODE_OAUTH_TOKEN`.
///
/// `claude_code_oauth_token` — when `Some`, injects the token as `CLAUDE_CODE_OAUTH_TOKEN`
///   in the service environment. Resolved by the caller (secret → service env var).
/// `opencode_api_key` — when `Some`, injects the key as `OPENCODE_API_KEY`
///   in the service environment. Resolved by the caller (secret → service env var).
/// `claude_sessions_volume` — named volume for persisting Claude session `.jsonl` files.
#[allow(clippy::too_many_arguments)]
fn build_compose_override(
    service: &str,
    port: u16,
    secrets: &[(String, String)],
    claude_code_oauth_token: Option<&str>,
    opencode_api_key: Option<&str>,
    resource_limits: &ResourceLimits,
    extra_mounts: &[String],
    claude_sessions_volume: &str,
) -> String {
    const I: &str = "      "; // 6-space indent for items under a 4-space key

    // Project secrets GIT_USER_EMAIL / GIT_USER_NAME take precedence over
    // service-wide env vars. They are removed from the regular secrets list
    // to prevent double-injection as plain env vars.
    let (git_email, git_name, filtered_secrets) = extract_git_identity(secrets);
    // CLAUDE_CODE_OAUTH_TOKEN is handled via the claude_code_oauth_token parameter;
    // strip it from remaining secrets to prevent double-injection.
    let (_, filtered_secrets) = extract_claude_token(&filtered_secrets);
    // OPENCODE_API_KEY is handled via the opencode_api_key parameter;
    // strip it from remaining secrets to prevent double-injection.
    let (_, filtered_secrets) = extract_opencode_api_key(&filtered_secrets);
    let gh_token = std::env::var("GH_TOKEN").ok();

    let mut volumes = String::new();
    let _ = writeln!(
        volumes,
        "{I}- {TOOLBOX_VOLUME_NAME}:{TOOLBOX_MOUNT_PATH}:ro"
    );
    let _ = writeln!(
        volumes,
        "{I}- {claude_sessions_volume}:{CLAUDE_SESSIONS_MOUNT_PATH}"
    );
    for mount in extra_mounts {
        let _ = writeln!(volumes, "{I}- \"{mount}\"");
    }

    let mut environment = String::new();
    let _ = writeln!(environment, "{I}HOME: /home/orkestra");
    let _ = writeln!(
        environment,
        "{I}XDG_CACHE_HOME: /home/orkestra/.local/cache"
    );
    let _ = writeln!(environment, "{I}GIT_AUTHOR_EMAIL: \"{git_email}\"");
    let _ = writeln!(environment, "{I}GIT_COMMITTER_EMAIL: \"{git_email}\"");
    let _ = writeln!(environment, "{I}GIT_AUTHOR_NAME: \"{git_name}\"");
    let _ = writeln!(environment, "{I}GIT_COMMITTER_NAME: \"{git_name}\"");
    if let Some(token) = claude_code_oauth_token {
        let escaped = token
            .replace('\\', "\\\\")
            .replace('"', "\\\"")
            .replace('\n', "\\n")
            .replace('\r', "\\r")
            .replace('\t', "\\t");
        let _ = writeln!(environment, "{I}CLAUDE_CODE_OAUTH_TOKEN: \"{escaped}\"");
    }
    if let Some(key) = opencode_api_key {
        let escaped = key
            .replace('\\', "\\\\")
            .replace('"', "\\\"")
            .replace('\n', "\\n")
            .replace('\r', "\\r")
            .replace('\t', "\\t");
        let _ = writeln!(environment, "{I}OPENCODE_API_KEY: \"{escaped}\"");
    }
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

    let mut resource_limits_yaml = String::new();
    if let Some(cpus) = resource_limits.cpu_limit {
        let _ = writeln!(resource_limits_yaml, "    cpus: {cpus:.1}");
    }
    if let Some(mem) = resource_limits.memory_limit_mb {
        let _ = writeln!(resource_limits_yaml, "    mem_limit: {mem}m");
    }

    let mut root_volumes = String::new();
    let _ = writeln!(root_volumes, "volumes:");
    let _ = writeln!(root_volumes, "  {TOOLBOX_VOLUME_NAME}:");
    let _ = writeln!(root_volumes, "    external: true");
    // Sessions volume is auto-created by Docker Compose (not external).
    let _ = writeln!(root_volumes, "  {claude_sessions_volume}:");
    for mount in extra_mounts {
        if is_named_volume(mount) {
            let name = mount.split(':').next().unwrap_or("");
            let _ = writeln!(root_volumes, "  {name}:");
        }
    }

    format!(
        "services:\n  {service}:\n{resource_limits_yaml}    ports:\n      - \"127.0.0.1:{port}:{port}\"\n    volumes:\n{volumes}    environment:\n{environment}{root_volumes}"
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
        build_compose_override, build_docker_run_args, extract_claude_token, extract_git_identity,
        extract_opencode_api_key, is_named_volume, DockerRunConfig,
    };
    use crate::types::ResourceLimits;

    fn no_limits() -> ResourceLimits {
        ResourceLimits {
            cpu_limit: None,
            memory_limit_mb: None,
        }
    }

    #[test]
    fn build_compose_override_escapes_secret_special_chars() {
        let secrets = vec![
            ("PLAIN".to_string(), "simple_value".to_string()),
            ("WITH_COLON".to_string(), "host:port".to_string()),
            ("WITH_HASH".to_string(), "value#comment".to_string()),
            ("WITH_QUOTE".to_string(), r#"val"ue"#.to_string()),
            ("WITH_BACKSLASH".to_string(), r"val\ue".to_string()),
        ];

        let yaml = build_compose_override(
            "app",
            3000,
            &secrets,
            None,
            None,
            &no_limits(),
            &[],
            "test-sessions-vol",
        );

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
        let yaml = build_compose_override(
            "app",
            3000,
            &secrets,
            None,
            None,
            &no_limits(),
            &[],
            "test-sessions-vol",
        );
        // Literal newlines must be escaped as \n in the YAML double-quoted string.
        assert!(yaml.contains(r#"PEM_KEY: "-----BEGIN KEY-----\nbase64data\n-----END KEY-----""#));
        // The value must NOT contain unescaped literal newlines.
        assert!(!yaml.contains("-----BEGIN KEY-----\n"));
    }

    #[test]
    fn build_compose_override_no_secrets_produces_valid_structure() {
        let yaml = build_compose_override(
            "myservice",
            8080,
            &[],
            None,
            None,
            &no_limits(),
            &[],
            "test-sessions-vol",
        );

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
    fn extract_claude_token_from_secrets() {
        let secrets = vec![
            (
                "CLAUDE_CODE_OAUTH_TOKEN".to_string(),
                "sk-ant-abc123".to_string(),
            ),
            ("API_KEY".to_string(), "mykey".to_string()),
        ];

        let (token, remaining) = extract_claude_token(&secrets);

        assert_eq!(token.as_deref(), Some("sk-ant-abc123"));
        assert_eq!(remaining.len(), 1);
        assert_eq!(remaining[0].0, "API_KEY");
    }

    #[test]
    fn extract_claude_token_falls_back_to_env() {
        let saved = std::env::var("CLAUDE_CODE_OAUTH_TOKEN").ok();
        unsafe {
            std::env::set_var("CLAUDE_CODE_OAUTH_TOKEN", "env-token-xyz");
        }

        let (token, remaining) = extract_claude_token(&[]);

        unsafe {
            match saved {
                Some(v) => std::env::set_var("CLAUDE_CODE_OAUTH_TOKEN", v),
                None => std::env::remove_var("CLAUDE_CODE_OAUTH_TOKEN"),
            }
        }

        assert_eq!(token.as_deref(), Some("env-token-xyz"));
        assert!(remaining.is_empty());
    }

    #[test]
    fn extract_claude_token_returns_none_when_absent() {
        let saved = std::env::var("CLAUDE_CODE_OAUTH_TOKEN").ok();
        unsafe {
            std::env::remove_var("CLAUDE_CODE_OAUTH_TOKEN");
        }

        let (token, remaining) = extract_claude_token(&[]);

        unsafe {
            if let Some(v) = saved {
                std::env::set_var("CLAUDE_CODE_OAUTH_TOKEN", v);
            }
        }

        assert!(token.is_none());
        assert!(remaining.is_empty());
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

        let yaml = build_compose_override(
            "app",
            3000,
            &secrets,
            None,
            None,
            &no_limits(),
            &[],
            "test-sessions-vol",
        );

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

        let yaml = build_compose_override(
            "app",
            3000,
            &secrets,
            None,
            None,
            &no_limits(),
            &[],
            "test-sessions-vol",
        );

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
            claude_code_oauth_token: None,
            opencode_api_key: None,
            gh_token: None,
            secret_envs: vec![],
            image: "myimage:latest".to_string(),
            cpu_limit: None,
            memory_limit: None,
            extra_mounts: vec![],
            claude_sessions_volume: "test-sessions-vol".to_string(),
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
        let (_, final_secrets) = extract_claude_token(&filtered_secrets);
        let config = DockerRunConfig {
            git_email,
            git_name,
            secret_envs: final_secrets
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
        let (_, final_secrets) = extract_claude_token(&filtered_secrets);
        let config = DockerRunConfig {
            git_email,
            git_name,
            secret_envs: final_secrets
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
        let yaml = build_compose_override(
            "app",
            3000,
            &[],
            None,
            None,
            &ResourceLimits {
                cpu_limit: Some(2.0),
                memory_limit_mb: Some(4096),
            },
            &[],
            "test-sessions-vol",
        );
        assert!(yaml.contains("cpus: 2.0"), "cpus should be in YAML");
        assert!(
            yaml.contains("mem_limit: 4096m"),
            "mem_limit should be in YAML"
        );
    }

    #[test]
    fn build_compose_override_omits_resource_limits_when_none() {
        let yaml = build_compose_override(
            "app",
            3000,
            &[],
            None,
            None,
            &no_limits(),
            &[],
            "test-sessions-vol",
        );
        assert!(!yaml.contains("cpus:"), "cpus should be absent");
        assert!(!yaml.contains("mem_limit:"), "mem_limit should be absent");
    }

    // -- extra_mounts tests --

    #[test]
    fn build_docker_run_args_includes_extra_mounts() {
        let config = DockerRunConfig {
            extra_mounts: vec![
                "myvolume:/mnt/cache".to_string(),
                "/host/path:/container/path:ro".to_string(),
            ],
            ..default_run_config()
        };
        let args = build_docker_run_args(&config);
        let v_positions: Vec<usize> = args
            .iter()
            .enumerate()
            .filter(|(_, a)| *a == "-v")
            .map(|(i, _)| i)
            .collect();
        let mounted: Vec<&String> = v_positions.iter().map(|&i| &args[i + 1]).collect();
        assert!(mounted.contains(&&"myvolume:/mnt/cache".to_string()));
        assert!(mounted.contains(&&"/host/path:/container/path:ro".to_string()));
    }

    #[test]
    fn build_docker_run_args_no_extra_mounts_when_empty() {
        let config = default_run_config();
        let args = build_docker_run_args(&config);
        // Exactly 3 -v flags: workspace + toolbox + claude sessions.
        let v_count = args.iter().filter(|a| *a == "-v").count();
        assert_eq!(
            v_count, 3,
            "expect workspace, toolbox, and sessions -v flags"
        );
    }

    #[test]
    fn build_docker_run_args_includes_claude_token_when_set() {
        let config = DockerRunConfig {
            claude_code_oauth_token: Some("sk-ant-test-token".to_string()),
            ..default_run_config()
        };
        let args = build_docker_run_args(&config);
        assert!(
            args.contains(&"CLAUDE_CODE_OAUTH_TOKEN=sk-ant-test-token".to_string()),
            "CLAUDE_CODE_OAUTH_TOKEN must be injected when set"
        );
    }

    #[test]
    fn build_docker_run_args_omits_claude_token_when_none() {
        let config = default_run_config();
        let args = build_docker_run_args(&config);
        assert!(
            !args
                .iter()
                .any(|a| a.starts_with("CLAUDE_CODE_OAUTH_TOKEN=")),
            "CLAUDE_CODE_OAUTH_TOKEN must be absent when None"
        );
    }

    #[test]
    fn build_compose_override_includes_extra_mounts_in_service_volumes() {
        let yaml = build_compose_override(
            "app",
            3000,
            &[],
            None,
            None,
            &no_limits(),
            &[
                "cache-vol:/root/.cache".to_string(),
                "/host:/container:ro".to_string(),
            ],
            "test-sessions-vol",
        );
        assert!(yaml.contains("- \"cache-vol:/root/.cache\""));
        assert!(yaml.contains("- \"/host:/container:ro\""));
    }

    #[test]
    fn build_compose_override_declares_named_volumes_at_root() {
        let yaml = build_compose_override(
            "app",
            3000,
            &[],
            None,
            None,
            &no_limits(),
            &["cache-vol:/root/.cache".to_string()],
            "test-sessions-vol",
        );
        assert!(
            yaml.contains("  cache-vol:\n"),
            "named volume should appear in root volumes"
        );
        assert!(
            !yaml.contains("cache-vol:\n    external: true"),
            "user volumes must not be declared external"
        );
    }

    #[test]
    fn build_compose_override_does_not_declare_host_paths_at_root() {
        let yaml = build_compose_override(
            "app",
            3000,
            &[],
            None,
            None,
            &no_limits(),
            &["/host/path:/container/path:ro".to_string()],
            "test-sessions-vol",
        );
        // Only the toolbox volume should appear in the root-level volumes section.
        let root_section = yaml.rsplit("volumes:\n").next().unwrap_or("");
        assert!(!root_section.contains("/host/path"));
    }

    #[test]
    fn build_compose_override_includes_claude_token_when_set() {
        let yaml = build_compose_override(
            "app",
            3000,
            &[],
            Some("sk-ant-abc"),
            None,
            &no_limits(),
            &[],
            "test-sessions-vol",
        );
        assert!(
            yaml.contains("CLAUDE_CODE_OAUTH_TOKEN: \"sk-ant-abc\""),
            "CLAUDE_CODE_OAUTH_TOKEN must appear in environment when set"
        );
    }

    #[test]
    fn build_compose_override_omits_claude_token_when_none() {
        let yaml = build_compose_override(
            "app",
            3000,
            &[],
            None,
            None,
            &no_limits(),
            &[],
            "test-sessions-vol",
        );
        assert!(
            !yaml.contains("CLAUDE_CODE_OAUTH_TOKEN"),
            "CLAUDE_CODE_OAUTH_TOKEN must be absent when None"
        );
    }

    #[test]
    fn build_compose_override_strips_claude_token_from_secrets_env_vars() {
        // CLAUDE_CODE_OAUTH_TOKEN in secrets must not be double-injected as a bare env var.
        let secrets = vec![
            (
                "CLAUDE_CODE_OAUTH_TOKEN".to_string(),
                "from-secret".to_string(),
            ),
            ("OTHER_KEY".to_string(), "value".to_string()),
        ];
        let yaml = build_compose_override(
            "app",
            3000,
            &secrets,
            None,
            None,
            &no_limits(),
            &[],
            "test-sessions-vol",
        );
        // Should not appear as a plain key-value secret injection.
        // (The param is None so it won't appear at all in this call.)
        assert!(!yaml.contains("CLAUDE_CODE_OAUTH_TOKEN"));
        // Other secrets still appear.
        assert!(yaml.contains("OTHER_KEY: \"value\""));
    }

    // -- extract_opencode_api_key tests --

    #[test]
    fn extract_opencode_api_key_from_secrets() {
        let secrets = vec![
            ("OPENCODE_API_KEY".to_string(), "oc-key-abc123".to_string()),
            ("API_KEY".to_string(), "mykey".to_string()),
        ];

        let (key, remaining) = extract_opencode_api_key(&secrets);

        assert_eq!(key.as_deref(), Some("oc-key-abc123"));
        assert_eq!(remaining.len(), 1);
        assert_eq!(remaining[0].0, "API_KEY");
    }

    #[test]
    fn extract_opencode_api_key_falls_back_to_env() {
        let saved = std::env::var("OPENCODE_API_KEY").ok();
        unsafe {
            std::env::set_var("OPENCODE_API_KEY", "env-oc-key-xyz");
        }

        let (key, remaining) = extract_opencode_api_key(&[]);

        unsafe {
            match saved {
                Some(v) => std::env::set_var("OPENCODE_API_KEY", v),
                None => std::env::remove_var("OPENCODE_API_KEY"),
            }
        }

        assert_eq!(key.as_deref(), Some("env-oc-key-xyz"));
        assert!(remaining.is_empty());
    }

    #[test]
    fn extract_opencode_api_key_returns_none_when_absent() {
        let saved = std::env::var("OPENCODE_API_KEY").ok();
        unsafe {
            std::env::remove_var("OPENCODE_API_KEY");
        }

        let (key, remaining) = extract_opencode_api_key(&[]);

        unsafe {
            if let Some(v) = saved {
                std::env::set_var("OPENCODE_API_KEY", v);
            }
        }

        assert!(key.is_none());
        assert!(remaining.is_empty());
    }

    #[test]
    fn build_docker_run_args_includes_opencode_key_when_set() {
        let config = DockerRunConfig {
            opencode_api_key: Some("oc-key-test".to_string()),
            ..default_run_config()
        };
        let args = build_docker_run_args(&config);
        assert!(
            args.contains(&"OPENCODE_API_KEY=oc-key-test".to_string()),
            "OPENCODE_API_KEY must be injected when set"
        );
    }

    #[test]
    fn build_docker_run_args_omits_opencode_key_when_none() {
        let config = default_run_config();
        let args = build_docker_run_args(&config);
        assert!(
            !args.iter().any(|a| a.starts_with("OPENCODE_API_KEY=")),
            "OPENCODE_API_KEY must be absent when None"
        );
    }

    #[test]
    fn build_compose_override_includes_opencode_key_when_set() {
        let yaml = build_compose_override(
            "app",
            3000,
            &[],
            None,
            Some("oc-key-abc"),
            &no_limits(),
            &[],
            "test-sessions-vol",
        );
        assert!(
            yaml.contains("OPENCODE_API_KEY: \"oc-key-abc\""),
            "OPENCODE_API_KEY must appear in environment when set"
        );
    }

    #[test]
    fn build_compose_override_omits_opencode_key_when_none() {
        let yaml = build_compose_override(
            "app",
            3000,
            &[],
            None,
            None,
            &no_limits(),
            &[],
            "test-sessions-vol",
        );
        assert!(
            !yaml.contains("OPENCODE_API_KEY"),
            "OPENCODE_API_KEY must be absent when None"
        );
    }

    #[test]
    fn build_compose_override_strips_opencode_key_from_secrets_env_vars() {
        let secrets = vec![
            ("OPENCODE_API_KEY".to_string(), "from-secret".to_string()),
            ("OTHER_KEY".to_string(), "value".to_string()),
        ];
        let yaml = build_compose_override(
            "app",
            3000,
            &secrets,
            None,
            None,
            &no_limits(),
            &[],
            "test-sessions-vol",
        );
        // Should not appear as a plain key-value secret injection.
        assert!(!yaml.contains("OPENCODE_API_KEY"));
        // Other secrets still appear.
        assert!(yaml.contains("OTHER_KEY: \"value\""));
    }

    #[test]
    fn build_docker_run_args_includes_xdg_cache_home() {
        let config = default_run_config();
        let args = build_docker_run_args(&config);
        assert!(
            args.contains(&"XDG_CACHE_HOME=/home/orkestra/.local/cache".to_string()),
            "XDG_CACHE_HOME must be unconditionally injected"
        );
    }

    #[test]
    fn build_compose_override_includes_xdg_cache_home() {
        let yaml = build_compose_override(
            "app",
            3000,
            &[],
            None,
            None,
            &no_limits(),
            &[],
            "test-sessions-vol",
        );
        assert!(
            yaml.contains("XDG_CACHE_HOME: /home/orkestra/.local/cache"),
            "XDG_CACHE_HOME must be unconditionally injected in compose override"
        );
    }

    // -- claude sessions volume tests --

    #[test]
    fn build_docker_run_args_mounts_claude_sessions_volume() {
        let config = DockerRunConfig {
            claude_sessions_volume: "orkestra-claude-sessions-proj123".to_string(),
            ..default_run_config()
        };
        let args = build_docker_run_args(&config);
        let v_positions: Vec<usize> = args
            .iter()
            .enumerate()
            .filter(|(_, a)| *a == "-v")
            .map(|(i, _)| i)
            .collect();
        let mounted: Vec<&String> = v_positions.iter().map(|&i| &args[i + 1]).collect();
        assert!(
            mounted
                .iter()
                .any(|m| m.starts_with("orkestra-claude-sessions-proj123:")),
            "sessions volume must appear as a -v mount"
        );
        assert!(
            mounted
                .iter()
                .any(|m| m.contains("/home/orkestra/.claude/projects")),
            "sessions volume must be mounted at /home/orkestra/.claude/projects"
        );
    }

    #[test]
    fn build_compose_override_mounts_claude_sessions_volume() {
        let yaml = build_compose_override(
            "app",
            3000,
            &[],
            None,
            None,
            &no_limits(),
            &[],
            "orkestra-claude-sessions-proj123",
        );
        assert!(
            yaml.contains("- orkestra-claude-sessions-proj123:/home/orkestra/.claude/projects"),
            "sessions volume must appear in service volumes"
        );
        assert!(
            yaml.contains("  orkestra-claude-sessions-proj123:\n"),
            "sessions volume must be declared in root volumes section"
        );
    }

    #[test]
    fn claude_sessions_volume_name_follows_pattern() {
        use super::claude_sessions_volume_name;
        assert_eq!(
            claude_sessions_volume_name("my-project"),
            "orkestra-claude-sessions-my-project"
        );
    }

    #[test]
    fn setup_script_chowns_claude_sessions_parent_dir() {
        let mount_path = std::path::Path::new(CLAUDE_SESSIONS_MOUNT_PATH);
        let parent = mount_path
            .parent()
            .expect("mount path must have a parent directory");
        let parent_str = parent.to_str().unwrap();

        // Docker creates intermediate directories as root when mounting a
        // named volume. The toolbox setup script must chown the parent of
        // the sessions mount path so Claude Code can create sibling
        // directories (session-env, plugins, etc.) under ~/.claude/.
        let dockerfile = std::fs::read_to_string(
            std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
                .join("Dockerfile.toolbox"),
        )
        .expect("Dockerfile.toolbox must exist");

        let chowns_parent = dockerfile
            .lines()
            .any(|line| {
                let trimmed = line.trim();
                trimmed.starts_with("chown")
                    && trimmed.contains("1000")
                    && trimmed.contains(parent_str)
            });
        assert!(
            chowns_parent,
            "setup.sh must chown {parent_str} so uid 1000 can write to it \
             after Docker creates it as root for the sessions volume mount"
        );
    }

    #[test]
    fn is_named_volume_correctly_classifies() {
        assert!(is_named_volume("myvolume:/mnt/cache"));
        assert!(is_named_volume(
            "rust-analyzer-cache:/home/orkestra/.cache/rust-analyzer"
        ));
        assert!(!is_named_volume("/host/path:/container:ro"));
        assert!(!is_named_volume("./relative:/container"));
        assert!(!is_named_volume("~/homepath:/container"));
    }
}
