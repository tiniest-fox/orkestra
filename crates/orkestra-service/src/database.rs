//! Service database connection — opens, migrates, and shares the `SQLite` connection.

use std::path::Path;
use std::sync::{Arc, Mutex};

use rusqlite::Connection;

use crate::types::ServiceError;

const MIGRATION_V1: &str = "
CREATE TABLE IF NOT EXISTS service_projects (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    path TEXT NOT NULL UNIQUE,
    daemon_port INTEGER NOT NULL,
    shared_secret TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'stopped',
    error_message TEXT,
    pid INTEGER,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS device_tokens (
    id TEXT PRIMARY KEY,
    device_name TEXT NOT NULL,
    token_hash TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    last_used_at TEXT,
    revoked INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS pairing_codes (
    code TEXT PRIMARY KEY,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    expires_at TEXT NOT NULL,
    claimed INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS daemon_tokens (
    device_id TEXT NOT NULL,
    project_id TEXT NOT NULL,
    token TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    PRIMARY KEY (device_id, project_id)
);
";

/// Thread-safe `SQLite` connection for the service database.
pub struct ServiceDatabase {
    conn: Arc<Mutex<Connection>>,
}

impl ServiceDatabase {
    /// Open (or create) the service database at `{data_dir}/service.db`.
    ///
    /// Creates `data_dir` if it does not exist, enables WAL mode and a 5s busy
    /// timeout, and runs embedded migrations.
    pub fn open(data_dir: &Path) -> Result<Self, ServiceError> {
        std::fs::create_dir_all(data_dir)?;

        let db_path = data_dir.join("service.db");
        let conn = Connection::open(&db_path)?;

        // WAL mode: readers never block writers; incomplete transactions are
        // rolled back on recovery.
        conn.execute_batch("PRAGMA journal_mode=WAL;")?;

        // Wait up to 5s for locks instead of failing immediately.
        conn.execute_batch("PRAGMA busy_timeout=5000;")?;

        // Enforce referential integrity.
        conn.execute_batch("PRAGMA foreign_keys=ON;")?;

        run_migrations(&conn)?;

        Ok(Self {
            conn: Arc::new(Mutex::new(conn)),
        })
    }

    /// Return a cloned `Arc` of the connection for sharing with interactions.
    pub fn shared(&self) -> Arc<Mutex<Connection>> {
        self.conn.clone()
    }
}

// ============================================================================
// Helpers
// ============================================================================

const MIGRATION_V2: &str = "
ALTER TABLE service_projects ADD COLUMN container_id TEXT;
";

const MIGRATION_V3: &str = "
CREATE TABLE IF NOT EXISTS project_secrets (
    project_id TEXT NOT NULL,
    key TEXT NOT NULL,
    encrypted_value BLOB NOT NULL,
    nonce BLOB NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now')),
    PRIMARY KEY (project_id, key),
    FOREIGN KEY (project_id) REFERENCES service_projects(id) ON DELETE CASCADE
);
";

fn run_migrations(conn: &Connection) -> Result<(), ServiceError> {
    let version: i32 = conn.pragma_query_value(None, "user_version", |row| row.get(0))?;
    if version < 1 {
        conn.execute_batch(MIGRATION_V1)?;
        conn.pragma_update(None, "user_version", 1)?;
    }
    if version < 2 {
        conn.execute_batch(MIGRATION_V2)?;
        conn.pragma_update(None, "user_version", 2)?;
    }
    if version < 3 {
        conn.execute_batch(MIGRATION_V3)?;
        conn.pragma_update(None, "user_version", 3)?;
    }
    Ok(())
}

// ============================================================================
// Tests
// ============================================================================

/// Apply migrations to an existing connection; used by interaction unit tests.
#[cfg(test)]
pub(crate) fn apply_migrations_for_test(conn: &Connection) {
    run_migrations(conn).unwrap();
}

#[cfg(test)]
mod tests {
    use rusqlite::Connection;

    use super::{run_migrations, MIGRATION_V1, MIGRATION_V2, MIGRATION_V3};

    fn migrated_conn() -> Connection {
        let conn = Connection::open_in_memory().unwrap();
        run_migrations(&conn).unwrap();
        conn
    }

    #[test]
    fn migration_creates_tables() {
        let conn = migrated_conn();
        let tables: Vec<String> = {
            let mut stmt = conn
                .prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name")
                .unwrap();
            stmt.query_map([], |row| row.get(0))
                .unwrap()
                .map(|r| r.unwrap())
                .collect()
        };
        assert!(tables.contains(&"service_projects".to_string()));
        assert!(tables.contains(&"device_tokens".to_string()));
        assert!(tables.contains(&"pairing_codes".to_string()));
        assert!(tables.contains(&"daemon_tokens".to_string()));
    }

    #[test]
    fn migration_is_idempotent() {
        // Running V1 twice must not fail (uses CREATE TABLE IF NOT EXISTS).
        let conn = Connection::open_in_memory().unwrap();
        conn.execute_batch(MIGRATION_V1).unwrap();
        conn.execute_batch(MIGRATION_V1).unwrap();
    }

    #[test]
    fn migration_v2_adds_container_id() {
        let conn = Connection::open_in_memory().unwrap();
        conn.execute_batch(MIGRATION_V1).unwrap();
        conn.execute_batch(MIGRATION_V2).unwrap();
        // container_id column should exist — insert NULL succeeds.
        conn.execute(
            "INSERT INTO service_projects (id, name, path, daemon_port, shared_secret, container_id)
             VALUES ('x', 'x', '/x', 3850, 's', NULL)",
            [],
        )
        .unwrap();
    }

    #[test]
    fn migration_v3_creates_project_secrets() {
        let conn = Connection::open_in_memory().unwrap();
        conn.execute_batch(MIGRATION_V1).unwrap();
        conn.execute_batch(MIGRATION_V2).unwrap();
        conn.execute_batch("PRAGMA foreign_keys=ON;").unwrap();
        conn.execute_batch(MIGRATION_V3).unwrap();
        // project_secrets table should exist — insert succeeds given a valid project.
        conn.execute(
            "INSERT INTO service_projects (id, name, path, daemon_port, shared_secret)
             VALUES ('proj1', 'p', '/p', 3850, 's')",
            [],
        )
        .unwrap();
        conn.execute(
            "INSERT INTO project_secrets (project_id, key, encrypted_value, nonce)
             VALUES ('proj1', 'MY_SECRET', X'deadbeef', X'cafebabe')",
            [],
        )
        .unwrap();
    }
}
