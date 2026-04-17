//! List all projects ordered by creation time.

use std::sync::{Arc, Mutex};

use rusqlite::Connection;

use crate::types::{Project, ServiceError};

/// Return all projects, oldest first.
pub fn execute(conn: &Arc<Mutex<Connection>>) -> Result<Vec<Project>, ServiceError> {
    let guard = conn.lock().expect("db mutex poisoned");
    let mut stmt = guard.prepare(
        "SELECT id, name, path, daemon_port, shared_secret, status,
                error_message, pid, created_at, container_id,
                cpu_limit, memory_limit_mb
         FROM service_projects
         ORDER BY created_at ASC",
    )?;
    let rows = stmt
        .query_map([], super::get::map_row)?
        .collect::<Result<Vec<Project>, _>>()?;
    Ok(rows)
}

// ============================================================================
// Tests
// ============================================================================

#[cfg(test)]
mod tests {
    use std::sync::{Arc, Mutex};

    use rusqlite::Connection;

    use super::execute;

    fn conn() -> Arc<Mutex<Connection>> {
        let c = Connection::open_in_memory().unwrap();
        crate::database::apply_migrations_for_test(&c);
        Arc::new(Mutex::new(c))
    }

    #[test]
    fn empty_returns_empty_vec() {
        let conn = conn();
        assert!(execute(&conn).unwrap().is_empty());
    }

    #[test]
    fn lists_all_projects() {
        let conn = conn();
        crate::interactions::project::add::execute(&conn, "A", "/a", 3850, "s").unwrap();
        crate::interactions::project::add::execute(&conn, "B", "/b", 3851, "s").unwrap();
        let projects = execute(&conn).unwrap();
        assert_eq!(projects.len(), 2);
    }
}
