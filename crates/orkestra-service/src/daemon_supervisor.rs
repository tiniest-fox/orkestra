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
use crate::interactions::project;
use crate::types::{Project, ProjectStatus, ServiceError};

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
    /// Port range reserved for daemon assignment (stored for callers; unused
    /// internally since ports are assigned at project-add time).
    #[allow(dead_code)]
    port_range: (u16, u16),
    stop: Arc<AtomicBool>,
}

impl DaemonSupervisor {
    /// Create a new `DaemonSupervisor`.
    pub fn new(conn: Arc<Mutex<Connection>>, orkd_path: PathBuf, port_range: (u16, u16)) -> Self {
        Self {
            conn,
            children: Arc::new(Mutex::new(HashMap::new())),
            orkd_path,
            port_range,
            stop: Arc::new(AtomicBool::new(false)),
        }
    }

    // -- Startup --

    /// Kill orphaned daemons left by a previous service crash and reset their
    /// DB status to `stopped`. Returns the number of processes killed.
    pub fn startup_cleanup(&self) -> Result<usize, ServiceError> {
        daemon::cleanup_orphans::execute(&self.conn)
    }

    // -- Lifecycle --

    /// Spawn a daemon for `project`, update its DB status to `starting`, and
    /// begin polling for readiness in a background thread.
    pub fn spawn_daemon(&self, project: &Project) -> Result<(), ServiceError> {
        spawn_and_poll(
            self.conn.clone(),
            self.children.clone(),
            &self.orkd_path,
            project,
        )
    }

    /// Stop the daemon for `project_id`, escalating to SIGKILL after 5 s.
    pub fn stop_daemon(&self, project_id: &str) -> Result<(), ServiceError> {
        let mut guard = self.children.lock().expect("children mutex poisoned");
        if let Some(mut child) = guard.remove(project_id) {
            daemon::stop::execute(&mut child, Duration::from_secs(5))?;
        }
        drop(guard);

        project::update_status::execute(
            &self.conn,
            project_id,
            ProjectStatus::Stopped,
            None,
            None,
        )?;

        Ok(())
    }

    // -- Monitor loop --

    /// Blocking loop that detects crashed daemons and restarts them after 5 s.
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
                let orkd_path = self.orkd_path.clone();
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
                            if let Err(e) =
                                spawn_and_poll(conn.clone(), children, &orkd_path, &project)
                            {
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
            // Negating it targets the process group.
            unsafe { libc::kill(-pgid, libc::SIGCONT) };
            // SAFETY: same pgid — sending SIGTERM after SIGCONT ensures stopped
            // processes can receive the termination signal.
            unsafe { libc::kill(-pgid, libc::SIGTERM) };
        }

        // Update all statuses to stopped upfront.
        for id in guard.keys() {
            if let Err(e) =
                project::update_status::execute(&self.conn, id, ProjectStatus::Stopped, None, None)
            {
                error!("Failed to update status during shutdown for {id}: {e}");
            }
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
    }

    // -- Accessors --

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

/// Spawn an `orkd` child, register it in `children`, set DB status to
/// `starting`, and launch a background thread that polls for TCP readiness
/// before updating status to `running`.
fn spawn_and_poll(
    conn: Arc<Mutex<Connection>>,
    children: Arc<Mutex<HashMap<String, Child>>>,
    orkd_path: &Path,
    project: &Project,
) -> Result<(), ServiceError> {
    let child = daemon::spawn::execute(
        orkd_path,
        &project.path,
        project.daemon_port,
        &project.shared_secret,
        "127.0.0.1",
    )?;

    let pid = child.id();
    let project_id = project.id.clone();
    let port = project.daemon_port;

    project::update_status::execute(&conn, &project_id, ProjectStatus::Starting, Some(pid), None)?;

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
