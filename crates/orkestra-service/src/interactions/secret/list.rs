//! List secret keys (without values) for a project.

use std::sync::{Arc, Mutex};

use rusqlite::{params, Connection};

use crate::types::{SecretEntry, ServiceError};

/// Return all secret key entries for `project_id`, ordered by key.
///
/// Values are never returned — only key names and timestamps.
pub fn execute(
    conn: &Arc<Mutex<Connection>>,
    project_id: &str,
) -> Result<Vec<SecretEntry>, ServiceError> {
    let guard = conn.lock().expect("db mutex poisoned");
    let mut stmt = guard.prepare(
        "SELECT key, created_at, updated_at
         FROM project_secrets
         WHERE project_id = ?
         ORDER BY key",
    )?;
    let entries = stmt
        .query_map(params![project_id], |row| {
            Ok(SecretEntry {
                key: row.get(0)?,
                created_at: row.get(1)?,
                updated_at: row.get(2)?,
            })
        })?
        .collect::<Result<Vec<_>, _>>()?;
    Ok(entries)
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

    fn insert_project(conn: &Arc<Mutex<Connection>>, id: &str) {
        conn.lock()
            .unwrap()
            .execute(
                "INSERT INTO service_projects (id, name, path, daemon_port, shared_secret)
             VALUES (?, 'p', '/p', 3850, 's')",
                rusqlite::params![id],
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
    fn empty_when_no_secrets() {
        let conn = conn();
        insert_project(&conn, "proj1");
        let result = execute(&conn, "proj1").unwrap();
        assert!(result.is_empty());
    }

    #[test]
    fn returns_keys_ordered() {
        let conn = conn();
        insert_project(&conn, "proj1");
        insert_secret(&conn, "proj1", "ZEBRA");
        insert_secret(&conn, "proj1", "ALPHA");
        let result = execute(&conn, "proj1").unwrap();
        assert_eq!(result.len(), 2);
        assert_eq!(result[0].key, "ALPHA");
        assert_eq!(result[1].key, "ZEBRA");
    }
}
