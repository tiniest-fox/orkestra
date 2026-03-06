//! Background provisioning: clone repo, initialize .orkestra, spawn daemon.

use std::sync::{Arc, Mutex};

use rusqlite::Connection;

use crate::daemon_supervisor::DaemonSupervisor;
use crate::interactions::{github, project};
use crate::types::{Project, ProjectStatus, ServiceError};

/// Clone `repo_url` into `project.path`, initialise `.orkestra`, and spawn the daemon.
///
/// Runs as a background task. On any failure, updates the project status to
/// `Error` with the error message.
pub async fn execute(
    conn: Arc<Mutex<Connection>>,
    supervisor: Arc<DaemonSupervisor>,
    project: Project,
    repo_url: String,
) {
    let project_id = project.id.clone();
    let target_path = project.path.clone();
    let path = std::path::PathBuf::from(&target_path);

    // Step 1: Clone.
    let clone_result = tokio::task::spawn_blocking({
        let url = repo_url.clone();
        let p = path.clone();
        move || github::clone_repo::execute(&url, &p)
    })
    .await;

    if let Err(e) = flatten(clone_result) {
        tracing::error!("Clone failed for {project_id}: {e}");
        set_error(&conn, &project_id, &e.to_string()).await;
        return;
    }

    // Step 2: Update status to "starting".
    let _ = tokio::task::spawn_blocking({
        let conn = Arc::clone(&conn);
        let id = project_id.clone();
        move || project::update_status::execute(&conn, &id, ProjectStatus::Starting, None, None)
    })
    .await;

    // Step 3: Initialise .orkestra.
    let orkestra_dir = path.join(".orkestra");
    let init_result = tokio::task::spawn_blocking(move || {
        orkestra_core::ensure_orkestra_project(&orkestra_dir)
            .map_err(|e| ServiceError::Other(e.to_string()))
    })
    .await;

    if let Err(e) = flatten(init_result) {
        tracing::error!("Orkestra init failed for {project_id}: {e}");
        set_error(&conn, &project_id, &e.to_string()).await;
        return;
    }

    // Step 4: Spawn daemon.
    let spawn_result = tokio::task::spawn_blocking({
        let supervisor = Arc::clone(&supervisor);
        let project = project.clone();
        move || supervisor.spawn_daemon(&project)
    })
    .await;

    if let Err(e) = flatten(spawn_result) {
        tracing::error!("Daemon spawn failed for {project_id}: {e}");
        set_error(&conn, &project_id, &e.to_string()).await;
    }
}

// -- Helpers --

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
