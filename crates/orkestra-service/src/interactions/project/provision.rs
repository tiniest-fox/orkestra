//! Background provisioning: clone repo, initialize .orkestra, start container, spawn daemon.

use std::io::Write;
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};

use rusqlite::Connection;

use orkestra_git::{Git2GitService, GitService};

use crate::daemon_supervisor::DaemonSupervisor;
use crate::interactions::{devcontainer, github, project};
use crate::types::{Project, ProjectStatus, ResourceLimits, ServiceError};

/// Clone `repo_url` into `project.path`, initialise `.orkestra`, start a
/// container, and spawn the daemon.
///
/// Runs as a background task. On any failure, updates the project status to
/// `Error` with the error message.
#[cfg(unix)]
pub async fn execute(
    conn: Arc<Mutex<Connection>>,
    supervisor: Arc<DaemonSupervisor>,
    project: Project,
    repo_url: String,
    secrets_key: Option<String>,
) {
    let project_id = project.id.clone();
    let path = PathBuf::from(&project.path);

    // Create the log directory before the clone so we can log from the very start.
    let log_path = path.join(".orkestra").join(".logs").join("debug.log");
    if let Some(parent) = log_path.parent() {
        let _ = std::fs::create_dir_all(parent);
    }

    append_log(&log_path, "=== Cloning repository ===");
    append_log(&log_path, &format!("git clone {repo_url}"));

    // Step 1: Clone.
    let clone_result = tokio::task::spawn_blocking({
        let url = repo_url.clone();
        let p = path.clone();
        let lp = log_path.clone();
        move || github::clone_repo::execute(&url, &p, Some(&lp))
    })
    .await;

    if let Err(e) = flatten(clone_result) {
        tracing::error!("Clone failed for {project_id}: {e}");
        append_log(&log_path, &format!("Clone failed: {e}"));
        set_error(&conn, &project_id, &e.to_string()).await;
        return;
    }

    append_log(&log_path, "Repository cloned.");

    // Step 2: Update status to "starting".
    let _ = tokio::task::spawn_blocking({
        let conn = Arc::clone(&conn);
        let id = project_id.clone();
        move || project::update_status::execute(&conn, &id, ProjectStatus::Starting, None, None)
    })
    .await;

    // Step 3: Initialise .orkestra.
    let orkestra_dir = path.join(".orkestra");
    let init_result = tokio::task::spawn_blocking({
        let dir = orkestra_dir.clone();
        move || {
            orkestra_core::ensure_orkestra_project(&dir)
                .map_err(|e| ServiceError::Other(e.to_string()))
        }
    })
    .await;

    if let Err(e) = flatten(init_result) {
        tracing::error!("Orkestra init failed for {project_id}: {e}");
        append_log(&log_path, &format!("Orkestra init failed: {e}"));
        set_error(&conn, &project_id, &e.to_string()).await;
        return;
    }

    // Steps 4–9: Container setup and daemon spawn.
    if let Err(e) = container_and_spawn(
        &conn,
        &supervisor,
        project,
        path,
        true,  /* run_setup */
        false, /* force_build */
        &log_path,
        secrets_key,
    )
    .await
    {
        tracing::error!("Container setup failed for {project_id}: {e}");
        append_log(&log_path, &format!("Container setup failed: {e}"));
        set_error(&conn, &project_id, &e.to_string()).await;
    }
}

/// Create a container for an already-provisioned project and spawn the daemon.
///
/// Called when starting a stopped project or rebuilding its container.
/// `run_setup` controls whether `postCreateCommand` / `mise install` is executed
/// inside the container after creation.
#[cfg(unix)]
pub async fn start_containers_and_spawn(
    conn: Arc<Mutex<Connection>>,
    supervisor: Arc<DaemonSupervisor>,
    project: Project,
    run_setup: bool,
    force_build: bool,
    secrets_key: Option<String>,
) {
    let project_id = project.id.clone();
    let path = PathBuf::from(&project.path);
    let log_path = path.join(".orkestra").join(".logs").join("debug.log");

    // Update status to "starting" so the UI shows progress.
    let _ = tokio::task::spawn_blocking({
        let conn = Arc::clone(&conn);
        let id = project_id.clone();
        move || project::update_status::execute(&conn, &id, ProjectStatus::Starting, None, None)
    })
    .await;

    append_log(&log_path, "\n=== Starting project ===");

    // Best-effort pull — skipped silently if there are local changes, the
    // remote is unreachable, or history has diverged.
    //
    // Stash `.git/worktrees/` before pulling. When a repo has linked worktrees
    // pointing to `/workspace/...` (valid inside the container, absent on the
    // host), Linux git fails early with "Invalid path '/workspace'" before it
    // even contacts the remote. Hiding the directory lets git run normally;
    // the RAII guard restores it on drop — even on panic.
    append_log(&log_path, "Pulling latest code...");
    let pull_path = path.clone();
    let pull_log = log_path.clone();
    let _ = tokio::task::spawn_blocking(move || {
        let _guard = WorktreesGuard::new(&pull_path);
        if let Ok(git) = Git2GitService::new(&pull_path) {
            if let Err(e) = git.pull_branch() {
                tracing::warn!(path = %pull_path.display(), error = %e, "git pull --rebase skipped");
                append_log(&pull_log, &format!("Pull skipped: {e}"));
            } else {
                append_log(&pull_log, "Pull complete.");
            }
        }
    })
    .await;

    if let Err(e) = container_and_spawn(
        &conn,
        &supervisor,
        project,
        path,
        run_setup,
        force_build,
        &log_path,
        secrets_key,
    )
    .await
    {
        tracing::error!("Container setup failed for {project_id}: {e}");
        append_log(&log_path, &format!("Container setup failed: {e}"));
        set_error(&conn, &project_id, &e.to_string()).await;
    }
}

