//! Database connection wrapper for shared access.
//!
//! Provides thread-safe access to a `SQLite` connection that can be shared
//! across multiple repositories.

use std::path::Path;
use std::sync::{Arc, Mutex};

use rusqlite::Connection;

use crate::interface::{WorkflowError, WorkflowResult};

/// Shared database connection wrapper.
///
/// Provides thread-safe access to the `SQLite` connection. All repositories
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

        let mut conn = Connection::open(path).map_err(|e| WorkflowError::Storage(e.to_string()))?;

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
        let mut conn =
            Connection::open_in_memory().map_err(|e| WorkflowError::Storage(e.to_string()))?;

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
    /// If the database is corrupted (`quick_check` returns false or a
    /// `SQLITE_CORRUPT` error), renames it to `{name}.corrupt.{timestamp}`
    /// and creates a fresh database. Returns the connection and whether recovery
    /// occurred.
    ///
    /// When `quick_check` fails with a transient error (e.g., `SQLITE_BUSY` or
    /// `SQLITE_LOCKED` from another process holding a write lock), validation is
    /// skipped and the connection is returned as-is — the database is not treated
    /// as corrupt.
    pub fn open_validated(path: &Path) -> WorkflowResult<(Self, bool)> {
        match Self::open(path) {
            Ok(db) => match db.quick_check_raw() {
                Ok(true) => Ok((db, false)),
                Ok(false) => {
                    eprintln!("[db] Database corruption detected, recovering...");
                    drop(db);
                    Self::recover_corrupted(path)
                }
                Err(e) if is_corruption_error(&e) => {
                    eprintln!("[db] Integrity check indicates corruption ({e}), recovering...");
                    drop(db);
                    Self::recover_corrupted(path)
                }
                Err(e) => {
                    eprintln!("[db] Integrity check skipped ({e}), proceeding without validation");
                    Ok((db, false))
                }
            },
            Err(e) => {
                eprintln!("[db] Failed to open database ({e}), recovering...");
                Self::recover_corrupted(path)
            }
        }
    }

    /// Run `PRAGMA quick_check` and return the raw rusqlite error on failure.
    ///
    /// Unlike `quick_check()`, this preserves the `rusqlite::Error` type so
    /// callers can inspect the error code (e.g., to distinguish lock contention
    /// from actual corruption).
    fn quick_check_raw(&self) -> Result<bool, rusqlite::Error> {
        let conn = self
            .conn
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner);
        let result: String = conn.query_row("PRAGMA quick_check;", [], |row| row.get(0))?;
        Ok(result == "ok")
    }

    /// Move a corrupted database aside and create a fresh one.
    ///
    /// Returns an error if another orchestrator process is currently running,
    /// to prevent a second instance from wiping a healthy database.
    fn recover_corrupted(path: &Path) -> WorkflowResult<(Self, bool)> {
        if let Some(pid) = active_orchestrator_pid(path) {
            return Err(WorkflowError::Storage(format!(
                "Cannot recover database: orchestrator PID {pid} is still running. \
                 Close the other Orkestra instance first."
            )));
        }

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
// Helpers
// ============================================================================

/// Return `true` only when `err` is a `SQLite` database corruption error.
///
/// Lock contention (`BUSY`, `LOCKED`) and all other errors are not corruption
/// and must not trigger recovery.
fn is_corruption_error(err: &rusqlite::Error) -> bool {
    matches!(
        err,
        rusqlite::Error::SqliteFailure(
            rusqlite::ffi::Error {
                code: rusqlite::ffi::ErrorCode::DatabaseCorrupt,
                ..
            },
            _
        )
    )
}

/// Return the PID of a live orchestrator process, if one is holding the lock.
///
/// Reads `.orkestra/orchestrator.lock` relative to the database path
/// (`.orkestra/.database/orkestra.db` → `.orkestra/`). Returns `None` when the
/// lock file is absent, unreadable, unparseable, or contains a dead PID.
fn active_orchestrator_pid(db_path: &Path) -> Option<u32> {
    let orkestra_dir = db_path.parent()?.parent()?;
    let lock_path = orkestra_dir.join("orchestrator.lock");
    let contents = std::fs::read_to_string(&lock_path).ok()?;
    let pid = contents.trim().parse::<u32>().ok()?;
    orkestra_process::is_process_running(pid).then_some(pid)
}

// ============================================================================
// Tests
// ============================================================================

#[cfg(test)]
mod tests {
    use tempfile::TempDir;

    use super::*;

    // -- Helpers --

    /// Create `.orkestra/.database/` under `tmp` and return the DB path.
    fn setup_db_dir(tmp: &TempDir) -> std::path::PathBuf {
        let db_dir = tmp.path().join(".orkestra").join(".database");
        std::fs::create_dir_all(&db_dir).unwrap();
        db_dir.join("orkestra.db")
    }

    /// Write `pid` to `.orkestra/orchestrator.lock` under `tmp`.
    fn write_lock_file(tmp: &TempDir, pid: u32) {
        let lock_path = tmp.path().join(".orkestra").join("orchestrator.lock");
        std::fs::write(&lock_path, pid.to_string()).unwrap();
    }

    /// Overwrite a database file with garbage so `SQLite` cannot open it.
    ///
    /// Replaces the file contents entirely so `SQLite` returns `SQLITE_NOTADB` on
    /// the first read, before it can consult the WAL file for recovery.
    fn corrupt_db(path: &std::path::Path) {
        std::fs::write(path, b"corrupted").unwrap();
    }

    // -- Existing tests --

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

    // -- Fix 1: is_corruption_error tests --

    #[test]
    fn test_is_corruption_error_sqlite_corrupt() {
        let err = rusqlite::Error::SqliteFailure(
            rusqlite::ffi::Error {
                code: rusqlite::ffi::ErrorCode::DatabaseCorrupt,
                extended_code: 0,
            },
            None,
        );
        assert!(is_corruption_error(&err));
    }

    #[test]
    fn test_is_corruption_error_sqlite_busy() {
        let err = rusqlite::Error::SqliteFailure(
            rusqlite::ffi::Error {
                code: rusqlite::ffi::ErrorCode::DatabaseBusy,
                extended_code: 0,
            },
            None,
        );
        assert!(!is_corruption_error(&err));
    }

    #[test]
    fn test_is_corruption_error_sqlite_locked() {
        let err = rusqlite::Error::SqliteFailure(
            rusqlite::ffi::Error {
                code: rusqlite::ffi::ErrorCode::DatabaseLocked,
                extended_code: 0,
            },
            None,
        );
        assert!(!is_corruption_error(&err));
    }

    #[test]
    fn test_is_corruption_error_other() {
        let err = rusqlite::Error::SqliteFailure(
            rusqlite::ffi::Error {
                code: rusqlite::ffi::ErrorCode::Unknown,
                extended_code: 0,
            },
            None,
        );
        assert!(!is_corruption_error(&err));
    }

    // -- Fix 1: open_validated integration tests --

    #[test]
    fn test_open_validated_healthy_db() {
        let tmp = TempDir::new().unwrap();
        let db_path = setup_db_dir(&tmp);

        let (_db, recovered) = DatabaseConnection::open_validated(&db_path).unwrap();
        assert!(!recovered);
    }

    #[test]
    fn test_open_validated_corrupted_db() {
        let tmp = TempDir::new().unwrap();
        let db_path = setup_db_dir(&tmp);

        // Create a valid database, then corrupt it
        DatabaseConnection::open(&db_path).unwrap();
        corrupt_db(&db_path);

        let (_db, recovered) = DatabaseConnection::open_validated(&db_path).unwrap();
        assert!(recovered);
    }

    // -- Fix 2: active_orchestrator_pid tests --

    #[test]
    fn test_active_orchestrator_pid_no_lock_file() {
        let tmp = TempDir::new().unwrap();
        let db_path = setup_db_dir(&tmp);

        assert_eq!(active_orchestrator_pid(&db_path), None);
    }

    #[test]
    fn test_active_orchestrator_pid_stale_pid() {
        let tmp = TempDir::new().unwrap();
        let db_path = setup_db_dir(&tmp);
        write_lock_file(&tmp, 99_999_999);

        assert_eq!(active_orchestrator_pid(&db_path), None);
    }

    #[test]
    fn test_active_orchestrator_pid_live_pid() {
        let tmp = TempDir::new().unwrap();
        let db_path = setup_db_dir(&tmp);
        let pid = std::process::id();
        write_lock_file(&tmp, pid);

        assert_eq!(active_orchestrator_pid(&db_path), Some(pid));
    }

    // -- Fix 2: recover_corrupted guard tests --

    #[test]
    fn test_recover_blocked_by_live_orchestrator() {
        let tmp = TempDir::new().unwrap();
        let db_path = setup_db_dir(&tmp);
        let pid = std::process::id();

        // Create a valid database, corrupt it, write our own PID to the lock
        DatabaseConnection::open(&db_path).unwrap();
        corrupt_db(&db_path);
        write_lock_file(&tmp, pid);

        let err = DatabaseConnection::open_validated(&db_path)
            .err()
            .expect("open_validated should fail with a live orchestrator");
        let msg = err.to_string();
        assert!(
            msg.contains(&pid.to_string()),
            "Error should mention the blocking PID: {msg}"
        );
    }

    #[test]
    fn test_recover_proceeds_with_stale_lock() {
        let tmp = TempDir::new().unwrap();
        let db_path = setup_db_dir(&tmp);

        DatabaseConnection::open(&db_path).unwrap();
        corrupt_db(&db_path);
        write_lock_file(&tmp, 99_999_999);

        let (_db, recovered) = DatabaseConnection::open_validated(&db_path).unwrap();
        assert!(recovered);
    }

    #[test]
    fn test_recover_proceeds_without_lock() {
        let tmp = TempDir::new().unwrap();
        let db_path = setup_db_dir(&tmp);

        DatabaseConnection::open(&db_path).unwrap();
        corrupt_db(&db_path);

        let (_db, recovered) = DatabaseConnection::open_validated(&db_path).unwrap();
        assert!(recovered);
    }
}
