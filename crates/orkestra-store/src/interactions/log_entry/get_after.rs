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

    let after_seq_i64 = i64::try_from(after_sequence)
        .map_err(|_| WorkflowError::Storage("sequence number exceeds i64 range".into()))?;

    let rows = stmt
        .query_map(params![stage_session_id, after_seq_i64], |row| {
            let content_json: String = row.get(0)?;
            let sequence_number: i64 = row.get(1)?;
            Ok((content_json, sequence_number))
        })
        .map_err(|e| WorkflowError::Storage(e.to_string()))?;

    let mut entries = Vec::new();
    let mut max_seq: Option<u64> = None;
    for row in rows {
        let (json, seq) = row.map_err(|e| WorkflowError::Storage(e.to_string()))?;
        // Advance the cursor past every row, including those with unknown variants
        // (e.g., removed types like `structured_output`). Without this, the same
        // unknown rows would be re-fetched on every poll.
        let seq = u64::try_from(seq)
            .map_err(|_| WorkflowError::Storage("negative sequence_number in database".into()))?;
        max_seq = Some(max_seq.map_or(seq, |m| m.max(seq)));
        if let Ok(entry) = serde_json::from_str::<LogEntry>(&json) {
            entries.push(entry);
        }
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

    #[test]
    fn unknown_variant_is_skipped_and_cursor_advances() {
        // Regression guard: rows with unknown variants (e.g., `structured_output` from
        // an older schema) must be skipped, not errored. Critically, `max_seq` must still
        // advance past the skipped row — otherwise every poll would re-fetch the same
        // unknown row and the caller would be stuck.
        let conn = setup_conn();
        conn.execute(
            "INSERT INTO log_entries (id, stage_session_id, sequence_number, content, created_at)
             VALUES ('id-1', 'sess-1', 1, '{\"type\":\"structured_output\",\"content\":\"old\"}', '')",
            [],
        )
        .unwrap();

        let (entries, cursor) = execute(&conn, "sess-1", 0).unwrap();
        assert!(entries.is_empty(), "unknown variant should be skipped");
        assert_eq!(cursor, Some(1), "cursor must advance past the skipped row");
    }

    #[test]
    fn unknown_variant_skipped_valid_entries_returned() {
        // A mix of unknown and known entries: the unknown row is dropped, the known
        // entries are returned, and the cursor advances past everything.
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
                content: "after".into(),
            },
            None,
        )
        .unwrap();

        let (entries, cursor) = execute(&conn, "sess-1", 0).unwrap();
        assert_eq!(entries.len(), 1);
        match &entries[0] {
            LE::Text { content } => assert_eq!(content, "after"),
            _ => panic!("unexpected entry type"),
        }
        assert_eq!(cursor, Some(2));
    }
}
