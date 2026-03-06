//! Fetch a single project by ID.

use std::sync::{Arc, Mutex};

use rusqlite::{params, Connection, OptionalExtension};

use crate::types::{Project, ProjectStatus, ServiceError};

/// Return the project with the given `id`, or `ServiceError::ProjectNotFound`.
pub fn execute(conn: &Arc<Mutex<Connection>>, id: &str) -> Result<Project, ServiceError> {
    let guard = conn.lock().expect("db mutex poisoned");
    guard
        .query_row(
            "SELECT id, name, path, daemon_port, shared_secret, status,
                    error_message, pid, created_at
             FROM service_projects WHERE id = ?",
            params![id],
            map_row,
        )
        .optional()?
        .ok_or_else(|| ServiceError::ProjectNotFound(id.to_string()))
}

// -- Helpers --

pub(super) fn map_row(row: &rusqlite::Row<'_>) -> rusqlite::Result<Project> {
    let status_str: String = row.get(5)?;
    let status = status_str.parse::<ProjectStatus>().map_err(|e| {
        rusqlite::Error::FromSqlConversionFailure(5, rusqlite::types::Type::Text, Box::new(e))
    })?;
    let pid_i64: Option<i64> = row.get(7)?;
    Ok(Project {
        id: row.get(0)?,
        name: row.get(1)?,
        path: row.get(2)?,
        daemon_port: {
            let v: i64 = row.get(3)?;
            v as u16
        },
        shared_secret: row.get(4)?,
        status,
        error_message: row.get(6)?,
        pid: pid_i64.map(|v| v as u32),
        created_at: row.get(8)?,
    })
}

// ============================================================================
// Tests
// ============================================================================

#[cfg(test)]
mod tests {
    use std::sync::{Arc, Mutex};

    use rusqlite::Connection;

    use super::execute;
    use crate::types::ServiceError;

    fn conn() -> Arc<Mutex<Connection>> {
        let c = Connection::open_in_memory().unwrap();
        crate::database::apply_migrations_for_test(&c);
        Arc::new(Mutex::new(c))
    }

    #[test]
    fn returns_not_found_for_missing_id() {
        let conn = conn();
        let err = execute(&conn, "nonexistent").unwrap_err();
        assert!(matches!(err, ServiceError::ProjectNotFound(_)));
    }

    #[test]
    fn returns_project_after_add() {
        let conn = conn();
        let added =
            crate::interactions::project::add::execute(&conn, "App", "/p", 3850, "sec").unwrap();
        let fetched = execute(&conn, &added.id).unwrap();
        assert_eq!(fetched.id, added.id);
        assert_eq!(fetched.name, "App");
    }
}
