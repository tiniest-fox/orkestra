//! Get all log entries with iteration metadata for a stage session.

use orkestra_types::domain::{AnnotatedLogEntry, LogEntry};
use rusqlite::{params, Connection};

use crate::interface::{WorkflowError, WorkflowResult};

pub fn execute(
    conn: &Connection,
    stage_session_id: &str,
) -> WorkflowResult<Vec<AnnotatedLogEntry>> {
    let mut stmt = conn
        .prepare(
            "SELECT content, iteration_id FROM log_entries
             WHERE stage_session_id = ?
             ORDER BY sequence_number",
        )
        .map_err(|e| WorkflowError::Storage(e.to_string()))?;

    let rows = stmt
        .query_map(params![stage_session_id], |row| {
            let content_json: String = row.get(0)?;
            let iteration_id: Option<String> = row.get(1)?;
            Ok((content_json, iteration_id))
        })
        .map_err(|e| WorkflowError::Storage(e.to_string()))?;

    let mut entries = Vec::new();
    for row in rows {
        let (json, iteration_id) = row.map_err(|e| WorkflowError::Storage(e.to_string()))?;
        // Skip rows with unknown variants (e.g., removed types like `structured_output`).
        if let Ok(entry) = serde_json::from_str::<LogEntry>(&json) {
            entries.push(AnnotatedLogEntry {
                entry,
                iteration_id,
            });
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
    fn test_append_with_iteration_id() {
        let conn = setup_conn();
        let entry = LE::Text {
            content: "hello".into(),
        };
        append::execute(&conn, "session-1", &entry, Some("iter-abc")).unwrap();

        let annotated = execute(&conn, "session-1").unwrap();
        assert_eq!(annotated.len(), 1);
        assert_eq!(annotated[0].iteration_id, Some("iter-abc".to_string()));
        assert_eq!(annotated[0].entry, entry);
    }

    #[test]
    fn test_get_annotated_without_iteration_id() {
        let conn = setup_conn();
        let entry = LE::Text {
            content: "no iter".into(),
        };
        append::execute(&conn, "session-1", &entry, None).unwrap();

        let annotated = execute(&conn, "session-1").unwrap();
        assert_eq!(annotated.len(), 1);
        assert_eq!(annotated[0].iteration_id, None);
    }

    #[test]
    fn unknown_variant_is_skipped() {
        let conn = setup_conn();
        conn.execute(
            "INSERT INTO log_entries (id, stage_session_id, sequence_number, content, created_at)
             VALUES ('id-1', 'session-1', 1, '{\"type\":\"structured_output\",\"content\":\"old\"}', '')",
            [],
        )
        .unwrap();

        let annotated = execute(&conn, "session-1").unwrap();
        assert!(annotated.is_empty(), "unknown variant should be skipped, not error");
    }

    #[test]
    fn test_get_annotated_log_entries() {
        let conn = setup_conn();

        append::execute(
            &conn,
            "session-1",
            &LE::Text {
                content: "first".into(),
            },
            Some("iter-1"),
        )
        .unwrap();
        append::execute(
            &conn,
            "session-1",
            &LE::Text {
                content: "second".into(),
            },
            None,
        )
        .unwrap();
        append::execute(
            &conn,
            "session-1",
            &LE::Text {
                content: "third".into(),
            },
            Some("iter-2"),
        )
        .unwrap();

        let annotated = execute(&conn, "session-1").unwrap();
        assert_eq!(annotated.len(), 3);
        assert_eq!(annotated[0].iteration_id, Some("iter-1".to_string()));
        assert_eq!(annotated[1].iteration_id, None);
        assert_eq!(annotated[2].iteration_id, Some("iter-2".to_string()));

        // Verify ordering by sequence number
        match &annotated[0].entry {
            LE::Text { content } => assert_eq!(content, "first"),
            _ => panic!("unexpected entry type"),
        }
        match &annotated[2].entry {
            LE::Text { content } => assert_eq!(content, "third"),
            _ => panic!("unexpected entry type"),
        }
    }
}
