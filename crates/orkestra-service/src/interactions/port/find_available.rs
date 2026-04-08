//! Find the first unused TCP port in the configured range.

use std::net::TcpListener;
use std::sync::{Arc, Mutex};

use rusqlite::Connection;

use crate::types::ServiceError;

/// Return the first port in `[range_start, range_end]` that is neither
/// allocated to an existing project in the database nor currently bound on
/// the host. Returns `ServiceError::NoAvailablePorts` if none is found.
pub fn execute(
    conn: &Arc<Mutex<Connection>>,
    range_start: u16,
    range_end: u16,
) -> Result<u16, ServiceError> {
    let allocated = allocated_ports(conn)?;

    for port in range_start..=range_end {
        if allocated.contains(&port) {
            continue;
        }
        if !is_port_bound(port) {
            return Ok(port);
        }
    }

    Err(ServiceError::NoAvailablePorts(range_start, range_end))
}

// -- Helpers --

/// Collect all `daemon_port` values currently in the database.
#[allow(clippy::cast_possible_truncation, clippy::cast_sign_loss)]
fn allocated_ports(conn: &Arc<Mutex<Connection>>) -> Result<Vec<u16>, ServiceError> {
    let guard = conn.lock().expect("db mutex poisoned");
    let mut stmt = guard.prepare("SELECT daemon_port FROM service_projects")?;
    let ports = stmt
        .query_map([], |row| {
            let v: i64 = row.get(0)?;
            Ok(v as u16)
        })?
        .collect::<Result<Vec<u16>, _>>()?;
    Ok(ports)
}

/// Return `true` if a TCP listener cannot be bound on `port` (i.e., the port
/// is already in use by another process).
fn is_port_bound(port: u16) -> bool {
    TcpListener::bind(("127.0.0.1", port)).is_err()
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
    fn finds_first_free_port_in_empty_db() {
        let conn = conn();
        // Use a high range unlikely to be occupied in CI.
        let port = execute(&conn, 49_200, 49_210).unwrap();
        assert!((49_200..=49_210).contains(&port));
    }

    #[test]
    fn skips_ports_already_in_db() {
        let conn = conn();
        // Pre-allocate 49200 and 49201 in the DB.
        crate::interactions::project::add::execute(&conn, "A", "/a", 49_200, "s").unwrap();
        crate::interactions::project::add::execute(&conn, "B", "/b", 49_201, "s").unwrap();
        let port = execute(&conn, 49_200, 49_210).unwrap();
        assert!(port >= 49_202, "expected port >= 49202, got {port}");
    }

    #[test]
    fn returns_no_available_ports_when_range_is_exhausted() {
        let conn = conn();
        // Block ports 49_100..=49_105 in the DB.
        for (i, p) in (49_100_u16..=49_105).enumerate() {
            crate::interactions::project::add::execute(
                &conn,
                &format!("P{i}"),
                &format!("/p{i}"),
                p,
                "s",
            )
            .unwrap();
        }
        // Also bind the remaining port 49106 with a listener.
        // If the port is already bound by another process, that's fine — the test
        // only needs it to be unavailable, not that *we* bound it.
        let _listener = std::net::TcpListener::bind(("127.0.0.1", 49_106_u16)).ok();
        let err = execute(&conn, 49_100, 49_106).unwrap_err();
        assert!(matches!(
            err,
            crate::types::ServiceError::NoAvailablePorts(_, _)
        ));
    }
}
