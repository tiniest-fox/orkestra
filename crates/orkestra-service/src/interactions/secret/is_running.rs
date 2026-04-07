//! Check whether a project's container is currently running.

use rusqlite::{params, Connection, OptionalExtension};

use crate::types::{ProjectStatus, ServiceError};

/// Return `true` if `project_id` has status `running`.
///
/// Called while the database lock is already held, so accepts `&Connection`
/// directly rather than `&Arc<Mutex<Connection>>`.
pub(super) fn execute(conn: &Connection, project_id: &str) -> Result<bool, ServiceError> {
    let status: Option<String> = conn
        .query_row(
            "SELECT status FROM service_projects WHERE id = ?",
            params![project_id],
            |row| row.get(0),
        )
        .optional()?;
    Ok(status.as_deref() == Some(ProjectStatus::Running.as_str()))
}
