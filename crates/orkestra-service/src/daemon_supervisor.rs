//! Manages child daemon processes — spawn, monitor, restart, shutdown.

use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::process::Child;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

use rusqlite::Connection;
use tracing::{error, info, warn};

use crate::interactions::daemon;
use crate::interactions::devcontainer;
use crate::interactions::project;
use crate::types::{DevcontainerConfig, Project, ProjectStatus, ServiceError};

// ============================================================================
// DaemonSupervisor
// ============================================================================

/// Spawns, monitors, and shuts down child `orkd` daemon processes.
///
/// Callers hold this behind an `Arc` so the HTTP server and the monitor loop
/// thread can share the same instance.
pub struct DaemonSupervisor {
    conn: Arc<Mutex<Connection>>,
    children: Arc<Mutex<HashMap<String, Child>>>,
    orkd_path: PathBuf,
    data_dir: PathBuf,
    /// Port range reserved for daemon assignment (stored for callers; unused
    /// internally since ports are assigned at project-add time).
    #[allow(dead_code)]
    port_range: (u16, u16),
    stop: Arc<AtomicBool>,
}

impl DaemonSupervisor {
    /// Create a new `DaemonSupervisor`.
    pub fn new(
        conn: Arc<Mutex<Connection>>,
        orkd_path: PathBuf,
        data_dir: PathBuf,
        port_range: (u16, u16),
    ) -> Self {
        Self {
            conn,
            children: Arc::new(Mutex::new(HashMap::new())),
            orkd_path,
            data_dir,
            port_range,
            stop: Arc::new(AtomicBool::new(false)),
        }
    }

    // -- Accessors --

    /// Path to the `orkd` binary on the host filesystem.
    pub fn orkd_path(&self) -> &Path {
        &self.orkd_path
    }

    /// Data directory used for compose override files and project state.
    pub fn data_dir(&self) -> &Path {
        &self.data_dir
    }

    // -- Startup --

