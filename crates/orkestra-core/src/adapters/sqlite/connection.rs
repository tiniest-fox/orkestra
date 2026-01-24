//! Database connection wrapper for shared access.
//!
//! Provides thread-safe access to a SQLite connection that can be shared
//! across multiple repositories.

use std::path::Path;
use std::sync::{Arc, Mutex};

use rusqlite::Connection;

use crate::error::{OrkestraError, Result};

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
    pub fn open(path: &Path) -> Result<Self> {
        // Ensure parent directory exists
        if let Some(parent) = path.parent() {
            std::fs::create_dir_all(parent)?;
        }

        let mut conn = Connection::open(path)?;

        // Enable WAL mode for better concurrent access
        conn.execute_batch("PRAGMA journal_mode=WAL;")?;

        // Run migrations
        super::migrations::run(&mut conn)?;

        Ok(Self {
            conn: Arc::new(Mutex::new(conn)),
        })
    }

    /// Create an in-memory database for testing.
    ///
    /// Runs all migrations to ensure schema is initialized.
    pub fn in_memory() -> Result<Self> {
        let mut conn = Connection::open_in_memory()?;

        // Run migrations
        super::migrations::run(&mut conn)?;

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
    pub fn with_conn<T, F>(&self, f: F) -> Result<T>
    where
        F: FnOnce(&Connection) -> Result<T>,
    {
        let conn = self.conn.lock().map_err(|_| OrkestraError::LockError)?;
        f(&conn)
    }

    /// Execute a function with mutable access to the connection.
    pub fn with_conn_mut<T, F>(&self, f: F) -> Result<T>
    where
        F: FnOnce(&mut Connection) -> Result<T>,
    {
        let mut conn = self.conn.lock().map_err(|_| OrkestraError::LockError)?;
        f(&mut conn)
    }

    /// Force a WAL checkpoint to sync the database.
    ///
    /// This ensures all data is written to the main database file,
    /// which is useful for cache coherence across processes.
    pub fn checkpoint(&self) -> Result<()> {
        let conn = self.conn.lock().map_err(|_| OrkestraError::LockError)?;
        conn.execute_batch("PRAGMA wal_checkpoint(TRUNCATE);")?;
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_in_memory_connection() {
        let db = DatabaseConnection::in_memory().unwrap();

        // Should be able to execute queries
        db.with_conn(|conn| {
            let count: i64 = conn.query_row(
                "SELECT COUNT(*) FROM sqlite_master WHERE type='table'",
                [],
                |row| row.get(0),
            )?;
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
