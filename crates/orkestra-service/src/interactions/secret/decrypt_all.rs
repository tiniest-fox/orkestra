//! Decrypt all secrets for a project — used by container start to inject env vars.

use std::sync::{Arc, Mutex};

use rusqlite::{params, Connection};

use crate::interactions::secret::encrypt;
use crate::types::ServiceError;

/// Return all decrypted `(key, value)` pairs for `project_id`.
///
/// If `secrets_key` is `None`, logs a warning and returns an empty vec —
/// secrets injection is silently skipped rather than failing the start.
///
/// Returns `Err` if any secret fails to decrypt — this indicates key rotation
/// or data corruption and must surface to the caller.
pub fn execute(
    conn: &Arc<Mutex<Connection>>,
    project_id: &str,
    secrets_key: Option<&str>,
) -> Result<Vec<(String, String)>, ServiceError> {
    let Some(secrets_key) = secrets_key else {
        tracing::warn!(
            "ORKESTRA_SECRETS_KEY not set — skipping secret injection for project {project_id}"
        );
        return Ok(vec![]);
    };

    let rows: Vec<(String, Vec<u8>, Vec<u8>)> = {
        let guard = conn.lock().expect("db mutex poisoned");
        let mut stmt = guard.prepare(
            "SELECT key, encrypted_value, nonce FROM project_secrets WHERE project_id = ?",
        )?;
        let collected = stmt
            .query_map(params![project_id], |row| {
                Ok((
                    row.get::<_, String>(0)?,
                    row.get::<_, Vec<u8>>(1)?,
                    row.get::<_, Vec<u8>>(2)?,
                ))
            })?
            .collect::<Result<Vec<_>, _>>()?;
        collected
    };

    let mut pairs = Vec::with_capacity(rows.len());
    for (key, ciphertext, nonce) in rows {
        let value = encrypt::decrypt(&ciphertext, &nonce, secrets_key).map_err(|e| {
            ServiceError::Other(format!(
                "Failed to decrypt secret '{key}' for project {project_id}: {e}"
            ))
        })?;
        pairs.push((key, value));
    }

    Ok(pairs)
}

// ============================================================================
// Tests
// ============================================================================

#[cfg(test)]
mod tests {
    use std::sync::{Arc, Mutex};

    use rusqlite::Connection;

    use super::execute;
    use crate::interactions::secret::encrypt;

    const VALID_KEY: &str = "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";

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

    fn insert_secret_raw(
        conn: &Arc<Mutex<Connection>>,
        project_id: &str,
        key: &str,
        ciphertext: &[u8],
        nonce: &[u8],
    ) {
        conn.lock()
            .unwrap()
            .execute(
                "INSERT INTO project_secrets (project_id, key, encrypted_value, nonce)
             VALUES (?, ?, ?, ?)",
                rusqlite::params![project_id, key, ciphertext, nonce],
            )
            .unwrap();
    }

    #[test]
    fn returns_empty_when_no_secrets() {
        let conn = conn();
        insert_project(&conn, "proj1");
        let result = execute(&conn, "proj1", Some(VALID_KEY)).unwrap();
        assert!(result.is_empty());
    }

    #[test]
    fn returns_empty_when_key_is_none() {
        let conn = conn();
        insert_project(&conn, "proj1");
        let result = execute(&conn, "proj1", None).unwrap();
        assert!(result.is_empty());
    }

    #[test]
    fn returns_decrypted_pairs() {
        let conn = conn();
        insert_project(&conn, "proj1");

        let (ct, nonce) = encrypt::encrypt("hello", VALID_KEY).unwrap();
        insert_secret_raw(&conn, "proj1", "MY_VAR", &ct, &nonce);

        let result = execute(&conn, "proj1", Some(VALID_KEY)).unwrap();
        assert_eq!(result.len(), 1);
        assert_eq!(result[0].0, "MY_VAR");
        assert_eq!(result[0].1, "hello");
    }

    #[test]
    fn fails_when_any_secret_cannot_decrypt() {
        let conn = conn();
        insert_project(&conn, "proj1");

        // Insert a valid secret.
        let (ct, nonce) = encrypt::encrypt("good_value", VALID_KEY).unwrap();
        insert_secret_raw(&conn, "proj1", "GOOD_VAR", &ct, &nonce);

        // Insert a garbage ciphertext for the second secret.
        insert_secret_raw(&conn, "proj1", "BAD_VAR", b"garbage_ciphertext", &[0u8; 12]);

        let result = execute(&conn, "proj1", Some(VALID_KEY));
        assert!(result.is_err());
    }
}
