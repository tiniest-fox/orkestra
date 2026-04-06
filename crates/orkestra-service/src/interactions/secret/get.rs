//! Retrieve and decrypt a single project secret.

use std::sync::{Arc, Mutex};

use rusqlite::{params, Connection};

use crate::interactions::secret::encrypt;
use crate::types::{SecretValue, ServiceError};

/// Fetch and decrypt the secret identified by `key` for `project_id`.
///
/// Returns `ServiceError::Other("Secrets key not configured")` if
/// `ORKESTRA_SECRETS_KEY` is absent (handler maps to 503).
/// Returns `ServiceError::Other("Secret not found: {key}")` if the row does
/// not exist (handler maps to 404).
pub fn execute(
    conn: &Arc<Mutex<Connection>>,
    project_id: &str,
    key: &str,
) -> Result<SecretValue, ServiceError> {
    let secrets_key = encrypt::read_secrets_key()
        .ok_or_else(|| ServiceError::Other("Secrets key not configured".to_string()))?;

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
            let value = encrypt::decrypt(&ciphertext, &nonce, &secrets_key)?;
            Ok(SecretValue {
                key: k,
                value,
                created_at,
                updated_at,
            })
        }
        Err(rusqlite::Error::QueryReturnedNoRows) => {
            Err(ServiceError::Other(format!("Secret not found: {key}")))
        }
        Err(e) => Err(ServiceError::Database(e)),
    }
}
