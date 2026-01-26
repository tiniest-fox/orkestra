//! Filesystem-based crash recovery adapter.
//!
//! This adapter implements CrashRecoveryStore using the filesystem.
//! Pending outputs are stored in `.orkestra/pending-outputs/`.

use std::fs;
use std::io;
use std::path::{Path, PathBuf};

use crate::orkestra_debug;
use crate::workflow::ports::CrashRecoveryStore;

// ============================================================================
// Filesystem Crash Recovery Store
// ============================================================================

/// Filesystem-based crash recovery store.
///
/// Stores pending agent outputs as files in a directory.
/// File naming: `{task_id}_{stage}.json`
pub struct FsCrashRecoveryStore {
    /// Directory for pending outputs.
    dir: PathBuf,
}

impl FsCrashRecoveryStore {
    /// Create a new filesystem crash recovery store.
    pub fn new(dir: impl Into<PathBuf>) -> Self {
        Self { dir: dir.into() }
    }

    /// Create from a project root directory.
    ///
    /// Uses `.orkestra/pending-outputs/` under the project root.
    pub fn from_project_root(project_root: &Path) -> Self {
        Self {
            dir: project_root.join(".orkestra/pending-outputs"),
        }
    }

    /// Get the path for a pending output file.
    fn output_path(&self, task_id: &str, stage: &str) -> PathBuf {
        self.dir.join(format!("{task_id}_{stage}.json"))
    }

    /// Ensure the directory exists.
    fn ensure_dir(&self) -> io::Result<()> {
        if !self.dir.exists() {
            fs::create_dir_all(&self.dir)?;
        }
        Ok(())
    }
}

impl CrashRecoveryStore for FsCrashRecoveryStore {
    fn persist(&self, task_id: &str, stage: &str, raw_output: &str) -> io::Result<()> {
        self.ensure_dir()?;
        let path = self.output_path(task_id, stage);
        orkestra_debug!(
            "recovery",
            "persist {}_{}: {} bytes",
            task_id,
            stage,
            raw_output.len()
        );
        fs::write(&path, raw_output)
    }

    fn clear(&self, task_id: &str, stage: &str) -> io::Result<()> {
        let path = self.output_path(task_id, stage);
        if path.exists() {
            orkestra_debug!("recovery", "clear {}_{}", task_id, stage);
            fs::remove_file(&path)?;
        }
        Ok(())
    }

    fn list_pending(&self) -> Vec<(String, String)> {
        if !self.dir.exists() {
            return Vec::new();
        }

        let mut results = Vec::new();
        if let Ok(entries) = fs::read_dir(&self.dir) {
            for entry in entries.flatten() {
                let path = entry.path();
                if path.extension().is_some_and(|e| e == "json") {
                    if let Some(stem) = path.file_stem().and_then(|s| s.to_str()) {
                        // Parse "{task_id}_{stage}.json" format
                        if let Some((task_id, stage)) = stem.rsplit_once('_') {
                            results.push((task_id.to_string(), stage.to_string()));
                        }
                    }
                }
            }
        }
        orkestra_debug!("recovery", "list_pending: found {} files", results.len());
        results
    }

    fn read(&self, task_id: &str, stage: &str) -> Option<String> {
        let path = self.output_path(task_id, stage);
        let result = fs::read_to_string(path).ok();
        if let Some(ref content) = result {
            orkestra_debug!(
                "recovery",
                "read {}_{}: {} bytes",
                task_id,
                stage,
                content.len()
            );
        }
        result
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::TempDir;

    fn create_test_store() -> (FsCrashRecoveryStore, TempDir) {
        let temp_dir = TempDir::new().unwrap();
        let store = FsCrashRecoveryStore::new(temp_dir.path().join("pending-outputs"));
        (store, temp_dir)
    }

    #[test]
    fn test_output_path() {
        let (store, _temp) = create_test_store();
        let path = store.output_path("task-1", "planning");
        assert!(path.to_string_lossy().contains("task-1_planning.json"));
    }

    #[test]
    fn test_persist_and_read() {
        let (store, _temp) = create_test_store();

        let output = r#"{"type": "completed", "summary": "Done"}"#;
        store.persist("task-1", "planning", output).unwrap();

        let read = store.read("task-1", "planning");
        assert_eq!(read, Some(output.to_string()));
    }

    #[test]
    fn test_clear() {
        let (store, _temp) = create_test_store();

        store.persist("task-1", "planning", "output").unwrap();
        store.clear("task-1", "planning").unwrap();

        let read = store.read("task-1", "planning");
        assert!(read.is_none());
    }

    #[test]
    fn test_clear_nonexistent() {
        let (store, _temp) = create_test_store();

        // Should not error when clearing nonexistent file
        let result = store.clear("nonexistent", "stage");
        assert!(result.is_ok());
    }

    #[test]
    fn test_list_pending() {
        let (store, _temp) = create_test_store();

        store.persist("task-1", "planning", "{}").unwrap();
        store.persist("task-2", "work", "{}").unwrap();

        let pending = store.list_pending();
        assert_eq!(pending.len(), 2);
        assert!(pending.iter().any(|(t, s)| t == "task-1" && s == "planning"));
        assert!(pending.iter().any(|(t, s)| t == "task-2" && s == "work"));
    }

    #[test]
    fn test_list_pending_empty_dir() {
        let (store, _temp) = create_test_store();

        let pending = store.list_pending();
        assert!(pending.is_empty());
    }

    #[test]
    fn test_read_nonexistent() {
        let (store, _temp) = create_test_store();

        let read = store.read("nonexistent", "stage");
        assert!(read.is_none());
    }

    #[test]
    fn test_overwrite() {
        let (store, _temp) = create_test_store();

        store.persist("task-1", "planning", "first").unwrap();
        store.persist("task-1", "planning", "second").unwrap();

        let read = store.read("task-1", "planning");
        assert_eq!(read, Some("second".to_string()));
    }

    #[test]
    fn test_from_project_root() {
        let temp_dir = TempDir::new().unwrap();
        let store = FsCrashRecoveryStore::from_project_root(temp_dir.path());

        // Should use .orkestra/pending-outputs/ path
        let path = store.output_path("task-1", "planning");
        assert!(path.to_string_lossy().contains(".orkestra/pending-outputs/"));
    }
}