// -- Helpers --

/// Steps 4–9: detect → prepare image → start container → inject orkd + ork →
/// store `container_id` → optionally run setup → spawn daemon.
#[cfg(unix)]
#[allow(clippy::too_many_lines, clippy::too_many_arguments)]
async fn container_and_spawn(
    conn: &Arc<Mutex<Connection>>,
    supervisor: &Arc<DaemonSupervisor>,
    project: Project,
    path: PathBuf,
    run_setup: bool,
    force_build: bool,
    log_path: &Path,
    secrets_key: Option<String>,
) -> Result<(), ServiceError> {
    let project_id = project.id.clone();
    let orkd_path = supervisor.orkd_path().to_path_buf();
    let ork_path = supervisor.ork_path().to_path_buf();
    let data_dir = supervisor.data_dir().to_path_buf();
    let override_dir = data_dir.join("projects").join(&project_id);

    // Step 4: Detect devcontainer config.
    let config = tokio::task::spawn_blocking({
        let p = path.clone();
        move || devcontainer::detect::execute(&p)
    })
    .await
    .map_err(|e| ServiceError::Other(e.to_string()))?;

    // Step 5: Prepare image (pull or build).
    append_log(log_path, "\n=== Preparing Docker image ===");
    let image = tokio::task::spawn_blocking({
        let config = config.clone();
        let p = path.clone();
        let id = project_id.clone();
        let lp = log_path.to_path_buf();
        move || devcontainer::prepare_image::execute(&config, &p, &id, Some(&lp))
    })
    .await
    .map_err(|e| ServiceError::Other(e.to_string()))??;
    append_log(log_path, "Image ready.");

    // Step 5a: Ensure the shared toolbox volume is populated (once per service lifetime).
    supervisor.ensure_toolbox_volume().await?;

    // Step 5b: Remove any leftover container (by name or port binding).
    // `docker run --name orkestra-{id}` fails if that name or port is still allocated.
    let daemon_port = project.daemon_port;
    let _ = tokio::task::spawn_blocking({
        let id = project_id.clone();
        let config = config.clone();
        let p = path.clone();
        let od = override_dir.clone();
        move || {
            stop_existing_container(&id, &config, &p, &od);
            remove_containers_by_port(daemon_port);
        }
    })
    .await;

    // Step 5c: Decrypt project secrets for env-var injection.
    let secrets = {
        let c = Arc::clone(conn);
        let pid = project_id.clone();
        let sk = secrets_key.clone();
        tokio::task::spawn_blocking(move || {
            crate::interactions::secret::decrypt_all::execute(&c, &pid, sk.as_deref())
        })
        .await
        .map_err(|e| ServiceError::Other(e.to_string()))??
    };

    // Step 5d: Resolve resource limits.
    let (cpu_limit, memory_limit_mb) = {
        let c = Arc::clone(conn);
        let pid = project_id.clone();
        tokio::task::spawn_blocking(move || {
            crate::interactions::resource_limits::resolve::execute(&c, &pid)
        })
        .await
        .map_err(|e| ServiceError::Other(e.to_string()))??
    };
    append_log(
        log_path,
        &format!("Resource limits: {cpu_limit:.1} CPUs, {memory_limit_mb}MB memory"),
    );

    // Step 6: Start container.
    append_log(log_path, "\n=== Starting container ===");
    let container_id = tokio::task::spawn_blocking({
        let config = config.clone();
        let p = path.clone();
        let id = project_id.clone();
        let od = override_dir.clone();
        let lp = log_path.to_path_buf();
        move || {
            devcontainer::start_container::execute(
                &id,
                &config,
                &image,
                &p,
                project.daemon_port,
                &od,
                Some(&lp),
                force_build,
                &secrets,
                &ResourceLimits {
                    cpu_limit: Some(cpu_limit),
                    memory_limit_mb: Some(memory_limit_mb),
                },
            )
        }
    })
    .await
    .map_err(|e| ServiceError::Other(e.to_string()))??;
    append_log(log_path, &format!("Container started: {container_id}"));

    // Step 6b: Inject orkd binary into the container via `docker cp`.
    // This avoids bind-mounting a host path (which doesn't exist in DooD setups).
    tracing::info!(project_id = %project_id, "Injecting orkd binary into container");
    tokio::task::spawn_blocking({
        let cid = container_id.clone();
        let op = orkd_path.clone();
        move || devcontainer::inject_orkd::execute(&cid, &op)
    })
    .await
    .map_err(|e| ServiceError::Other(e.to_string()))??;

    // Step 6b2: Inject ork CLI binary into the container via `docker cp`.
    tracing::info!(project_id = %project_id, "Injecting ork CLI binary into container");
    tokio::task::spawn_blocking({
        let cid = container_id.clone();
        let op = ork_path.clone();
        move || devcontainer::inject_ork::execute(&cid, &op)
    })
    .await
    .map_err(|e| ServiceError::Other(e.to_string()))??;

    // Step 6c: Give the non-root container user (uid 1000) write access to the
    // workspace. The repo was cloned as root; files are owned by uid 0.
    tracing::info!(project_id = %project_id, "Setting workspace ownership");
    let _ = tokio::task::spawn_blocking({
        let cid = container_id.clone();
        move || chown_workspace(&cid)
    })
    .await;

    // Step 6d: Run toolbox setup (symlinks, user creation, git config).
    tracing::info!(project_id = %project_id, "Running toolbox setup");
    tokio::task::spawn_blocking({
        let cid = container_id.clone();
        let lp = log_path.to_path_buf();
        move || devcontainer::run_toolbox_setup::execute(&cid, Some(&lp))
    })
    .await
    .map_err(|e| ServiceError::Other(e.to_string()))??;

    // Step 6e: Connect project container to service container's Docker networks.
    // This allows the service to reach the daemon by container name (DooD).
    tracing::info!(project_id = %project_id, "Connecting container to Docker networks");
    tokio::task::spawn_blocking({
        let cid = container_id.clone();
        let id = project_id.clone();
        move || devcontainer::connect_network::execute(&cid, &id)
    })
    .await
    .map_err(|e| ServiceError::Other(e.to_string()))??;

    // Step 7: Store container_id.
    {
        let conn = Arc::clone(conn);
        let id = project_id.clone();
        let cid = container_id.clone();
        tokio::task::spawn_blocking(move || {
            project::update_container_id::execute(&conn, &id, Some(&cid))
        })
        .await
        .map_err(|e| ServiceError::Other(e.to_string()))??;
    }

    // Build the updated project with container_id set for spawn_and_poll.
    let mut project_with_container = project.clone();
    project_with_container.container_id = Some(container_id.clone());

    // Step 8: Run setup (optional).
    if run_setup {
        tracing::info!(project_id = %project_id, "Running setup commands");
        append_log(log_path, "\n=== Running setup commands ===");
        let cid = container_id.clone();
        let config = config.clone();
        let p = path.clone();
        let lp = log_path.to_path_buf();
        if let Err(e) = tokio::task::spawn_blocking(move || {
            devcontainer::run_setup::execute(&cid, &config, &p, Some(&lp))
        })
        .await
        .map_err(|e| ServiceError::Other(e.to_string()))?
        {
            // Setup failure is non-fatal: log a warning and continue.
            tracing::warn!("Container setup command failed for {project_id}: {e}");
            append_log(log_path, &format!("Setup command failed (continuing): {e}"));
        }

        // Step 8b: Re-run toolbox setup to reclaim ownership of any files that
        // run_setup created as root (e.g. pnpm store directories). setup.sh is
        // idempotent so running it twice is safe.
        tracing::info!(project_id = %project_id, "Re-running toolbox setup after setup commands");
        tokio::task::spawn_blocking({
            let cid = container_id.clone();
            move || devcontainer::run_toolbox_setup::execute(&cid, None)
        })
        .await
        .map_err(|e| ServiceError::Other(e.to_string()))??;
    }

    // Step 9: Spawn daemon.
    append_log(log_path, "\n=== Starting daemon ===");
    tokio::task::spawn_blocking({
        let supervisor = Arc::clone(supervisor);
        let p = project_with_container.clone();
        move || supervisor.spawn_daemon(&p)
    })
    .await
    .map_err(|e| ServiceError::Other(e.to_string()))??;

    Ok(())
}