    /// Stop any containers left over from a previous service crash and reset
    /// their DB status to `stopped`. Returns the number of containers stopped.
    #[cfg(unix)]
    pub fn startup_cleanup(&self) -> Result<usize, ServiceError> {
        // Collect projects that have a stored container_id.
        let projects_with_containers = {
            let guard = self.conn.lock().expect("db mutex poisoned");
            let mut stmt = guard.prepare(
                "SELECT id, path, container_id FROM service_projects WHERE container_id IS NOT NULL",
            )?;
            let rows: Vec<(String, String, String)> = stmt
                .query_map([], |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)))?
                .collect::<Result<_, _>>()?;
            rows
        };

        let mut stopped = 0;

        for (project_id, project_path, container_id) in &projects_with_containers {
            let path = Path::new(project_path);

            if devcontainer::find_container::execute(project_id).is_some() {
                let config = devcontainer::detect::execute(path);
                let override_dir = self.data_dir.join("projects").join(project_id);
                let compose_file_buf = compose_file_for(&config, path);

                if let Err(e) = devcontainer::stop_container::execute(
                    &config,
                    container_id,
                    compose_file_buf.as_deref(),
                    &override_dir,
                ) {
                    warn!("Failed to stop orphaned container for {project_id}: {e}");
                } else {
                    stopped += 1;
                }
            }

            // Reset project status and clear the stored container_id.
            if let Err(e) = project::update_status::execute(
                &self.conn,
                project_id,
                ProjectStatus::Stopped,
                None,
                None,
            ) {
                warn!("Failed to reset status for {project_id} after startup cleanup: {e}");
            }
            if let Err(e) = project::update_container_id::execute(&self.conn, project_id, None) {
                warn!("Failed to clear container_id for {project_id} after startup cleanup: {e}");
            }
        }

        // Also reset any running/starting projects that had no container_id
        // (e.g. from an old schema version or interrupted provisioning).
        match project::list::execute(&self.conn) {
            Ok(all_projects) => {
                for proj in all_projects {
                    if matches!(
                        proj.status,
                        ProjectStatus::Running | ProjectStatus::Starting
                    ) && proj.container_id.is_none()
                    {
                        if let Err(e) = project::update_status::execute(
                            &self.conn,
                            &proj.id,
                            ProjectStatus::Stopped,
                            None,
                            None,
                        ) {
                            warn!("Failed to reset orphaned project {}: {e}", proj.id);
                        }
                    }
                }
            }
            Err(e) => warn!("Failed to list projects during startup cleanup: {e}"),
        }

        Ok(stopped)
    }

    // -- Lifecycle --

    /// Exec `orkd` into the project's running container and begin polling for
    /// readiness in a background thread.
    ///
    /// The project's `container_id` must already be set — call
    /// `provision::start_containers_and_spawn` (which creates the container
    /// first) instead of this method when starting from a stopped state.
    #[cfg(unix)]
    pub fn spawn_daemon(&self, project: &Project) -> Result<(), ServiceError> {
        spawn_and_poll(&self.conn, &self.children, project)
    }

    /// Stop the daemon exec process for `project_id` and remove its container.
    #[cfg(unix)]
    pub fn stop_daemon(&self, project_id: &str) -> Result<(), ServiceError> {
        // Kill the docker exec child process.
        {
            let mut guard = self.children.lock().expect("children mutex poisoned");
            if let Some(mut child) = guard.remove(project_id) {
                daemon::stop::execute(&mut child, Duration::from_secs(5));
            }
        }

        // Load the project to get its path and container_id.
        let project = project::get::execute(&self.conn, project_id)?;

        if let Some(ref container_id) = project.container_id {
            let path = Path::new(&project.path);
            let config = devcontainer::detect::execute(path);
            let override_dir = self.data_dir.join("projects").join(project_id);
            let compose_file_buf = compose_file_for(&config, path);

            if let Err(e) = devcontainer::stop_container::execute(
                &config,
                container_id,
                compose_file_buf.as_deref(),
                &override_dir,
            ) {
                warn!("Failed to stop container for {project_id}: {e}");
            }
        }

        project::update_status::execute(
            &self.conn,
            project_id,
            ProjectStatus::Stopped,
            None,
            None,
        )?;

        project::update_container_id::execute(&self.conn, project_id, None)?;

        Ok(())
    }

    // -- Monitor loop --

    /// Blocking loop that detects crashed daemons and restarts them after 5 s.
    ///
    /// When `orkd` exits inside the container, the `docker exec` child exits.
    /// The monitor loop re-execs into the *same* container — no rebuild needed.
    ///
    /// Run this method in a dedicated thread:
    /// ```ignore
    /// let pm = Arc::new(DaemonSupervisor::new(...));
    /// let pm2 = pm.clone();
    /// std::thread::spawn(move || pm2.run_monitor_loop());
    /// ```
    pub fn run_monitor_loop(&self) {
        while !self.stop.load(Ordering::Acquire) {
            let exited = self.collect_exited_children();

            for (project_id, exit_code) in exited {
                info!("Daemon {project_id} exited with code {exit_code}; restarting in 5 s");

                let error_msg = format!("Daemon exited with code {exit_code}");
                if let Err(e) = project::update_status::execute(
                    &self.conn,
                    &project_id,
                    ProjectStatus::Error,
                    None,
                    Some(&error_msg),
                ) {
                    error!("Failed to update status after daemon exit for {project_id}: {e}");
                    continue;
                }

                let conn = self.conn.clone();
                let children = self.children.clone();
                let stop = self.stop.clone();

                std::thread::spawn(move || {
                    std::thread::sleep(Duration::from_secs(5));
                    if stop.load(Ordering::Acquire) {
                        return;
                    }
                    match project::get::execute(&conn, &project_id) {
                        Ok(project) => {
                            // Skip restart if project was explicitly stopped.
                            if project.status == ProjectStatus::Stopped {
                                info!("Skipping restart for {project_id} — project was stopped");
                                return;
                            }
                            // Re-exec into the same container (container is still running).
                            if let Err(e) = spawn_and_poll(&conn, &children, &project) {
                                error!("Failed to respawn daemon for {project_id}: {e}");
                                let _ = project::update_status::execute(
                                    &conn,
                                    &project_id,
                                    ProjectStatus::Error,
                                    None,
                                    Some(&format!("Respawn failed: {e}")),
                                );
                            }
                        }
                        Err(ServiceError::ProjectNotFound(_)) => {
                            info!("Skipping restart for {project_id} — project was removed");
                        }
                        Err(e) => error!("Cannot load project {project_id} for restart: {e}"),
                    }
                });
            }

            std::thread::sleep(Duration::from_secs(1));
        }
    }

    // -- Shutdown --

    /// Signal all children to stop gracefully; force-kill after 10 s.
    /// Then stop all running containers.
    ///
    /// Also sets the stop flag so `run_monitor_loop` exits on its next tick.
    #[cfg(unix)]
    #[allow(clippy::cast_possible_wrap)]
    pub fn shutdown_all(&self) {
        self.stop.store(true, Ordering::Release);

        let mut guard = self.children.lock().expect("children mutex poisoned");

        // Signal all process groups: SIGCONT first so stopped processes
        // receive the subsequent SIGTERM.
        for child in guard.values() {
            let pgid = child.id() as i32;
            // SAFETY: pgid is a valid process group ID obtained from `child.id()`.
            unsafe { libc::kill(-pgid, libc::SIGCONT) };
            // SAFETY: same pgid — sending SIGTERM after SIGCONT ensures stopped
            // processes can receive the termination signal.
            unsafe { libc::kill(-pgid, libc::SIGTERM) };
        }

        // Wait up to 10 s for all children to exit.
        let deadline = Instant::now() + Duration::from_secs(10);
        while Instant::now() < deadline {
            let all_done = guard
                .values_mut()
                .all(|c| matches!(c.try_wait(), Ok(Some(_))));
            if all_done {
                break;
            }
            std::thread::sleep(Duration::from_millis(100));
        }

        // Force kill any that are still alive.
        for child in guard.values_mut() {
            if matches!(child.try_wait(), Ok(None)) {
                let pgid = child.id() as i32;
                warn!("Force-killing daemon pid={}", child.id());
                // SAFETY: pgid is obtained from `child.id()` (positive PID); negating it
                // targets the process group for a clean kill.
                unsafe { libc::kill(-pgid, libc::SIGKILL) };
                let _ = child.wait();
            }
        }

        guard.clear();
        drop(guard);

        // Stop all containers after exec children are dead.
        if let Ok(projects) = project::list::execute(&self.conn) {
            for proj in projects {
                if let Some(ref container_id) = proj.container_id {
                    let path = Path::new(&proj.path);
                    let config = devcontainer::detect::execute(path);
                    let override_dir = self.data_dir.join("projects").join(&proj.id);
                    let compose_file_buf = compose_file_for(&config, path);

                    if let Err(e) = devcontainer::stop_container::execute(
                        &config,
                        container_id,
                        compose_file_buf.as_deref(),
                        &override_dir,
                    ) {
                        warn!("Failed to stop container for {}: {e}", proj.id);
                    }
                }
            }
        }
    }

    // -- Accessors (stop flag) --

    /// Return a cloned handle to the stop flag for use in signal handlers.
    pub fn stop_flag(&self) -> Arc<AtomicBool> {
        self.stop.clone()
    }

    // -- Helpers --

    /// Drain all children that have exited since the last tick.
    ///
    /// Returns `(project_id, exit_code)` pairs for each exited child.
    fn collect_exited_children(&self) -> Vec<(String, i32)> {
        let mut guard = self.children.lock().expect("children mutex poisoned");
        let mut exited = Vec::new();

        guard.retain(|project_id, child| match child.try_wait() {
            Ok(Some(status)) => {
                let code = status.code().unwrap_or(-1);
                exited.push((project_id.clone(), code));
                false
            }
            Ok(None) => true,
            Err(e) => {
                error!("Error polling daemon {project_id}: {e}");
                true
            }
        });

        exited
    }
}

