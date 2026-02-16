//! Database connection wrapper for shared access.
//!
//! Provides thread-safe access to a SQLite connection that can be shared
//! across multiple repositories.

use std::path::Path;
use std::sync::{Arc, Mutex};

use rusqlite::Connection;

use crate::interface::{WorkflowError, WorkflowResult};

/// Shared database connection wrapper.
///
/// Provides thread-safe access to the SQLite connection. All repositories
/// hold a clone of the `Arc<Mutex<Connection>>` to share the same connection.
pub struct DatabaseConnection {
    conn: Arc<Mutex<Connection>>,
}

impl DatabaseConnection {
    /// Create a new connection to a database file.
    ///
    /// Enables WAL mode and runs all pending migrations.
    pub fn open(path: &Path) -> WorkflowResult<Self> {
        // Ensure parent directory exists
        if let Some(parent) = path.parent() {
            std::fs::create_dir_all(parent)
                .map_err(|e| WorkflowError::Storage(format!("Failed to create directory: {e}")))?;
        }

        let mut conn = Connection::open(path)
            .map_err(|e| WorkflowError::Storage(e.to_string()))?;

        // Enable WAL mode for better concurrent access and crash safety.
        // WAL ensures readers never block writers and incomplete transactions
        // are automatically rolled back on recovery.
        conn.execute_batch("PRAGMA journal_mode=WAL;")
            .map_err(|e| WorkflowError::Storage(e.to_string()))?;

        // Wait up to 5s for locks instead of failing immediately.
        // Prevents spurious errors when the orchestrator and UI commands
        // contend for the same connection.
        conn.execute_batch("PRAGMA busy_timeout=5000;")
            .map_err(|e| WorkflowError::Storage(e.to_string()))?;

        // Run migrations
        crate::migrations::run(&mut conn)?;

        Ok(Self {
            conn: Arc::new(Mutex::new(conn)),
        })
    }

    /// Create an in-memory database for testing.
    ///
    /// Runs all migrations to ensure schema is initialized.
    pub fn in_memory() -> WorkflowResult<Self> {
        let mut conn = Connection::open_in_memory()
            .map_err(|e| WorkflowError::Storage(e.to_string()))?;

        // Run migrations
        crate::migrations::run(&mut conn)?;

        Ok(Self {
            conn: Arc::new(Mutex::new(conn)),
        })
    }

    /// Get a clone of the shared connection Arc.
    ///
    /// Repositories hold this to access the connection.
    pub fn shared(&self) -> Arc<Mutex<Connection>> {
        self.conn.clone()
    }

    /// Execute a function with exclusive access to the connection.
    pub fn with_conn<T, F>(&self, f: F) -> WorkflowResult<T>
    where
        F: FnOnce(&Connection) -> WorkflowResult<T>,
    {
        let conn = self.conn.lock().map_err(|_| WorkflowError::Lock)?;
        f(&conn)
    }

    /// Execute a function with mutable access to the connection.
    pub fn with_conn_mut<T, F>(&self, f: F) -> WorkflowResult<T>
    where
        F: FnOnce(&mut Connection) -> WorkflowResult<T>,
    {
        let mut conn = self.conn.lock().map_err(|_| WorkflowError::Lock)?;
        f(&mut conn)
    }

    /// Force a WAL checkpoint to sync the database.
    ///
    /// Flushes all WAL data into the main database file and truncates the WAL.
    /// Call this on graceful shutdown to leave the database in a clean state.
    pub fn checkpoint(&self) -> WorkflowResult<()> {
        let conn = self.conn.lock().map_err(|_| WorkflowError::Lock)?;
        conn.execute_batch("PRAGMA wal_checkpoint(TRUNCATE);")
            .map_err(|e| WorkflowError::Storage(e.to_string()))?;
        Ok(())
    }

    /// Run a quick integrity check on the database.
    ///
    /// Returns `Ok(true)` if the database is healthy, `Ok(false)` if corrupted.
    /// This is fast (checks page structure, not full content) and should be
    /// called on startup to detect corruption early.
    pub fn quick_check(&self) -> WorkflowResult<bool> {
        let conn = self.conn.lock().map_err(|_| WorkflowError::Lock)?;
        let result: String = conn
            .query_row("PRAGMA quick_check;", [], |row| row.get(0))
            .map_err(|e| WorkflowError::Storage(e.to_string()))?;
        Ok(result == "ok")
    }

    /// Open a database with integrity validation.
    ///
    /// If the database is corrupted, renames it to `{name}.corrupt.{timestamp}`
    /// and creates a fresh database. Returns the connection and whether recovery
    /// occurred.
    pub fn open_validated(path: &Path) -> WorkflowResult<(Self, bool)> {
        // Try to open and validate
        match Self::open(path) {
            Ok(db) => match db.quick_check() {
                Ok(true) => Ok((db, false)),
                Ok(false) => {
                    eprintln!("[db] Database corruption detected, recovering...");
                    drop(db);
                    Self::recover_corrupted(path)
                }
                Err(e) => {
                    eprintln!("[db] Integrity check failed ({e}), recovering...");
                    drop(e);
                    Self::recover_corrupted(path)
                }
            },
            Err(e) => {
                eprintln!("[db] Failed to open database ({e}), recovering...");
                Self::recover_corrupted(path)
            }
        }
    }

    /// Move a corrupted database aside and create a fresh one.
    fn recover_corrupted(path: &Path) -> WorkflowResult<(Self, bool)> {
        let timestamp = chrono::Utc::now().format("%Y%m%dT%H%M%S");
        let file_name = path.file_name().unwrap_or_default().to_string_lossy();
        let backup_name = format!("{file_name}.corrupt.{timestamp}");
        let backup_path = path.with_file_name(&backup_name);

        // Move the corrupted database file (preserves it for forensics)
        if path.exists() {
            let _ = std::fs::rename(path, &backup_path);
        }

        // Remove ephemeral WAL/SHM files — they're tied to the old database
        let wal_path = path.with_file_name(format!("{file_name}-wal"));
        let shm_path = path.with_file_name(format!("{file_name}-shm"));
        let _ = std::fs::remove_file(&wal_path);
        let _ = std::fs::remove_file(&shm_path);

        eprintln!("[db] Corrupted database moved to {backup_name}");

        let db = Self::open(path)?;
        Ok((db, true))
    }
}

// ============================================================================
// Tests
// ============================================================================

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_in_memory_connection() {
        let db = DatabaseConnection::in_memory().unwrap();

        // Should be able to execute queries
        db.with_conn(|conn| {
            let count: i64 = conn
                .query_row(
                    "SELECT COUNT(*) FROM sqlite_master WHERE type='table'",
                    [],
                    |row| row.get(0),
                )
                .map_err(|e| WorkflowError::Storage(e.to_string()))?;
            // Should have at least the tasks table from migrations
            assert!(count > 0);
            Ok(())
        })
        .unwrap();
    }

    #[test]
    fn test_shared_connection() {
        let db = DatabaseConnection::in_memory().unwrap();

        let conn1 = db.shared();
        let conn2 = db.shared();

        // Both should point to the same connection
        assert!(Arc::ptr_eq(&conn1, &conn2));
    }
}
