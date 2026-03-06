//! Update the runtime status, PID, and error message of a project.

use std::sync::{Arc, Mutex};

use rusqlite::{params, Connection};

use crate::types::{ProjectStatus, ServiceError};

/// Overwrite the status, PID, and error message for the given project.
///
/// Returns `ServiceError::ProjectNotFound` if no project with `id` exists.
pub fn execute(
    conn: &Arc<Mutex<Connection>>,
    id: &str,
    status: ProjectStatus,
    pid: Option<u32>,
    error_message: Option<&str>,
) -> Result<(), ServiceError> {
    let guard = conn.lock().expect("db mutex poisoned");
    let pid_i64: Option<i64> = pid.map(i64::from);
    let affected = guard.execute(
        "UPDATE service_projects
         SET status = ?, pid = ?, error_message = ?
         WHERE id = ?",
        params![status.as_str(), pid_i64, error_message, id],
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
    use crate::types::{ProjectStatus, ServiceError};

    fn conn() -> Arc<Mutex<Connection>> {
        let c = Connection::open_in_memory().unwrap();
        crate::database::apply_migrations_for_test(&c);
        Arc::new(Mutex::new(c))
    }

    #[test]
    fn updates_status_and_pid() {
        let conn = conn();
        let p = crate::interactions::project::add::execute(&conn, "Z", "/z", 3850, "s").unwrap();

        execute(&conn, &p.id, ProjectStatus::Running, Some(1234), None).unwrap();

        let updated = crate::interactions::project::get::execute(&conn, &p.id).unwrap();
        assert_eq!(updated.status, ProjectStatus::Running);
        assert_eq!(updated.pid, Some(1234));
        assert!(updated.error_message.is_none());
    }

    #[test]
    fn sets_error_message() {
        let conn = conn();
        let p = crate::interactions::project::add::execute(&conn, "E", "/e", 3850, "s").unwrap();

        execute(
            &conn,
            &p.id,
            ProjectStatus::Error,
            None,
            Some("daemon crashed"),
        )
        .unwrap();

        let updated = crate::interactions::project::get::execute(&conn, &p.id).unwrap();
        assert_eq!(updated.error_message.as_deref(), Some("daemon crashed"));
    }

    #[test]
    fn returns_not_found_for_unknown_id() {
        let conn = conn();
        let err = execute(&conn, "nope", ProjectStatus::Stopped, None, None).unwrap_err();
        assert!(matches!(err, ServiceError::ProjectNotFound(_)));
    }
}
