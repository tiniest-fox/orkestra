//! Write per-project resource limits to the service database.

use std::sync::{Arc, Mutex};

use rusqlite::{params, Connection};

use super::{MIN_CPU_LIMIT, MIN_MEMORY_LIMIT_MB};
use crate::types::ServiceError;

/// Update `cpu_limit` and `memory_limit_mb` for `project_id`.
///
/// Validates minimum floors before writing: `cpu_limit` must be >= 1.0 (or `None`),
/// `memory_limit_mb` must be >= 512 (or `None`). Passing `None` for either field clears
/// the stored override, reverting to host-detection defaults on next start.
pub fn execute(
    conn: &Arc<Mutex<Connection>>,
    project_id: &str,
    cpu_limit: Option<f64>,
    memory_limit_mb: Option<i64>,
) -> Result<(), ServiceError> {
    if let Some(cpu) = cpu_limit {
        if cpu < MIN_CPU_LIMIT {
            return Err(ServiceError::ValidationError(format!(
                "cpu_limit must be >= {MIN_CPU_LIMIT}, got {cpu}"
            )));
        }
    }
    if let Some(mem) = memory_limit_mb {
        if mem < MIN_MEMORY_LIMIT_MB {
            return Err(ServiceError::ValidationError(format!(
                "memory_limit_mb must be >= {MIN_MEMORY_LIMIT_MB}, got {mem}"
            )));
        }
    }

    let guard = conn.lock().expect("db mutex poisoned");
    let rows_affected = guard.execute(
        "UPDATE service_projects SET cpu_limit = ?, memory_limit_mb = ? WHERE id = ?",
        params![cpu_limit, memory_limit_mb, project_id],
    )?;

    if rows_affected == 0 {
        return Err(ServiceError::ProjectNotFound(project_id.to_string()));
    }

    Ok(())
}

// ============================================================================
// Tests
// ============================================================================

#[cfg(test)]
mod tests {
    use std::sync::{Arc, Mutex};

    use rusqlite::Connection;

    use super::execute;
    use crate::interactions::resource_limits::get;
    use crate::types::ServiceError;

    fn conn() -> Arc<Mutex<Connection>> {
        let c = Connection::open_in_memory().unwrap();
        crate::database::apply_migrations_for_test(&c);
        Arc::new(Mutex::new(c))
    }

    fn insert_project(conn: &Arc<Mutex<Connection>>, id: &str) {
        conn.lock()
            .unwrap()
            .execute(
                "INSERT INTO service_projects (id, name, path, daemon_port, shared_secret)
                 VALUES (?, 'p', ?, 3850, 's')",
                rusqlite::params![id, format!("/{id}")],
            )
            .unwrap();
    }

    #[test]
    fn round_trip_set_and_get() {
        let conn = conn();
        insert_project(&conn, "proj1");
        execute(&conn, "proj1", Some(4.0), Some(8192)).unwrap();
        let limits = get::execute(&conn, "proj1").unwrap();
        assert_eq!(limits.cpu_limit, Some(4.0));
        assert_eq!(limits.memory_limit_mb, Some(8192));
    }

    #[test]
    fn clears_with_none() {
        let conn = conn();
        insert_project(&conn, "proj1");
        execute(&conn, "proj1", Some(2.0), Some(1024)).unwrap();
        execute(&conn, "proj1", None, None).unwrap();
        let limits = get::execute(&conn, "proj1").unwrap();
        assert!(limits.cpu_limit.is_none());
        assert!(limits.memory_limit_mb.is_none());
    }

    #[test]
    fn rejects_cpu_below_minimum() {
        let conn = conn();
        insert_project(&conn, "proj1");
        let err = execute(&conn, "proj1", Some(0.5), None).unwrap_err();
        assert!(matches!(err, ServiceError::ValidationError(_)));
    }

    #[test]
    fn rejects_memory_below_minimum() {
        let conn = conn();
        insert_project(&conn, "proj1");
        let err = execute(&conn, "proj1", None, Some(256)).unwrap_err();
        assert!(matches!(err, ServiceError::ValidationError(_)));
    }

    #[test]
    fn returns_not_found_for_missing_project() {
        let conn = conn();
        let err = execute(&conn, "nonexistent", Some(2.0), Some(1024)).unwrap_err();
        assert!(matches!(err, ServiceError::ProjectNotFound(_)));
    }
}
