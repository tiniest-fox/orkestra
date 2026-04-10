//! Get log entries with `sequence_number` greater than `after_sequence`.

use orkestra_types::domain::LogEntry;
use rusqlite::{params, Connection};

use crate::interface::{WorkflowError, WorkflowResult};

/// Returns log entries after the given sequence number and the max `sequence_number` of those entries.
///
/// When `after_sequence` is 0, returns all entries.
/// Returns `(entries, Some(max_seq))` when entries exist, `(vec![], None)` when empty.
pub fn execute(
    conn: &Connection,
    stage_session_id: &str,
    after_sequence: u64,
) -> WorkflowResult<(Vec<LogEntry>, Option<u64>)> {
    let mut stmt = conn
        .prepare(
            "SELECT content, sequence_number FROM log_entries
             WHERE stage_session_id = ? AND sequence_number > ?
             ORDER BY sequence_number",
        )
        .map_err(|e| WorkflowError::Storage(e.to_string()))?;

    let rows = stmt
        .query_map(
            params![stage_session_id, after_sequence.cast_signed()],
            |row| {
                let content_json: String = row.get(0)?;
                let sequence_number: i64 = row.get(1)?;
                Ok((content_json, sequence_number))
            },
        )
        .map_err(|e| WorkflowError::Storage(e.to_string()))?;

    let mut entries = Vec::new();
    let mut max_seq: Option<u64> = None;
    for row in rows {
        let (json, seq) = row.map_err(|e| WorkflowError::Storage(e.to_string()))?;
        let entry: LogEntry =
            serde_json::from_str(&json).map_err(|e| WorkflowError::Storage(e.to_string()))?;
        entries.push(entry);
        let seq = seq.cast_unsigned();
        max_seq = Some(max_seq.map_or(seq, |m| m.max(seq)));
    }

    Ok((entries, max_seq))
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
    fn empty_session_returns_no_entries() {
        let conn = setup_conn();
        let (entries, cursor) = execute(&conn, "nonexistent-session", 0).unwrap();
        assert!(entries.is_empty());
        assert!(cursor.is_none());
    }

    #[test]
    fn cursor_zero_returns_all_entries() {
        let conn = setup_conn();
        append::execute(
            &conn,
            "sess-1",
            &LE::Text {
                content: "first".into(),
            },
            None,
        )
        .unwrap();
        append::execute(
            &conn,
            "sess-1",
            &LE::Text {
                content: "second".into(),
            },
            None,
        )
        .unwrap();
        append::execute(
            &conn,
            "sess-1",
            &LE::Text {
                content: "third".into(),
            },
            None,
        )
        .unwrap();

        let (entries, cursor) = execute(&conn, "sess-1", 0).unwrap();
        assert_eq!(entries.len(), 3);
        assert_eq!(cursor, Some(3));
    }

    #[test]
    fn cursor_n_returns_only_new_entries() {
        let conn = setup_conn();
        append::execute(
            &conn,
            "sess-1",
            &LE::Text {
                content: "first".into(),
            },
            None,
        )
        .unwrap();
        append::execute(
            &conn,
            "sess-1",
            &LE::Text {
                content: "second".into(),
            },
            None,
        )
        .unwrap();
        append::execute(
            &conn,
            "sess-1",
            &LE::Text {
                content: "third".into(),
            },
            None,
        )
        .unwrap();

        let (entries, cursor) = execute(&conn, "sess-1", 2).unwrap();
        assert_eq!(entries.len(), 1);
        match &entries[0] {
            LE::Text { content } => assert_eq!(content, "third"),
            _ => panic!("unexpected entry type"),
        }
        assert_eq!(cursor, Some(3));
    }

    #[test]
    fn cursor_beyond_max_returns_empty() {
        let conn = setup_conn();
        append::execute(
            &conn,
            "sess-1",
            &LE::Text {
                content: "first".into(),
            },
            None,
        )
        .unwrap();
        append::execute(
            &conn,
            "sess-1",
            &LE::Text {
                content: "second".into(),
            },
            None,
        )
        .unwrap();

        let (entries, cursor) = execute(&conn, "sess-1", 100).unwrap();
        assert!(entries.is_empty());
        assert!(cursor.is_none());
    }
}
