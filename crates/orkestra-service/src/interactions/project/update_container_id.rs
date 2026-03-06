//! Store or clear the Docker container ID on a project record.

use std::sync::{Arc, Mutex};

use rusqlite::{params, Connection};

use crate::types::ServiceError;

/// Set or clear the `container_id` for the given project.
///
/// Returns `ServiceError::ProjectNotFound` if no project with `id` exists.
pub fn execute(
    conn: &Arc<Mutex<Connection>>,
    id: &str,
    container_id: Option<&str>,
) -> Result<(), ServiceError> {
    let guard = conn.lock().expect("db mutex poisoned");
    let affected = guard.execute(
        "UPDATE service_projects SET container_id = ? WHERE id = ?",
        params![container_id, id],
    )?;

    if affected == 0 {
        return Err(ServiceError::ProjectNotFound(id.to_string()));
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

    fn conn() -> Arc<Mutex<Connection>> {
        let c = Connection::open_in_memory().unwrap();
        crate::database::apply_migrations_for_test(&c);
        Arc::new(Mutex::new(c))
    }

    #[test]
    fn sets_container_id() {
        let conn = conn();
        let p = crate::interactions::project::add::execute(&conn, "A", "/a", 3850, "s").unwrap();

        execute(&conn, &p.id, Some("abc123")).unwrap();

        let updated = crate::interactions::project::get::execute(&conn, &p.id).unwrap();
        assert_eq!(updated.container_id.as_deref(), Some("abc123"));
    }

    #[test]
    fn clears_container_id() {
        let conn = conn();
        let p = crate::interactions::project::add::execute(&conn, "B", "/b", 3850, "s").unwrap();

        execute(&conn, &p.id, Some("abc123")).unwrap();
        execute(&conn, &p.id, None).unwrap();

        let updated = crate::interactions::project::get::execute(&conn, &p.id).unwrap();
        assert!(updated.container_id.is_none());
    }

    #[test]
    fn returns_not_found_for_unknown_id() {
        let conn = conn();
        let err = execute(&conn, "nope", None).unwrap_err();
        assert!(matches!(
            err,
            crate::types::ServiceError::ProjectNotFound(_)
        ));
    }
}
