//! Kill orphaned daemon processes left over from a previous service crash.

use std::sync::{Arc, Mutex};

use rusqlite::Connection;
use tracing::info;

use crate::types::{ProjectStatus, ServiceError};

/// Find all projects whose status is `running` or `starting`, kill any live
/// orphan processes, reset their status to `stopped`, and return the number
/// of orphans killed.
///
/// Called once at service startup before any new daemons are spawned.
#[cfg(unix)]
#[allow(clippy::cast_possible_wrap, clippy::cast_sign_loss)]
pub fn execute(conn: &Arc<Mutex<Connection>>) -> Result<usize, ServiceError> {
    // Collect stale entries without holding the lock during the kill loop.
    let stale = {
        let guard = conn.lock().expect("db mutex poisoned");
        let query = format!(
            "SELECT id, pid FROM service_projects WHERE status IN ('{}', '{}')",
            ProjectStatus::Running.as_str(),
            ProjectStatus::Starting.as_str(),
        );
        let mut stmt = guard.prepare(&query)?;
        let rows: Vec<(String, Option<i64>)> = stmt
            .query_map([], |row| Ok((row.get(0)?, row.get(1)?)))?
            .collect::<Result<_, _>>()?;
        rows
    };

    let mut killed = 0;

    for (id, pid_opt) in &stale {
        if let Some(pid_i64) = pid_opt {
            let pid = *pid_i64 as u32;
            let pgid = pid as i32;

            // `kill(pid, 0)` checks existence without sending a signal.
            // SAFETY: Existence check — no signal is delivered. pid was read from
            // the database and cast from a stored i64.
            let alive = unsafe { libc::kill(pid as i32, 0) == 0 };

            if alive {
                info!("Killing orphaned daemon pid={pid} for project {id}");
                // Wake stopped processes before SIGTERM.
                // SAFETY: pgid is derived from a PID stored in the database (cast from i64).
                // Negating it targets the process group for a clean shutdown.
                unsafe { libc::kill(-pgid, libc::SIGCONT) };
                // SAFETY: same as above — targeting the same process group.
                unsafe { libc::kill(-pgid, libc::SIGTERM) };

                std::thread::sleep(std::time::Duration::from_millis(500));

                // Escalate if still running.
                // SAFETY: Existence check — no signal is delivered. pid cast from stored i64.
                if unsafe { libc::kill(pid as i32, 0) == 0 } {
                    // SAFETY: pgid is a valid process group ID; negating it targets the group.
                    unsafe { libc::kill(-pgid, libc::SIGKILL) };
                }

                killed += 1;
            }
        }

        // Reset status regardless of whether a process was found.
        let guard = conn.lock().expect("db mutex poisoned");
        guard.execute(
            &format!(
                "UPDATE service_projects SET status = '{}', pid = NULL WHERE id = ?",
                ProjectStatus::Stopped.as_str()
            ),
            [id],
        )?;
    }

    Ok(killed)
}

// ============================================================================
// Tests
// ============================================================================

#[cfg(test)]
mod tests {
    use std::sync::{Arc, Mutex};

    use rusqlite::Connection;

    use super::*;

    fn conn() -> Arc<Mutex<Connection>> {
        let c = Connection::open_in_memory().unwrap();
        crate::database::apply_migrations_for_test(&c);
        Arc::new(Mutex::new(c))
    }

    #[test]
    #[cfg(unix)]
    fn cleans_stale_entries_with_nonexistent_pids() {
        let conn = conn();

        // Insert a project with 'running' status and a definitely-dead PID.
        crate::interactions::project::add::execute(&conn, "Alpha", "/alpha", 3850, "secret")
            .unwrap();
        let projects = crate::interactions::project::list::execute(&conn).unwrap();
        let id = &projects[0].id;

        // Set status to running with an impossible PID.
        {
            let guard = conn.lock().unwrap();
            guard
                .execute(
                    "UPDATE service_projects SET status = 'running', pid = 999999999 WHERE id = ?",
                    [id],
                )
                .unwrap();
        }

        // cleanup_orphans should reset it to stopped without killing anything
        // (the PID doesn't exist so kill(pid, 0) returns ESRCH).
        let cleaned = execute(&conn).unwrap();
        assert_eq!(cleaned, 0, "no live processes to kill");

        let project = crate::interactions::project::get::execute(&conn, id).unwrap();
        assert_eq!(
            project.status,
            crate::types::ProjectStatus::Stopped,
            "status reset to stopped"
        );
        assert!(project.pid.is_none(), "pid cleared");
    }

    #[test]
    #[cfg(unix)]
    fn skips_projects_without_pid() {
        let conn = conn();
        crate::interactions::project::add::execute(&conn, "Beta", "/beta", 3851, "secret").unwrap();
        let projects = crate::interactions::project::list::execute(&conn).unwrap();
        let id = &projects[0].id;

        // Set status to starting but leave pid = NULL.
        {
            let guard = conn.lock().unwrap();
            guard
                .execute(
                    "UPDATE service_projects SET status = 'starting' WHERE id = ?",
                    [id],
                )
                .unwrap();
        }

        let cleaned = execute(&conn).unwrap();
        assert_eq!(cleaned, 0);

        let project = crate::interactions::project::get::execute(&conn, id).unwrap();
        assert_eq!(project.status, crate::types::ProjectStatus::Stopped);
    }

    #[test]
    #[cfg(unix)]
    fn ignores_stopped_projects() {
        let conn = conn();
        crate::interactions::project::add::execute(&conn, "Gamma", "/gamma", 3852, "secret")
            .unwrap();
        // Status defaults to 'cloning' — should not appear in the stale query.
        let cleaned = execute(&conn).unwrap();
        assert_eq!(cleaned, 0);
    }
}
