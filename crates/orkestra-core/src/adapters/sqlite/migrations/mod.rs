//! Database migrations using Refinery.
//!
//! Migrations are embedded at compile time and run automatically
//! when opening a database connection.

use refinery::embed_migrations;
use rusqlite::Connection;

use crate::error::Result;

// Embed all SQL migration files from this directory
embed_migrations!("src/adapters/sqlite/migrations");

/// Run all pending migrations on the connection.
///
/// This is called automatically when opening a database connection.
/// It's safe to call multiple times - already-applied migrations are skipped.
pub fn run(conn: &mut Connection) -> Result<()> {
    migrations::runner()
        .run(conn)
        .map_err(|e| crate::error::OrkestraError::InvalidInput(format!("Migration error: {}", e)))?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_migrations_are_valid() {
        let mut conn = Connection::open_in_memory().unwrap();
        run(&mut conn).unwrap();

        // Verify tables exist
        let tables: Vec<String> = conn
            .prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name")
            .unwrap()
            .query_map([], |row| row.get(0))
            .unwrap()
            .filter_map(|r| r.ok())
            .collect();

        assert!(tables.contains(&"tasks".to_string()));
        assert!(tables.contains(&"work_loops".to_string()));
        assert!(tables.contains(&"stage_sessions".to_string()));
        assert!(tables.contains(&"iterations".to_string()));
    }

    #[test]
    fn test_migrations_are_idempotent() {
        let mut conn = Connection::open_in_memory().unwrap();

        // Run twice - should be no-op second time
        run(&mut conn).unwrap();
        run(&mut conn).unwrap();

        // Should still work
        let count: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM sqlite_master WHERE type='table'",
                [],
                |row| row.get(0),
            )
            .unwrap();
        assert!(count > 0);
    }
}
