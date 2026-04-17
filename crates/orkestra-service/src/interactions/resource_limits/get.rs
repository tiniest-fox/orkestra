//! Read per-project resource limits from the service database.

use std::sync::{Arc, Mutex};

use rusqlite::{params, Connection};

use crate::types::{ResourceLimits, ServiceError};

/// Return the stored resource limits for `project_id`.
///
/// Both fields are `None` when the project has no per-project override (the common case;
/// the resolver applies host-detection defaults).
pub fn execute(
    conn: &Arc<Mutex<Connection>>,
    project_id: &str,
) -> Result<ResourceLimits, ServiceError> {
    let guard = conn.lock().expect("db mutex poisoned");
    let result = guard.query_row(
        "SELECT cpu_limit, memory_limit_mb FROM service_projects WHERE id = ?",
        params![project_id],
        |row| {
            Ok(ResourceLimits {
                cpu_limit: row.get(0)?,
                memory_limit_mb: row.get(1)?,
            })
        },
    );
    match result {
        Ok(limits) => Ok(limits),
        Err(rusqlite::Error::QueryReturnedNoRows) => {
            Err(ServiceError::ProjectNotFound(project_id.to_string()))
        }
        Err(e) => Err(ServiceError::Database(e)),
    }
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

    fn insert_project(conn: &Arc<Mutex<Connection>>, id: &str) {
        conn.lock()
            .unwrap()
            .execute(
                "INSERT INTO service_projects (id, name, path, daemon_port, shared_secret)
                 VALUES (?, 'p', ?, 3850, 's')",
                rusqlite::params![id, format!("/{id}")],
            )
            .unwrap();
    }

    #[test]
    fn returns_null_limits_for_new_project() {
        let conn = conn();
        insert_project(&conn, "proj1");
        let limits = execute(&conn, "proj1").unwrap();
        assert!(limits.cpu_limit.is_none());
        assert!(limits.memory_limit_mb.is_none());
    }

    #[test]
    fn returns_not_found_for_missing_project() {
        let conn = conn();
        let err = execute(&conn, "nonexistent").unwrap_err();
        assert!(matches!(err, ServiceError::ProjectNotFound(_)));
    }

    #[test]
    fn returns_set_limits() {
        let conn = conn();
        insert_project(&conn, "proj1");
        conn.lock()
            .unwrap()
            .execute(
                "UPDATE service_projects SET cpu_limit = 2.0, memory_limit_mb = 4096 WHERE id = 'proj1'",
                [],
            )
            .unwrap();
        let limits = execute(&conn, "proj1").unwrap();
        assert_eq!(limits.cpu_limit, Some(2.0));
        assert_eq!(limits.memory_limit_mb, Some(4096));
    }
}