// ============================================================================
// Helpers
// ============================================================================

/// Exec `orkd` into the project's running container, register the child in
/// `children`, set DB status to `starting`, and launch a background thread
/// that polls for TCP readiness before updating status to `running`.
///
/// The project's `container_id` must be set before calling this function.
#[cfg(unix)]
fn spawn_and_poll(
    conn: &Arc<Mutex<Connection>>,
    children: &Arc<Mutex<HashMap<String, Child>>>,
    project: &Project,
) -> Result<(), ServiceError> {
    let container_id = project.container_id.as_deref().ok_or_else(|| {
        ServiceError::Other(format!("No container running for project {}", project.id))
    })?;

    let child = devcontainer::exec_orkd::execute(
        container_id,
        project.daemon_port,
        &project.shared_secret,
    )?;

    let pid = child.id();
    let project_id = project.id.clone();
    let port = project.daemon_port;

    project::update_status::execute(conn, &project_id, ProjectStatus::Starting, Some(pid), None)?;

    {
        let mut guard = children.lock().expect("children mutex poisoned");
        guard.insert(project_id.clone(), child);
    }

    // Readiness poller: once the daemon is accepting TCP connections, mark it
    // running. Times out after 30 s to avoid waiting forever on a bad binary.
    // Each iteration also checks for early process exit so we fail fast on
    // crashes or port conflicts instead of waiting the full 30 s.
    let conn_poll = conn.clone();
    let children_poll = children.clone();
    std::thread::spawn(move || {
        let deadline = Instant::now() + Duration::from_secs(30);
        while Instant::now() < deadline {
            // Check if the child process has already exited.
            let exit_status = {
                let mut guard = children_poll.lock().expect("children mutex poisoned");
                match guard.get_mut(&project_id) {
                    Some(child) => {
                        let status = child.try_wait().ok().and_then(|s| s);
                        if status.is_some() {
                            guard.remove(&project_id);
                        }
                        status
                    }
                    None => {
                        // Child was removed externally (e.g., stop_daemon called).
                        return;
                    }
                }
            };
            if let Some(status) = exit_status {
                let code = status.code().unwrap_or(-1);
                warn!("Daemon {project_id} exited with code {code} before becoming ready");
                if let Err(e) = project::update_status::execute(
                    &conn_poll,
                    &project_id,
                    ProjectStatus::Error,
                    None,
                    Some(&format!(
                        "Daemon exited with code {code} before becoming ready"
                    )),
                ) {
                    error!("Failed to mark daemon {project_id} as error after early exit: {e}");
                }
                return;
            }

            if daemon::check_readiness::execute(port) {
                if let Err(e) = project::update_status::execute(
                    &conn_poll,
                    &project_id,
                    ProjectStatus::Running,
                    Some(pid),
                    None,
                ) {
                    error!("Failed to mark daemon {project_id} as running: {e}");
                }
                return;
            }
            std::thread::sleep(Duration::from_millis(200));
        }
        warn!("Daemon {project_id} did not become ready within 30 s");
        if let Err(e) = project::update_status::execute(
            &conn_poll,
            &project_id,
            ProjectStatus::Error,
            None,
            Some("Daemon did not become ready within 30 s"),
        ) {
            error!("Failed to mark daemon {project_id} as error after timeout: {e}");
        }
    });

    Ok(())
}

/// Return the absolute compose file path when `config` is a Compose variant.
fn compose_file_for(config: &DevcontainerConfig, repo_path: &Path) -> Option<PathBuf> {
    if let DevcontainerConfig::Compose { compose_file, .. } = config {
        Some(repo_path.join(compose_file))
    } else {
        None
    }
}
