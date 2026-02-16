//! Append a log entry to an assistant session.

use orkestra_types::domain::LogEntry;
use rusqlite::{params, Connection};

use crate::interface::{WorkflowError, WorkflowResult};

pub fn execute(
    conn: &Connection,
    assistant_session_id: &str,
    entry: &LogEntry,
) -> WorkflowResult<()> {
    let content_json =
        serde_json::to_string(entry).map_err(|e| WorkflowError::Storage(e.to_string()))?;

    conn.execute(
        "INSERT INTO log_entries (id, assistant_session_id, sequence_number, content, created_at)
         VALUES (?, ?, (SELECT COALESCE(MAX(sequence_number), 0) + 1 FROM log_entries WHERE assistant_session_id = ?), ?, datetime('now'))",
        params![
            uuid::Uuid::new_v4().to_string(),
            assistant_session_id,
            assistant_session_id,
            content_json,
        ],
    )
    .map_err(|e| WorkflowError::Storage(e.to_string()))?;

    Ok(())
}
