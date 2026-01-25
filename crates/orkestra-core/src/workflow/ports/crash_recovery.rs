//! Crash recovery port.
//!
//! This trait abstracts over persistence of raw agent output for crash recovery.
//! The output is persisted before parsing so that if the application crashes
//! after the agent completes but before the output is processed, it can be
//! recovered on restart.

use std::io;

// ============================================================================
// Crash Recovery Store Trait
// ============================================================================

/// Port for persisting agent output for crash recovery.
///
/// Implementations store raw stdout from agents before parsing.
/// If the application crashes after the agent finishes but before
/// the output is processed, the pending output can be recovered on restart.
pub trait CrashRecoveryStore: Send + Sync {
    /// Persist raw output for a task stage.
    ///
    /// Overwrites any existing output for this task+stage.
    fn persist(&self, task_id: &str, stage: &str, raw_output: &str) -> io::Result<()>;

    /// Clear the pending output for a task stage.
    ///
    /// Called after successful processing.
    fn clear(&self, task_id: &str, stage: &str) -> io::Result<()>;

    /// List all pending outputs.
    ///
    /// Returns (task_id, stage) pairs for all pending outputs.
    fn list_pending(&self) -> Vec<(String, String)>;

    /// Read a pending output.
    ///
    /// Returns None if no pending output exists for this task+stage.
    fn read(&self, task_id: &str, stage: &str) -> Option<String>;
}

// ============================================================================
// In-Memory Implementation (for testing)
// ============================================================================

#[cfg(any(test, feature = "testutil"))]
pub mod memory {
    use super::*;
    use std::collections::HashMap;
    use std::sync::Mutex;

    /// In-memory crash recovery store for testing.
    #[derive(Default)]
    pub struct InMemoryCrashRecoveryStore {
        outputs: Mutex<HashMap<(String, String), String>>,
    }

    impl InMemoryCrashRecoveryStore {
        /// Create a new in-memory crash recovery store.
        pub fn new() -> Self {
            Self::default()
        }
    }

    impl CrashRecoveryStore for InMemoryCrashRecoveryStore {
        fn persist(&self, task_id: &str, stage: &str, raw_output: &str) -> io::Result<()> {
            let mut outputs = self.outputs.lock().unwrap();
            outputs.insert((task_id.to_string(), stage.to_string()), raw_output.to_string());
            Ok(())
        }

        fn clear(&self, task_id: &str, stage: &str) -> io::Result<()> {
            let mut outputs = self.outputs.lock().unwrap();
            outputs.remove(&(task_id.to_string(), stage.to_string()));
            Ok(())
        }

        fn list_pending(&self) -> Vec<(String, String)> {
            let outputs = self.outputs.lock().unwrap();
            outputs.keys().cloned().collect()
        }

        fn read(&self, task_id: &str, stage: &str) -> Option<String> {
            let outputs = self.outputs.lock().unwrap();
            outputs.get(&(task_id.to_string(), stage.to_string())).cloned()
        }
    }

    #[cfg(test)]
    mod tests {
        use super::*;

        #[test]
        fn test_persist_and_read() {
            let store = InMemoryCrashRecoveryStore::new();

            store.persist("task-1", "planning", "raw output").unwrap();

            let output = store.read("task-1", "planning");
            assert_eq!(output, Some("raw output".to_string()));
        }

        #[test]
        fn test_clear() {
            let store = InMemoryCrashRecoveryStore::new();

            store.persist("task-1", "planning", "raw output").unwrap();
            store.clear("task-1", "planning").unwrap();

            let output = store.read("task-1", "planning");
            assert!(output.is_none());
        }

        #[test]
        fn test_list_pending() {
            let store = InMemoryCrashRecoveryStore::new();

            store.persist("task-1", "planning", "output1").unwrap();
            store.persist("task-2", "work", "output2").unwrap();

            let pending = store.list_pending();
            assert_eq!(pending.len(), 2);
        }

        #[test]
        fn test_overwrite() {
            let store = InMemoryCrashRecoveryStore::new();

            store.persist("task-1", "planning", "first").unwrap();
            store.persist("task-1", "planning", "second").unwrap();

            let output = store.read("task-1", "planning");
            assert_eq!(output, Some("second".to_string()));
        }
    }
}
