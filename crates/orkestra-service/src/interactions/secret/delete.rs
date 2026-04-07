//! Delete a project secret.

use std::sync::{Arc, Mutex};

use rusqlite::{params, Connection};

use crate::interactions::secret::is_running;
use crate::types::ServiceError;

/// Delete the secret identified by `key` for `project_id`.
///
/// Idempotent — deleting a non-existent secret succeeds.
/// Returns `true` if the project is currently running (`restart_required`).
pub fn execute(
    conn: &Arc<Mutex<Connection>>,
    project_id: &str,
    key: &str,
) -> Result<bool, ServiceError> {
    let guard = conn.lock().expect("db mutex poisoned");
    guard.execute(
        "DELETE FROM project_secrets WHERE project_id = ? AND key = ?",
        params![project_id, key],
    )?;

    let restart_required = is_running::execute(&guard, project_id)?;
    Ok(restart_required)
}

// ============================================================================
// Tests
// ============================================================================

#[cfg(test)]
mod tests {
    use std::sync::{Arc, Mutex};

    use rusqlite::Connection;

    use super::execute;

    fn conn() -> Arc<Mutex<Connection>> {
        let c = Connection::open_in_memory().unwrap();
        crate::database::apply_migrations_for_test(&c);
        c.execute_batch("PRAGMA foreign_keys=ON;").unwrap();
        Arc::new(Mutex::new(c))
    }

    fn insert_project(conn: &Arc<Mutex<Connection>>, id: &str, status: &str) {
        conn.lock()
            .unwrap()
            .execute(
                "INSERT INTO service_projects (id, name, path, daemon_port, shared_secret, status)
             VALUES (?, 'p', '/p', 3850, 's', ?)",
                rusqlite::params![id, status],
            )
            .unwrap();
    }

    fn insert_secret(conn: &Arc<Mutex<Connection>>, project_id: &str, key: &str) {
        conn.lock()
            .unwrap()
            .execute(
                "INSERT INTO project_secrets (project_id, key, encrypted_value, nonce)
             VALUES (?, ?, X'deadbeef', X'cafebabe')",
                rusqlite::params![project_id, key],
            )
            .unwrap();
    }

    #[test]
    fn delete_is_idempotent() {
        let conn = conn();
        insert_project(&conn, "proj1", "stopped");
        // Deleting non-existent secret should not fail.
        execute(&conn, "proj1", "MISSING").unwrap();
    }

    #[test]
    fn delete_removes_secret() {
        let conn = conn();
        insert_project(&conn, "proj1", "stopped");
        insert_secret(&conn, "proj1", "MY_KEY");

        execute(&conn, "proj1", "MY_KEY").unwrap();

        let count: i64 = conn.lock().unwrap().query_row(
            "SELECT COUNT(*) FROM project_secrets WHERE project_id = 'proj1' AND key = 'MY_KEY'",
            [],
            |r| r.get(0),
        ).unwrap();
        assert_eq!(count, 0);
    }

    #[test]
    fn restart_required_when_running() {
        let conn = conn();
        insert_project(&conn, "proj1", "running");
        insert_secret(&conn, "proj1", "MY_KEY");
        let restart = execute(&conn, "proj1", "MY_KEY").unwrap();
        assert!(restart);
    }

    #[test]
    fn no_restart_required_when_stopped() {
        let conn = conn();
        insert_project(&conn, "proj1", "stopped");
        insert_secret(&conn, "proj1", "MY_KEY");
        let restart = execute(&conn, "proj1", "MY_KEY").unwrap();
        assert!(!restart);
    }
}
