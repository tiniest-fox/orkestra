//! Lists all non-revoked paired devices.

use std::sync::{Arc, Mutex};

use rusqlite::Connection;

use crate::types::{AuthError, PairedDevice};

/// List all non-revoked paired devices.
pub fn execute(conn: &Arc<Mutex<Connection>>) -> Result<Vec<PairedDevice>, AuthError> {
    let conn = conn.lock().map_err(|_| AuthError::Lock)?;

    let mut stmt = conn
        .prepare(
            "SELECT id, device_name, created_at, last_used_at \
             FROM device_tokens WHERE revoked = 0 ORDER BY created_at ASC",
        )
        .map_err(|e| AuthError::Storage(e.to_string()))?;

    let devices = stmt
        .query_map([], |row| {
            Ok(PairedDevice {
                id: row.get(0)?,
                device_name: row.get(1)?,
                created_at: row.get(2)?,
                last_used_at: row.get(3)?,
            })
        })
        .map_err(|e| AuthError::Storage(e.to_string()))?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|e| AuthError::Storage(e.to_string()))?;

    Ok(devices)
}
