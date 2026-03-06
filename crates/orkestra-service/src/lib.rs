//! Foundation crate for the ork-service binary — database, domain types, project CRUD, and HTTP server.

pub(crate) mod daemon_supervisor;
pub(crate) mod database;
pub(crate) mod interactions;
pub(crate) mod server;
pub mod types;

pub use daemon_supervisor::DaemonSupervisor;
pub use database::ServiceDatabase;
pub use server::start;
pub use types::{Project, ProjectStatus, ServiceConfig, ServiceError};

/// List all projects in the service database.
pub fn list_projects(
    conn: &std::sync::Arc<std::sync::Mutex<rusqlite::Connection>>,
) -> Result<Vec<Project>, ServiceError> {
    interactions::project::list::execute(conn)
}
