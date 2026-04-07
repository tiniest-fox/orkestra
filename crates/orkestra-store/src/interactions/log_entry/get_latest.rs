//! Get the most recent log entry for a stage session.

use orkestra_types::domain::LogEntry;
use rusqlite::{params, Connection, OptionalExtension};

use crate::interface::{WorkflowError, WorkflowResult};

pub fn execute(conn: &Connection, stage_session_id: &str) -> WorkflowResult<Option<LogEntry>> {
    let mut stmt = conn
        .prepare(
            "SELECT content FROM log_entries
             WHERE stage_session_id = ?
             ORDER BY sequence_number DESC
             LIMIT 1",
        )
        .map_err(|e| WorkflowError::Storage(e.to_string()))?;

    let result = stmt
        .query_row(params![stage_session_id], |row| {
            let content_json: String = row.get(0)?;
            Ok(content_json)
        })
        .optional()
        .map_err(|e| WorkflowError::Storage(e.to_string()))?;

    result
        .map(|json| {
            serde_json::from_str::<LogEntry>(&json)
                .map_err(|e| WorkflowError::Storage(e.to_string()))
        })
        .transpose()
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
    fn returns_none_for_empty_session() {
        let conn = setup_conn();
        let result = execute(&conn, "session-1").unwrap();
        assert!(result.is_none());
    }

    #[test]
    fn returns_latest_entry_by_sequence() {
        let conn = setup_conn();

        // Insert three entries manually to control sequence numbers.
        let entries: Vec<LE> = vec![
            LE::Text {
                content: "first".into(),
            },
            LE::Text {
                content: "second".into(),
            },
            LE::Text {
                content: "third".into(),
            },
        ];
        for entry in &entries {
            append::execute(&conn, "session-1", entry, None).unwrap();
        }

        let result = execute(&conn, "session-1").unwrap();
        assert!(result.is_some());
        match result.unwrap() {
            LE::Text { content } => assert_eq!(content, "third"),
            _ => panic!("unexpected entry type"),
        }
    }

    #[test]
    fn ignores_entries_for_other_sessions() {
        let conn = setup_conn();

        append::execute(
            &conn,
            "session-other",
            &LE::Text {
                content: "other".into(),
            },
            None,
        )
        .unwrap();

        let result = execute(&conn, "session-1").unwrap();
        assert!(result.is_none());
    }
}
