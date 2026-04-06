//! Retrieve and decrypt a single project secret.

use std::sync::{Arc, Mutex};

use rusqlite::{params, Connection};

use crate::interactions::secret::encrypt;
use crate::types::{SecretValue, ServiceError};

/// Fetch and decrypt the secret identified by `key` for `project_id`.
///
/// Returns `ServiceError::SecretNotFound` if the row does not exist (handler maps to 404).
pub fn execute(
    conn: &Arc<Mutex<Connection>>,
    project_id: &str,
    key: &str,
    secrets_key: &str,
) -> Result<SecretValue, ServiceError> {
    let guard = conn.lock().expect("db mutex poisoned");
    let result = guard.query_row(
        "SELECT key, encrypted_value, nonce, created_at, updated_at
         FROM project_secrets
         WHERE project_id = ? AND key = ?",
        params![project_id, key],
        |row| {
            Ok((
                row.get::<_, String>(0)?,
                row.get::<_, Vec<u8>>(1)?,
                row.get::<_, Vec<u8>>(2)?,
                row.get::<_, String>(3)?,
                row.get::<_, String>(4)?,
            ))
        },
    );
    drop(guard);

    match result {
        Ok((k, ciphertext, nonce, created_at, updated_at)) => {
            let value = encrypt::decrypt(&ciphertext, &nonce, secrets_key)?;
            Ok(SecretValue {
                key: k,
                value,
                created_at,
                updated_at,
            })
        }
        Err(rusqlite::Error::QueryReturnedNoRows) => {
            Err(ServiceError::SecretNotFound(key.to_string()))
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
    use crate::interactions::secret::encrypt;
    use crate::types::ServiceError;

    const VALID_KEY: &str = "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";

    fn conn() -> Arc<Mutex<Connection>> {
        let c = Connection::open_in_memory().unwrap();
        crate::database::apply_migrations_for_test(&c);
        c.execute_batch("PRAGMA foreign_keys=ON;").unwrap();
        Arc::new(Mutex::new(c))
    }

    fn insert_project(conn: &Arc<Mutex<Connection>>, id: &str) {
        let path = format!("/{id}");
        conn.lock()
            .unwrap()
            .execute(
                "INSERT INTO service_projects (id, name, path, daemon_port, shared_secret) VALUES (?, 'p', ?, 3850, 's')",
                rusqlite::params![id, path],
            )
            .unwrap();
    }

    fn insert_encrypted_secret(
        conn: &Arc<Mutex<Connection>>,
        project_id: &str,
        key: &str,
        value: &str,
    ) {
        let (ct, nonce) = encrypt::encrypt(value, VALID_KEY).unwrap();
        conn.lock()
            .unwrap()
            .execute(
                "INSERT INTO project_secrets (project_id, key, encrypted_value, nonce) VALUES (?, ?, ?, ?)",
                rusqlite::params![project_id, key, ct, nonce],
            )
            .unwrap();
    }

    #[test]
    fn decrypts_existing_secret() {
        let conn = conn();
        insert_project(&conn, "proj1");
        insert_encrypted_secret(&conn, "proj1", "MY_KEY", "my_value");
        let result = execute(&conn, "proj1", "MY_KEY", VALID_KEY).unwrap();
        assert_eq!(result.key, "MY_KEY");
        assert_eq!(result.value, "my_value");
    }

    #[test]
    fn returns_not_found_for_missing_key() {
        let conn = conn();
        insert_project(&conn, "proj1");
        let err = execute(&conn, "proj1", "MISSING", VALID_KEY).unwrap_err();
        assert!(matches!(err, ServiceError::SecretNotFound(_)));
    }

    #[test]
    fn returns_not_found_for_wrong_project() {
        let conn = conn();
        insert_project(&conn, "proj1");
        insert_project(&conn, "proj2");
        insert_encrypted_secret(&conn, "proj1", "MY_KEY", "val");
        let err = execute(&conn, "proj2", "MY_KEY", VALID_KEY).unwrap_err();
        assert!(matches!(err, ServiceError::SecretNotFound(_)));
    }
}
