//! Get all log entries for a stage session, ordered by sequence number.

use orkestra_types::domain::LogEntry;
use rusqlite::{params, Connection};

use crate::interface::{WorkflowError, WorkflowResult};

pub fn execute(conn: &Connection, stage_session_id: &str) -> WorkflowResult<Vec<LogEntry>> {
    let mut stmt = conn
        .prepare(
            "SELECT content FROM log_entries
             WHERE stage_session_id = ?
             ORDER BY sequence_number",
        )
        .map_err(|e| WorkflowError::Storage(e.to_string()))?;

    let rows = stmt
        .query_map(params![stage_session_id], |row| {
            let content_json: String = row.get(0)?;
            Ok(content_json)
        })
        .map_err(|e| WorkflowError::Storage(e.to_string()))?;

    let mut entries = Vec::new();
    for row in rows {
        let json = row.map_err(|e| WorkflowError::Storage(e.to_string()))?;
        // Skip rows with unknown variants (e.g., removed types like `structured_output`).
        if let Ok(entry) = serde_json::from_str::<LogEntry>(&json) {
            entries.push(entry);
        }
    }

    Ok(entries)
}

// ============================================================================
// Tests
// ============================================================================

#[cfg(test)]
mod tests {
    use super::*;
    use crate::interactions::log_entry::append;
    use orkestra_types::domain::LogEntry as LE;
    use rusqlite::Connection;

    fn setup_conn() -> Connection {
        let conn = Connection::open_in_memory().unwrap();
        conn.execute_batch(
            "CREATE TABLE log_entries (
                id TEXT PRIMARY KEY,
                stage_session_id TEXT NOT NULL,
                sequence_number INTEGER NOT NULL,
                content TEXT NOT NULL,
                created_at TEXT NOT NULL DEFAULT '',
                iteration_id TEXT
            );",
        )
        .unwrap();
        conn
    }

    #[test]
    fn unknown_variant_is_skipped() {
        let conn = setup_conn();
        conn.execute(
            "INSERT INTO log_entries (id, stage_session_id, sequence_number, content, created_at)
             VALUES ('id-1', 'sess-1', 1, '{\"type\":\"structured_output\",\"content\":\"old\"}', '')",
            [],
        )
        .unwrap();

        let entries = execute(&conn, "sess-1").unwrap();
        assert!(
            entries.is_empty(),
            "unknown variant should be skipped, not error"
        );
    }

    #[test]
    fn unknown_variant_mixed_with_valid_entries() {
        let conn = setup_conn();
        conn.execute(
            "INSERT INTO log_entries (id, stage_session_id, sequence_number, content, created_at)
             VALUES ('id-1', 'sess-1', 1, '{\"type\":\"structured_output\",\"content\":\"old\"}', '')",
            [],
        )
        .unwrap();
        append::execute(
            &conn,
            "sess-1",
            &LE::Text {
                content: "hello".into(),
            },
            None,
        )
        .unwrap();

        let entries = execute(&conn, "sess-1").unwrap();
        assert_eq!(entries.len(), 1);
        match &entries[0] {
            LE::Text { content } => assert_eq!(content, "hello"),
            _ => panic!("unexpected entry type"),
        }
    }
}
