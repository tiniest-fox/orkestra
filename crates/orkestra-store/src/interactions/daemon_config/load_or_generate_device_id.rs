//! Load or generate a persistent device ID for relay registration.

use rusqlite::{Connection, OptionalExtension};

use crate::interface::WorkflowError;

pub fn execute(conn: &Connection) -> Result<String, WorkflowError> {
    let existing: Option<String> = conn
        .query_row(
            "SELECT value FROM daemon_config WHERE key = 'device_id'",
            [],
            |row| row.get(0),
        )
        .optional()
        .map_err(|e| WorkflowError::Storage(format!("Failed to query device ID: {e}")))?;

    if let Some(id) = existing {
        return Ok(id);
    }

    let new_id = uuid::Uuid::new_v4().to_string();
    conn.execute(
        "INSERT INTO daemon_config (key, value) VALUES ('device_id', ?1)",
        rusqlite::params![new_id],
    )
    .map_err(|e| WorkflowError::Storage(format!("Failed to persist device ID: {e}")))?;

    Ok(new_id)
}