/// RAII guard that hides `.git/worktrees/` from git during a pull.
///
/// Some Linux git versions validate registered worktree paths at startup.
/// When a repo has worktrees at `/workspace/...` (valid inside the container,
/// absent on the host), any git command fails with
/// "fatal: Invalid path '/workspace': No such file or directory".
///
/// This guard renames the directory away before the pull and restores it on
/// drop, keeping the worktree data and registrations intact while letting git
/// run on the host.
struct WorktreesGuard {
    active: PathBuf,
    stashed: PathBuf,
}

impl WorktreesGuard {
    fn new(repo_path: &std::path::Path) -> Self {
        let active = repo_path.join(".git/worktrees");
        let stashed = repo_path.join(".git/worktrees.stashed");
        // Recover from a previous crash that left worktrees stashed.
        if !active.exists() && stashed.exists() {
            let _ = std::fs::rename(&stashed, &active);
        }
        if active.exists() {
            let _ = std::fs::rename(&active, &stashed);
        }
        Self { active, stashed }
    }
}

impl Drop for WorktreesGuard {
    fn drop(&mut self) {
        if self.stashed.exists() {
            let _ = std::fs::rename(&self.stashed, &self.active);
        }
    }
}

/// Stop and remove any existing container for `project_id` (best-effort).
///
/// Called before `docker run` to avoid "name already in use" conflicts when
/// restarting a project whose previous container was not cleaned up.
fn stop_existing_container(
    project_id: &str,
    config: &crate::types::DevcontainerConfig,
    repo_path: &std::path::Path,
    override_dir: &std::path::Path,
) {
    if let Some(existing_cid) = devcontainer::find_container::execute(project_id) {
        let compose_file_buf =
            if let crate::types::DevcontainerConfig::Compose { compose_file, .. } = config {
                Some(repo_path.join(compose_file))
            } else {
                None
            };
        let _ = devcontainer::stop_container::execute(
            config,
            &existing_cid,
            compose_file_buf.as_deref(),
            override_dir,
        );
    }
}

