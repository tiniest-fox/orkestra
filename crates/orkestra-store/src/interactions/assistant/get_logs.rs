//! Get all log entries for an assistant session, ordered by sequence number.

use orkestra_types::domain::LogEntry;
use rusqlite::{params, Connection};

use crate::interface::{WorkflowError, WorkflowResult};

pub fn execute(conn: &Connection, assistant_session_id: &str) -> WorkflowResult<Vec<LogEntry>> {
    let mut stmt = conn
        .prepare(
            "SELECT content FROM log_entries
             WHERE assistant_session_id = ?
             ORDER BY sequence_number",
        )
        .map_err(|e| WorkflowError::Storage(e.to_string()))?;

    let rows = stmt
        .query_map(params![assistant_session_id], |row| {
            let content_json: String = row.get(0)?;
            Ok(content_json)
        })
        .map_err(|e| WorkflowError::Storage(e.to_string()))?;

    let mut entries = Vec::new();
    for row in rows {
        let json = row.map_err(|e| WorkflowError::Storage(e.to_string()))?;
        let entry: LogEntry =
            serde_json::from_str(&json).map_err(|e| WorkflowError::Storage(e.to_string()))?;
        entries.push(entry);
    }

    Ok(entries)
}
