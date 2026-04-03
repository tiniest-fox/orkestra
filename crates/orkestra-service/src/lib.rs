//! Foundation crate for the ork-service binary — database, domain types, project CRUD, and HTTP server.

pub(crate) mod daemon_supervisor;
pub(crate) mod database;
pub(crate) mod interactions;
pub(crate) mod server;
pub mod types;

pub use daemon_supervisor::DaemonSupervisor;
pub use database::ServiceDatabase;
pub use interactions::devcontainer::ensure_toolbox_volume::TOOLBOX_MOUNT_PATH;
#[cfg(unix)]
pub use interactions::project::provision::start_containers_and_spawn;
pub use server::start;
pub use types::{
    ContainerStartParams, DevcontainerConfig, Project, ProjectStatus, ServiceConfig, ServiceError,
};

// ============================================================================
// Public helpers (also used by integration tests)
// ============================================================================

/// List all projects in the service database.
pub fn list_projects(
    conn: &std::sync::Arc<std::sync::Mutex<rusqlite::Connection>>,
) -> Result<Vec<Project>, ServiceError> {
    interactions::project::list::execute(conn)
}

/// Insert a new project into the service database.
pub fn add_project(
    conn: &std::sync::Arc<std::sync::Mutex<rusqlite::Connection>>,
    name: &str,
    path: &str,
    daemon_port: u16,
    shared_secret: &str,
) -> Result<Project, ServiceError> {
    interactions::project::add::execute(conn, name, path, daemon_port, shared_secret)
}

/// Fetch a project by ID.
pub fn get_project(
    conn: &std::sync::Arc<std::sync::Mutex<rusqlite::Connection>>,
    id: &str,
) -> Result<Project, ServiceError> {
    interactions::project::get::execute(conn, id)
}

/// Set or clear the `container_id` for a project.
pub fn set_container_id(
    conn: &std::sync::Arc<std::sync::Mutex<rusqlite::Connection>>,
    id: &str,
    container_id: Option<&str>,
) -> Result<(), ServiceError> {
    interactions::project::update_container_id::execute(conn, id, container_id)
}

/// Update the runtime status, PID, and error message of a project.
pub fn update_project_status(
    conn: &std::sync::Arc<std::sync::Mutex<rusqlite::Connection>>,
    id: &str,
    status: ProjectStatus,
    pid: Option<u32>,
    error_message: Option<&str>,
) -> Result<(), ServiceError> {
    interactions::project::update_status::execute(conn, id, status, pid, error_message)
}

/// Build the toolbox image (if needed) and ensure the toolbox volume is populated.
pub fn ensure_toolbox_volume() -> Result<(), ServiceError> {
    interactions::devcontainer::ensure_toolbox_volume::execute()
}

/// Detect the devcontainer configuration for a project.
pub fn devcontainer_detect(repo_path: &std::path::Path) -> DevcontainerConfig {
    interactions::devcontainer::detect::execute(repo_path)
}

/// Find the Docker container ID for a project, if it exists.
pub fn devcontainer_find_container(project_id: &str) -> Option<String> {
    interactions::devcontainer::find_container::execute(project_id)
}

/// Pull or build the Docker image for a devcontainer config.
pub fn devcontainer_prepare_image(
    config: &DevcontainerConfig,
    repo_path: &std::path::Path,
    project_id: &str,
) -> Result<String, ServiceError> {
    interactions::devcontainer::prepare_image::execute(config, repo_path, project_id)
}

/// Start a Docker container for a project and return its container ID.
pub fn devcontainer_start_container(params: &ContainerStartParams) -> Result<String, ServiceError> {
    interactions::devcontainer::start_container::execute(
        &params.project_id,
        &params.config,
        &params.image,
        &params.repo_path,
        params.port,
        &params.override_dir,
        None,
        params.force_build,
    )
}

/// Stop and remove a project's Docker container.
pub fn devcontainer_stop_container(
    config: &DevcontainerConfig,
    container_id: &str,
    compose_file: Option<&std::path::Path>,
    override_dir: &std::path::Path,
) -> Result<(), ServiceError> {
    interactions::devcontainer::stop_container::execute(
        config,
        container_id,
        compose_file,
        override_dir,
    )
}