/// Chown `/workspace` inside `container_id` to uid/gid 1000 (best-effort).
///
/// The repo is cloned as root, so files are owned by uid 0. The non-root
/// agent user needs write access. The chown also propagates to the host's
/// bind-mounted directory, which is fine — root in the service container
/// can still access uid-1000 files.
fn chown_workspace(container_id: &str) {
    let _ = std::process::Command::new("docker")
        .args([
            "exec",
            "-u",
            "root",
            container_id,
            "chown",
            "-R",
            "1000:1000",
            "/workspace",
        ])
        .stdin(std::process::Stdio::null())
        .stdout(std::process::Stdio::null())
        .stderr(std::process::Stdio::null())
        .status();
}

/// Force-remove any Docker containers that have `127.0.0.1:{port}` bound.
///
/// Belt-and-suspenders cleanup for cases where a previous container was not
/// properly removed and still holds the port, preventing `docker run -p`.
fn remove_containers_by_port(port: u16) {
    let filter = format!("publish={port}");
    let Ok(out) = std::process::Command::new("docker")
        .args(["ps", "-a", "--filter", &filter, "-q"])
        .stdin(std::process::Stdio::null())
        .stdout(std::process::Stdio::piped())
        .stderr(std::process::Stdio::null())
        .output()
    else {
        return;
    };
    for id in String::from_utf8_lossy(&out.stdout)
        .lines()
        .map(str::trim)
        .filter(|l| !l.is_empty())
    {
        let _ = std::process::Command::new("docker")
            .args(["rm", "-f", id])
            .stdin(std::process::Stdio::null())
            .stdout(std::process::Stdio::null())
            .stderr(std::process::Stdio::null())
            .output();
    }
}

/// Update the project status to `Error` with the given message.
async fn set_error(conn: &Arc<Mutex<Connection>>, project_id: &str, message: &str) {
    let conn = Arc::clone(conn);
    let id = project_id.to_string();
    let msg = message.to_string();
    let _ = tokio::task::spawn_blocking(move || {
        project::update_status::execute(&conn, &id, ProjectStatus::Error, None, Some(&msg))
    })
    .await;
}

/// Flatten a `Result<Result<T, ServiceError>, JoinError>` into `Result<T, ServiceError>`.
fn flatten<T>(
    result: Result<Result<T, ServiceError>, tokio::task::JoinError>,
) -> Result<T, ServiceError> {
    match result {
        Ok(inner) => inner,
        Err(e) => Err(ServiceError::Other(e.to_string())),
    }
}

/// Append a line to the provision log file, creating it if needed.
///
/// Silently ignores I/O errors — log writes must never fail the provision.
fn append_log(log_path: &Path, line: &str) {
    if let Ok(mut f) = std::fs::OpenOptions::new()
        .create(true)
        .append(true)
        .open(log_path)
    {
        let _ = writeln!(f, "{line}");
    }
}
