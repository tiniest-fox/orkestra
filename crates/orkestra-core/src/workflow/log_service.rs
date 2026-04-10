//! Unified log reading service for execution logs.
//!
//! This service reads execution logs from the database, which is the single
//! source of truth for all log entries (agent and gate script runs alike).

use std::sync::Arc;

use crate::workflow::domain::LogEntry;
use crate::workflow::ports::{WorkflowResult, WorkflowStore};

/// Service for reading execution logs from the database.
///
/// All log entries are stored in the `log_entries` table, keyed by
/// `stage_session_id`. This service provides a thin wrapper over the
/// store's log query methods.
pub struct LogService {
    store: Arc<dyn WorkflowStore>,
}

impl LogService {
    /// Create a new log service backed by the given store.
    pub fn new(store: Arc<dyn WorkflowStore>) -> Self {
        Self { store }
    }

    /// Get all log entries for a stage session.
    ///
    /// Returns entries ordered by sequence number (insertion order).
    pub fn get_logs(&self, stage_session_id: &str) -> WorkflowResult<Vec<LogEntry>> {
        self.store.get_log_entries(stage_session_id)
    }

    /// Get log entries with `sequence_number` greater than `after_sequence`.
    ///
    /// Returns the entries and the max `sequence_number` as a cursor for the next fetch.
    /// When `after_sequence` is 0, returns all entries.
    pub fn get_logs_after(
        &self,
        stage_session_id: &str,
        after_sequence: u64,
    ) -> WorkflowResult<(Vec<LogEntry>, Option<u64>)> {
        self.store
            .get_log_entries_after(stage_session_id, after_sequence)
    }

    /// Check if a stage session has any log entries in the database.
    pub fn has_logs(&self, stage_session_id: &str) -> WorkflowResult<bool> {
        let entries = self.store.get_log_entries(stage_session_id)?;
        Ok(!entries.is_empty())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::workflow::domain::ToolInput;
    use crate::workflow::InMemoryWorkflowStore;

    #[test]
    fn test_get_logs_empty() {
        let store = Arc::new(InMemoryWorkflowStore::new());
        let service = LogService::new(store);

        let logs = service.get_logs("nonexistent-session").unwrap();
        assert!(logs.is_empty());
    }

    #[test]
    fn test_get_logs_returns_entries() {
        let store = Arc::new(InMemoryWorkflowStore::new());

        // Insert some log entries
        store
            .append_log_entry(
                "session-1",
                &LogEntry::Text {
                    content: "Hello".to_string(),
                },
                None,
            )
            .unwrap();
        store
            .append_log_entry(
                "session-1",
                &LogEntry::ToolUse {
                    tool: "Read".to_string(),
                    id: "tu_1".to_string(),
                    input: ToolInput::Read {
                        file_path: "/foo.rs".to_string(),
                    },
                },
                None,
            )
            .unwrap();

        let service = LogService::new(store);
        let logs = service.get_logs("session-1").unwrap();
        assert_eq!(logs.len(), 2);
    }

    #[test]
    fn test_has_logs_false_when_empty() {
        let store = Arc::new(InMemoryWorkflowStore::new());
        let service = LogService::new(store);

        assert!(!service.has_logs("nonexistent-session").unwrap());
    }

    #[test]
    fn test_has_logs_true_when_entries_exist() {
        let store = Arc::new(InMemoryWorkflowStore::new());

        store
            .append_log_entry(
                "session-1",
                &LogEntry::Text {
                    content: "Hello".to_string(),
                },
                None,
            )
            .unwrap();

        let service = LogService::new(store);
        assert!(service.has_logs("session-1").unwrap());
    }
}
