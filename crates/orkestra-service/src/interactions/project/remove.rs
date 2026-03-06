//! Delete a project and its associated daemon tokens.

use std::sync::{Arc, Mutex};

use rusqlite::{params, Connection};

use crate::types::ServiceError;

/// Delete the project with `id` and cascade-remove its `daemon_tokens` rows.
///
/// Returns `ServiceError::ProjectNotFound` if no project with that ID exists.
pub fn execute(conn: &Arc<Mutex<Connection>>, id: &str) -> Result<(), ServiceError> {
    let guard = conn.lock().expect("db mutex poisoned");
    guard.execute_batch("BEGIN")?;

    let result = (|| {
        // Remove associated daemon tokens first (no FK cascade in SQLite by default).
        guard.execute(
            "DELETE FROM daemon_tokens WHERE project_id = ?",
            params![id],
        )?;

        let affected = guard.execute("DELETE FROM service_projects WHERE id = ?", params![id])?;

        if affected == 0 {
            return Err(ServiceError::ProjectNotFound(id.to_string()));
        }

        Ok(())
    })();

    match result {
        Ok(()) => {
            guard.execute_batch("COMMIT")?;
            Ok(())
        }
        Err(e) => {
            let _ = guard.execute_batch("ROLLBACK");
            Err(e)
        }
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

    #[test]
    fn removes_project() {
        let conn = conn();
        let p = crate::interactions::project::add::execute(&conn, "X", "/x", 3850, "s").unwrap();
        execute(&conn, &p.id).unwrap();
        let projects = crate::interactions::project::list::execute(&conn).unwrap();
        assert!(projects.is_empty());
    }

    #[test]
    fn returns_not_found_for_unknown_id() {
        let conn = conn();
        let err = execute(&conn, "bogus").unwrap_err();
        assert!(matches!(err, ServiceError::ProjectNotFound(_)));
    }

    #[test]
    fn removes_associated_daemon_tokens() {
        let conn = conn();
        let p = crate::interactions::project::add::execute(&conn, "Y", "/y", 3850, "s").unwrap();

        // Insert a daemon_token for this project.
        {
            let guard = conn.lock().unwrap();
            guard
                .execute(
                    "INSERT INTO daemon_tokens (device_id, project_id, token)
                     VALUES ('dev1', ?, 'tok')",
                    rusqlite::params![p.id],
                )
                .unwrap();
        }

        execute(&conn, &p.id).unwrap();

        // Confirm the daemon_token was also removed.
        let count: i64 = {
            let guard = conn.lock().unwrap();
            guard
                .query_row(
                    "SELECT COUNT(*) FROM daemon_tokens WHERE project_id = ?",
                    rusqlite::params![p.id],
                    |row| row.get(0),
                )
                .unwrap()
        };
        assert_eq!(count, 0);
    }
}
