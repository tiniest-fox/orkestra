//! Resolve effective resource limits for a project using a fallback chain.

use std::sync::{Arc, Mutex};

use rusqlite::Connection;

use super::{detect_host, get};
use crate::types::ServiceError;

/// Resolve the effective `(cpu_limit, memory_limit_mb)` for `project_id`.
///
/// Fallback chain (first match wins):
/// 1. Per-project DB override
/// 2. `ORKESTRA_DEFAULT_CPUS` / `ORKESTRA_DEFAULT_MEMORY_MB` env vars
/// 3. 50% of host CPU cores / 50% of host memory
/// 4. Minimum floor: cpu >= 1.0, memory >= 512 MB
///
/// Returns `Err(ServiceError::ProjectNotFound)` if `project_id` does not exist.
pub fn execute(
    conn: &Arc<Mutex<Connection>>,
    project_id: &str,
) -> Result<(f64, i64), ServiceError> {
    let db_limits = get::execute(conn, project_id)?;

    let (host_cpu_count, host_memory_mb) = detect_host::execute();

    let cpu = resolve_cpu(db_limits.cpu_limit, host_cpu_count);
    let memory = resolve_memory(db_limits.memory_limit_mb, host_memory_mb);

    tracing::info!(
        project_id = %project_id,
        cpu_limit = cpu,
        memory_limit_mb = memory,
        "Resolved resource limits"
    );

    Ok((cpu, memory))
}

// -- Helpers --

fn resolve_cpu(db_override: Option<f64>, host_cpu_count: usize) -> f64 {
    let raw = db_override
        .or_else(|| {
            std::env::var("ORKESTRA_DEFAULT_CPUS")
                .ok()
                .and_then(|s| s.parse::<f64>().ok())
        })
        .unwrap_or_else(|| {
            #[allow(clippy::cast_precision_loss)]
            let half = (host_cpu_count as f64) * 0.5;
            half.max(1.0)
        });
    raw.max(1.0)
}

fn resolve_memory(db_override: Option<i64>, host_memory_mb: u64) -> i64 {
    let raw = db_override
        .or_else(|| {
            std::env::var("ORKESTRA_DEFAULT_MEMORY_MB")
                .ok()
                .and_then(|s| s.parse::<i64>().ok())
        })
        .unwrap_or_else(|| {
            #[allow(clippy::cast_possible_truncation, clippy::cast_possible_wrap)]
            let half = (host_memory_mb / 2) as i64;
            half.max(512)
        });
    raw.max(512)
}

// ============================================================================
// Tests
// ============================================================================

#[cfg(test)]
mod tests {
    use std::sync::{Arc, Mutex};

    use rusqlite::Connection;

    use super::execute;
    use crate::interactions::resource_limits::set;
    use crate::types::ServiceError;

    // Env vars are process-global; serialize tests that mutate them.
    static ENV_LOCK: Mutex<()> = Mutex::new(());

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
    fn db_override_wins() {
        let _lock = ENV_LOCK.lock().unwrap();
        let conn = conn();
        insert_project(&conn, "proj1");
        set::execute(&conn, "proj1", Some(8.0), Some(16384)).unwrap();

        // Clear env vars so host detection doesn't interfere.
        unsafe {
            std::env::remove_var("ORKESTRA_DEFAULT_CPUS");
            std::env::remove_var("ORKESTRA_DEFAULT_MEMORY_MB");
        }

        let (cpu, mem) = execute(&conn, "proj1").unwrap();
        assert!(
            (cpu - 8.0).abs() < f64::EPSILON,
            "cpu should be 8.0, got {cpu}"
        );
        assert_eq!(mem, 16384);
    }

    #[test]
    fn env_var_wins_when_no_db_override() {
        let _lock = ENV_LOCK.lock().unwrap();
        let conn = conn();
        insert_project(&conn, "proj1");

        unsafe {
            std::env::set_var("ORKESTRA_DEFAULT_CPUS", "3");
            std::env::set_var("ORKESTRA_DEFAULT_MEMORY_MB", "2048");
        }

        let (cpu, mem) = execute(&conn, "proj1").unwrap();

        unsafe {
            std::env::remove_var("ORKESTRA_DEFAULT_CPUS");
            std::env::remove_var("ORKESTRA_DEFAULT_MEMORY_MB");
        }

        assert!(
            (cpu - 3.0).abs() < f64::EPSILON,
            "cpu should be 3.0, got {cpu}"
        );
        assert_eq!(mem, 2048);
    }

    #[test]
    fn minimum_floor_applied() {
        let _lock = ENV_LOCK.lock().unwrap();
        let conn = conn();
        insert_project(&conn, "proj1");

        // Force values below the floor via env var.
        unsafe {
            std::env::set_var("ORKESTRA_DEFAULT_CPUS", "0.1");
            std::env::set_var("ORKESTRA_DEFAULT_MEMORY_MB", "100");
        }

        let (cpu, mem) = execute(&conn, "proj1").unwrap();

        unsafe {
            std::env::remove_var("ORKESTRA_DEFAULT_CPUS");
            std::env::remove_var("ORKESTRA_DEFAULT_MEMORY_MB");
        }

        assert!(cpu >= 1.0, "cpu floor should be 1.0, got {cpu}");
        assert!(mem >= 512, "memory floor should be 512, got {mem}");
    }

    #[test]
    fn returns_err_for_nonexistent_project() {
        let conn = conn();
        // No project inserted — should propagate ProjectNotFound.
        let result = execute(&conn, "ghost-project");
        assert!(
            matches!(result, Err(ServiceError::ProjectNotFound(_))),
            "expected ProjectNotFound, got {result:?}"
        );
    }

    #[test]
    fn host_detection_fallback_returns_positive_values() {
        let _lock = ENV_LOCK.lock().unwrap();
        let conn = conn();
        insert_project(&conn, "proj1");

        // Ensure env vars are absent so we fall through to host detection.
        unsafe {
            std::env::remove_var("ORKESTRA_DEFAULT_CPUS");
            std::env::remove_var("ORKESTRA_DEFAULT_MEMORY_MB");
        }

        let (cpu, mem) = execute(&conn, "proj1").unwrap();
        assert!(cpu >= 1.0, "cpu should be >= 1.0, got {cpu}");
        assert!(mem >= 512, "memory should be >= 512, got {mem}");
    }
}
