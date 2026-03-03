//! Revokes a device by ID, preventing future connections.

use std::sync::{Arc, Mutex};

use rusqlite::{params, Connection};

use crate::types::AuthError;

/// Revoke a device by ID, preventing future connections.
pub fn execute(conn: &Arc<Mutex<Connection>>, device_id: &str) -> Result<(), AuthError> {
    let conn = conn.lock().map_err(|_| AuthError::Lock)?;

    let affected = conn
        .execute(
            "UPDATE device_tokens SET revoked = 1 WHERE id = ? AND revoked = 0",
            params![device_id],
        )
        .map_err(|e| AuthError::Storage(e.to_string()))?;

    if affected == 0 {
        return Err(AuthError::InvalidToken);
    }

    Ok(())
}
