//! Insert a subfolder project linked to a parent project.

use std::sync::{Arc, Mutex};

use rusqlite::{params, Connection};
use uuid::Uuid;

use crate::types::{Project, ServiceError};

/// Insert a subfolder project record and return the created record.
///
/// Status starts as `starting` — no clone is needed because the parent repo
/// already exists on disk. Returns `ServiceError::DuplicatePath` if a project
/// with the same path already exists.
pub fn execute(
    conn: &Arc<Mutex<Connection>>,
    name: &str,
    path: &str,
    daemon_port: u16,
    shared_secret: &str,
    parent_project_id: &str,
    subfolder: &str,
) -> Result<Project, ServiceError> {
    let id = Uuid::new_v4().to_string();
    let guard = conn.lock().expect("db mutex poisoned");

    match guard.execute(
        "INSERT INTO service_projects
             (id, name, path, daemon_port, shared_secret, status, parent_project_id, subfolder)
         VALUES (?, ?, ?, ?, ?, 'starting', ?, ?)",
        params![
            id,
            name,
            path,
            daemon_port,
            shared_secret,
            parent_project_id,
            subfolder
        ],
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
                cpu_limit, memory_limit_mb, parent_project_id, subfolder
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

    fn add_parent(conn: &Arc<Mutex<Connection>>) -> String {
        let parent = crate::interactions::project::add::execute(
            conn,
            "Parent",
            "/repos/myapp",
            3850,
            "parent-secret",
        )
        .unwrap();
        parent.id
    }

    #[test]
    fn creates_subfolder_project() {
        let conn = conn();
        let parent_id = add_parent(&conn);

        let project = execute(
            &conn,
            "MyApp/frontend",
            "/repos/myapp/frontend",
            3851,
            "sub-secret",
            &parent_id,
            "frontend",
        )
        .unwrap();

        assert_eq!(project.name, "MyApp/frontend");
        assert_eq!(project.path, "/repos/myapp/frontend");
        assert_eq!(project.daemon_port, 3851);
        assert_eq!(project.parent_project_id.as_deref(), Some(&*parent_id));
        assert_eq!(project.subfolder.as_deref(), Some("frontend"));
        assert!(!project.id.is_empty());
    }

    #[test]
    fn rejects_duplicate_path() {
        let conn = conn();
        let parent_id = add_parent(&conn);

        execute(
            &conn,
            "sub1",
            "/repos/myapp/frontend",
            3851,
            "s1",
            &parent_id,
            "frontend",
        )
        .unwrap();

        let err = execute(
            &conn,
            "sub2",
            "/repos/myapp/frontend",
            3852,
            "s2",
            &parent_id,
            "frontend",
        )
        .unwrap_err();

        assert!(matches!(err, ServiceError::DuplicatePath(_)));
    }
}
