//! Create or update a project secret (upsert).

use std::sync::{Arc, Mutex};

use rusqlite::{params, Connection, OptionalExtension};

use crate::interactions::secret::encrypt;
use crate::types::{ProjectStatus, ServiceError};

/// Upsert the secret `key` with `value` for `project_id`.
///
/// Returns `true` if the project is currently running (`restart_required`).
///
/// Validates that `key` matches `[A-Za-z_][A-Za-z0-9_]*`. Returns
/// `ServiceError::SecretKeyInvalid` on failure (handler maps to 400).
pub fn execute(
    conn: &Arc<Mutex<Connection>>,
    project_id: &str,
    key: &str,
    value: &str,
    secrets_key: &str,
) -> Result<bool, ServiceError> {
    validate_key(key)?;

    let (ciphertext, nonce) = encrypt::encrypt(value, secrets_key)?;

    let guard = conn.lock().expect("db mutex poisoned");
    guard.execute(
        "INSERT INTO project_secrets (project_id, key, encrypted_value, nonce)
         VALUES (?, ?, ?, ?)
         ON CONFLICT (project_id, key) DO UPDATE SET
             encrypted_value = excluded.encrypted_value,
             nonce = excluded.nonce,
             updated_at = datetime('now')",
        params![project_id, key, ciphertext, nonce],
    )?;

    let restart_required = is_running(&guard, project_id)?;
    Ok(restart_required)
}

// -- Helpers --

fn validate_key(key: &str) -> Result<(), ServiceError> {
    let mut chars = key.chars();
    let valid = match chars.next() {
        Some(c) if c.is_ascii_alphabetic() || c == '_' => {
            chars.all(|c| c.is_ascii_alphanumeric() || c == '_')
        }
        _ => false,
    };
    if valid {
        Ok(())
    } else {
        Err(ServiceError::SecretKeyInvalid(format!(
            "{key}. Must match [A-Za-z_][A-Za-z0-9_]*"
        )))
    }
}

fn is_running(guard: &rusqlite::Connection, project_id: &str) -> Result<bool, ServiceError> {
    let status: Option<String> = guard
        .query_row(
            "SELECT status FROM service_projects WHERE id = ?",
            params![project_id],
            |row| row.get(0),
        )
        .optional()?;
    Ok(status.as_deref() == Some(ProjectStatus::Running.as_str()))
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

    const VALID_KEY: &str = "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";

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

    #[test]
    fn rejects_invalid_key_name() {
        let conn = conn();
        insert_project(&conn, "proj1", "stopped");
        let err = execute(&conn, "proj1", "123INVALID", "val", VALID_KEY).unwrap_err();
        assert!(matches!(err, ServiceError::SecretKeyInvalid(_)));
    }

    #[test]
    fn rejects_empty_key() {
        let conn = conn();
        insert_project(&conn, "proj1", "stopped");
        let err = execute(&conn, "proj1", "", "val", VALID_KEY).unwrap_err();
        assert!(matches!(err, ServiceError::SecretKeyInvalid(_)));
    }

    #[test]
    fn accepts_valid_key_names() {
        let conn = conn();
        insert_project(&conn, "proj1", "stopped");
        execute(&conn, "proj1", "MY_SECRET", "val", VALID_KEY).unwrap();
        execute(&conn, "proj1", "_UNDER", "val", VALID_KEY).unwrap();
        execute(&conn, "proj1", "ABC123", "val", VALID_KEY).unwrap();
    }
}
