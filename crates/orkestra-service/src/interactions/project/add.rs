//! Insert a new project into the service database.

use std::sync::{Arc, Mutex};

use rusqlite::{params, Connection};
use uuid::Uuid;

use crate::types::{Project, ServiceError};

/// Insert a new project and return the created record.
///
/// Generates a fresh UUID as the project ID and initialises status as
/// `cloning`. Returns `ServiceError::DuplicatePath` if a project with the
/// same path already exists.
pub fn execute(
    conn: &Arc<Mutex<Connection>>,
    name: &str,
    path: &str,
    daemon_port: u16,
    shared_secret: &str,
) -> Result<Project, ServiceError> {
    let id = Uuid::new_v4().to_string();
    let guard = conn.lock().expect("db mutex poisoned");

    match guard.execute(
        "INSERT INTO service_projects (id, name, path, daemon_port, shared_secret, status)
         VALUES (?, ?, ?, ?, ?, 'cloning')",
        params![id, name, path, daemon_port, shared_secret],
    ) {
        Ok(_) => {}
        Err(rusqlite::Error::SqliteFailure(err, _))
            if err.code == rusqlite::ffi::ErrorCode::ConstraintViolation =>
        {
            return Err(ServiceError::DuplicatePath(path.to_string()));
        }
        Err(e) => return Err(ServiceError::Database(e)),
    }

    let project = guard.query_row(
        "SELECT id, name, path, daemon_port, shared_secret, status,
                error_message, pid, created_at, container_id,
                cpu_limit, memory_limit_mb
         FROM service_projects WHERE id = ?",
        params![id],
        super::get::map_row,
    )?;

    Ok(project)
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
    fn adds_project() {
        let conn = conn();
        let project = execute(&conn, "MyApp", "/repos/myapp", 3850, "secret123").unwrap();
        assert_eq!(project.name, "MyApp");
        assert_eq!(project.path, "/repos/myapp");
        assert_eq!(project.daemon_port, 3850);
        assert!(!project.id.is_empty());
    }

    #[test]
    fn rejects_duplicate_path() {
        let conn = conn();
        execute(&conn, "A", "/same/path", 3850, "s1").unwrap();
        let err = execute(&conn, "B", "/same/path", 3851, "s2").unwrap_err();
        assert!(matches!(err, ServiceError::DuplicatePath(_)));
    }
}
