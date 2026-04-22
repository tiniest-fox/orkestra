//! PID+timestamp-based lock file enforcing a single orchestrator per project.
//!
//! `OrchestratorLock` is a RAII guard: created by `acquire()`, it holds the lock
//! for its lifetime and removes the lock file on `Drop`. The lock file format is
//! `{pid}:{unix_timestamp_secs}`; files without a colon are treated as corrupt.

use serde::Serialize;
use std::path::{Path, PathBuf};
use std::time::{Duration, SystemTime, UNIX_EPOCH};

/// A lock timestamp older than this is considered stale regardless of PID liveness.
const STALE_THRESHOLD_SECS: u64 = 30;

/// How long `acquire()` will retry a fresh lock before giving up.
#[cfg(not(test))]
const ACQUIRE_TIMEOUT_SECS: u64 = 30;
#[cfg(test)]
const ACQUIRE_TIMEOUT_SECS: u64 = 2;

// ============================================================================
// Lock Error
// ============================================================================

/// Errors returned by `OrchestratorLock::acquire`.
#[derive(Debug)]
pub enum LockError {
    /// Another orchestrator is alive at this PID.
    AlreadyRunning(u32),
    /// The lock held by `pid` did not become available within the timeout.
    TimedOut { pid: u32 },
    /// Filesystem error writing the lock.
    Io(std::io::Error),
}

impl std::fmt::Display for LockError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::AlreadyRunning(pid) => {
                write!(f, "Another orchestrator is already running (PID {pid})")
            }
            Self::TimedOut { pid } => {
                write!(
                    f,
                    "Timed out waiting for orchestrator lock (held by PID {pid})"
                )
            }
            Self::Io(e) => write!(f, "Lock I/O error: {e}"),
        }
    }
}

impl std::error::Error for LockError {
    fn source(&self) -> Option<&(dyn std::error::Error + 'static)> {
        match self {
            Self::Io(e) => Some(e),
            Self::AlreadyRunning(_) | Self::TimedOut { .. } => None,
        }
    }
}

// ============================================================================
// Orchestrator Status
// ============================================================================

/// Status of the orchestrator as observed from the lock file.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(tag = "status", rename_all = "snake_case")]
pub enum OrchestratorStatus {
    /// Lock file is fresh (≤30s old) and the process is alive.
    Running { pid: u32 },
    /// Lock file exists but its timestamp is stale (>30s old) or the process is dead.
    Stale { pid: u32 },
    /// No lock file present, or the file is unreadable/unparseable.
    Absent,
}

// ============================================================================
// Orchestrator Lock
// ============================================================================

/// RAII guard that holds the orchestrator PID+timestamp lock file.
///
/// Created via `acquire()`; the lock file is removed on `Drop`.
#[derive(Debug)]
pub(super) struct OrchestratorLock {
    lock_path: PathBuf,
    pid: u32,
}

impl OrchestratorLock {
    /// Acquire the orchestrator lock for `project_root`.
    ///
    /// Lock file format: `{pid}:{unix_timestamp_secs}`. Files without a colon are treated
    /// as corrupt and stolen immediately.
    ///
    /// Algorithm:
    /// 1. No file → write our lock and return guard.
    /// 2. File exists:
    ///    - Parse failure or dead PID → steal (write our lock).
    ///    - Timestamp stale (>30s) → steal regardless of PID liveness.
    ///    - Timestamp fresh, alive PID → retry with exponential backoff
    ///      (250ms → 500ms → 1s → 2s cap) until `ACQUIRE_TIMEOUT_SECS`, then `TimedOut`.
    /// 3. After every steal: verify-after-write (10ms sleep + re-read) to prevent races.
    pub(super) fn acquire(project_root: &Path) -> Result<Self, LockError> {
        let lock_path = project_root.join(".orkestra/orchestrator.lock");
        let current_pid = std::process::id();
        let deadline = std::time::Instant::now() + Duration::from_secs(ACQUIRE_TIMEOUT_SECS);
        let mut backoff_ms: u64 = 250;

        loop {
            match read_lock_state(&lock_path) {
                LockState::Absent | LockState::Corrupt => {
                    return steal_lock(&lock_path, current_pid);
                }
                LockState::Timestamped {
                    pid,
                    timestamp_secs,
                } => {
                    let age_secs = now_secs().saturating_sub(timestamp_secs);

                    if age_secs > STALE_THRESHOLD_SECS {
                        // Stale — steal regardless of whether the PID is alive
                        return steal_lock(&lock_path, current_pid);
                    }

                    if !crate::process::is_process_running(pid) || crate::process::is_zombie(pid) {
                        // Fresh timestamp but dead or zombie process
                        return steal_lock(&lock_path, current_pid);
                    }

                    // Fresh lock held by an alive process — retry with backoff
                    if std::time::Instant::now() >= deadline {
                        return Err(LockError::TimedOut { pid });
                    }

                    std::thread::sleep(Duration::from_millis(backoff_ms));
                    backoff_ms = (backoff_ms * 2).min(2000);
                }
            }
        }
    }

    /// Refresh the timestamp in the lock file without changing the PID.
    ///
    /// Called each orchestrator tick to signal liveness. Failures are silently ignored
    /// (same policy as `release()`).
    pub(super) fn heartbeat(&self) {
        let timestamp = now_secs();
        let _ = std::fs::write(&self.lock_path, format!("{}:{}", self.pid, timestamp));
    }

    // -- Helpers --

    fn release(&self) {
        // Only remove the lock file if it still contains our PID — a new orchestrator
        // may have already written its own lock after we set our stop flag.
        match read_lock_state(&self.lock_path) {
            LockState::Timestamped { pid, .. } if pid == self.pid => {
                let _ = std::fs::remove_file(&self.lock_path);
            }
            _ => {}
        }
    }
}

impl Drop for OrchestratorLock {
    fn drop(&mut self) {
        self.release();
    }
}

// ============================================================================
// Public Status Check
// ============================================================================

/// Return the current orchestrator status for `project_root`.
///
/// This is a read-only operation — it never acquires or modifies the lock.
/// Intended for use by the UI watchdog to decide whether to restart the orchestrator.
pub fn check_orchestrator_status(project_root: &Path) -> OrchestratorStatus {
    let lock_path = project_root.join(".orkestra/orchestrator.lock");
    match read_lock_state(&lock_path) {
        LockState::Absent | LockState::Corrupt => OrchestratorStatus::Absent,
        LockState::Timestamped {
            pid,
            timestamp_secs,
        } => {
            let age_secs = now_secs().saturating_sub(timestamp_secs);
            if age_secs <= STALE_THRESHOLD_SECS {
                if crate::process::is_process_running(pid) {
                    OrchestratorStatus::Running { pid }
                } else {
                    OrchestratorStatus::Stale { pid }
                }
            } else {
                OrchestratorStatus::Stale { pid }
            }
        }
    }
}

// ============================================================================
// Helpers
// ============================================================================

/// Internal representation of a parsed lock file.
enum LockState {
    Absent,
    Corrupt,
    Timestamped { pid: u32, timestamp_secs: u64 },
}

fn read_lock_state(lock_path: &Path) -> LockState {
    let contents = match std::fs::read_to_string(lock_path) {
        Ok(s) => s,
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => return LockState::Absent,
        Err(_) => return LockState::Corrupt,
    };
    let trimmed = contents.trim();
    if let Some((pid_str, ts_str)) = trimmed.split_once(':') {
        let Ok(pid) = pid_str.parse::<u32>() else {
            return LockState::Corrupt;
        };
        let Ok(timestamp_secs) = ts_str.parse::<u64>() else {
            return LockState::Corrupt;
        };
        LockState::Timestamped {
            pid,
            timestamp_secs,
        }
    } else {
        LockState::Corrupt
    }
}

fn now_secs() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_secs())
        // If the system clock is before UNIX_EPOCH, use u64::MAX so the lock
        // appears maximally fresh (age = 0 via saturating_sub) rather than
        // maximally stale (age = current_time via unwrap_or(0)).
        .unwrap_or(u64::MAX)
}

/// Write `{our_pid}:{timestamp}` to `lock_path`, then verify we still own it after 10ms.
///
/// The post-write sleep + re-read prevents two processes from both believing they
/// acquired a stale lock simultaneously: whichever wrote last wins, and the loser
/// gets `AlreadyRunning`.
fn steal_lock(lock_path: &Path, our_pid: u32) -> Result<OrchestratorLock, LockError> {
    let timestamp = now_secs();
    std::fs::write(lock_path, format!("{our_pid}:{timestamp}")).map_err(LockError::Io)?;

    // Verify-after-write: give concurrent stealers time to overwrite us
    std::thread::sleep(Duration::from_millis(10));

    match read_lock_state(lock_path) {
        LockState::Timestamped { pid, .. } if pid == our_pid => Ok(OrchestratorLock {
            lock_path: lock_path.to_path_buf(),
            pid: our_pid,
        }),
        LockState::Timestamped { pid, .. } => {
            // Another process overwrote us — we lost the race
            Err(LockError::AlreadyRunning(pid))
        }
        _ => Err(LockError::Io(std::io::Error::other(
            "Lock file vanished during verify-after-write",
        ))),
    }
}

// ============================================================================
// Tests
// ============================================================================

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::TempDir;

    fn setup_temp_dir() -> TempDir {
        let temp = TempDir::new().unwrap();
        std::fs::create_dir_all(temp.path().join(".orkestra")).unwrap();
        temp
    }

    #[test]
    fn test_acquire_fresh() {
        let temp = setup_temp_dir();
        let lock = OrchestratorLock::acquire(temp.path()).unwrap();
        assert!(lock.lock_path.exists());
    }

    #[test]
    fn test_lock_file_contains_pid_and_timestamp() {
        let temp = setup_temp_dir();
        let lock = OrchestratorLock::acquire(temp.path()).unwrap();
        let contents = std::fs::read_to_string(&lock.lock_path).unwrap();
        let (pid_str, ts_str) = contents
            .trim()
            .split_once(':')
            .expect("expected pid:timestamp");
        let pid: u32 = pid_str.parse().expect("pid should be a u32");
        let ts: u64 = ts_str.parse().expect("timestamp should be a u64");
        assert_eq!(pid, std::process::id());
        // Timestamp should be within a few seconds of now
        let now = now_secs();
        assert!(
            now.saturating_sub(ts) < 5,
            "timestamp {ts} is too far from now {now}"
        );
    }

    #[test]
    fn test_heartbeat_updates_timestamp() {
        let temp = setup_temp_dir();
        let lock = OrchestratorLock::acquire(temp.path()).unwrap();

        let ts_before = {
            let content = std::fs::read_to_string(&lock.lock_path).unwrap();
            let (_, ts) = content.trim().split_once(':').unwrap();
            ts.parse::<u64>().unwrap()
        };

        // Sleep long enough that the timestamp can advance
        std::thread::sleep(Duration::from_secs(2));
        lock.heartbeat();

        let ts_after = {
            let content = std::fs::read_to_string(&lock.lock_path).unwrap();
            let (pid_str, ts) = content.trim().split_once(':').unwrap();
            // PID must be unchanged
            assert_eq!(pid_str.parse::<u32>().unwrap(), std::process::id());
            ts.parse::<u64>().unwrap()
        };

        assert!(
            ts_after >= ts_before,
            "heartbeat should not decrease timestamp: before={ts_before}, after={ts_after}"
        );
    }

    #[test]
    fn test_acquire_steals_stale_lock() {
        let temp = setup_temp_dir();
        let lock_path = temp.path().join(".orkestra/orchestrator.lock");
        // Write a lock with a timestamp >30s in the past (dead PID)
        let old_ts = now_secs() - 60;
        std::fs::write(&lock_path, format!("99999999:{old_ts}")).unwrap();

        let lock = OrchestratorLock::acquire(temp.path()).unwrap();
        let contents = std::fs::read_to_string(&lock.lock_path).unwrap();
        let (pid_str, _) = contents.trim().split_once(':').unwrap();
        assert_eq!(pid_str.parse::<u32>().unwrap(), std::process::id());
    }

    #[test]
    fn test_acquire_steals_stale_even_if_pid_alive() {
        let temp = setup_temp_dir();
        let lock_path = temp.path().join(".orkestra/orchestrator.lock");
        // Write a stale timestamp with the current (alive) PID
        let old_ts = now_secs() - 60;
        let current_pid = std::process::id();
        std::fs::write(&lock_path, format!("{current_pid}:{old_ts}")).unwrap();

        // Should still steal because timestamp is stale
        let lock = OrchestratorLock::acquire(temp.path()).unwrap();
        assert!(lock.lock_path.exists());
    }

    #[test]
    fn test_acquire_retries_then_times_out() {
        let temp = setup_temp_dir();
        let lock_path = temp.path().join(".orkestra/orchestrator.lock");
        // Write a fresh lock held by the current (alive) process
        let current_pid = std::process::id();
        let fresh_ts = now_secs();
        std::fs::write(&lock_path, format!("{current_pid}:{fresh_ts}")).unwrap();

        // With ACQUIRE_TIMEOUT_SECS = 2 in test mode this should time out in ~2s
        let start = std::time::Instant::now();
        let result = OrchestratorLock::acquire(temp.path());
        let elapsed = start.elapsed();

        match result {
            Err(LockError::TimedOut { pid }) => {
                assert_eq!(pid, current_pid);
                // Should have waited close to ACQUIRE_TIMEOUT_SECS (allow 1s grace)
                assert!(
                    elapsed >= Duration::from_secs(ACQUIRE_TIMEOUT_SECS),
                    "expected timeout after ~{ACQUIRE_TIMEOUT_SECS}s, but elapsed only {elapsed:?}"
                );
            }
            other => panic!("Expected TimedOut, got {other:?}"),
        }
    }

    #[test]
    fn test_acquire_blocked_by_live_process() {
        let temp = setup_temp_dir();
        let lock_path = temp.path().join(".orkestra/orchestrator.lock");
        // Write the current process's PID with a fresh timestamp
        let fresh_ts = now_secs();
        let current_pid = std::process::id();
        std::fs::write(&lock_path, format!("{current_pid}:{fresh_ts}")).unwrap();

        let result = OrchestratorLock::acquire(temp.path());
        match result {
            Err(LockError::TimedOut { pid } | LockError::AlreadyRunning(pid)) => {
                assert_eq!(pid, current_pid);
            }
            other => panic!("Expected TimedOut or AlreadyRunning, got {other:?}"),
        }
    }

    #[test]
    fn test_check_status_running() {
        let temp = setup_temp_dir();
        let lock_path = temp.path().join(".orkestra/orchestrator.lock");
        let fresh_ts = now_secs();
        let current_pid = std::process::id();
        std::fs::write(&lock_path, format!("{current_pid}:{fresh_ts}")).unwrap();

        let status = check_orchestrator_status(temp.path());
        assert_eq!(status, OrchestratorStatus::Running { pid: current_pid });
    }

    #[test]
    fn test_check_status_fresh_but_dead_returns_stale() {
        let temp = setup_temp_dir();
        let lock_path = temp.path().join(".orkestra/orchestrator.lock");
        // Fresh timestamp but dead PID — should be Stale, not Running
        let fresh_ts = now_secs();
        std::fs::write(&lock_path, format!("99999999:{fresh_ts}")).unwrap();

        let status = check_orchestrator_status(temp.path());
        assert_eq!(status, OrchestratorStatus::Stale { pid: 99_999_999 });
    }

    #[test]
    fn test_check_status_stale() {
        let temp = setup_temp_dir();
        let lock_path = temp.path().join(".orkestra/orchestrator.lock");
        let old_ts = now_secs() - 60;
        std::fs::write(&lock_path, format!("99999999:{old_ts}")).unwrap();

        let status = check_orchestrator_status(temp.path());
        assert_eq!(status, OrchestratorStatus::Stale { pid: 99_999_999 });
    }

    #[test]
    fn test_check_status_absent() {
        let temp = setup_temp_dir();
        let status = check_orchestrator_status(temp.path());
        assert_eq!(status, OrchestratorStatus::Absent);
    }

    #[test]
    fn test_drop_removes_lock() {
        let temp = setup_temp_dir();
        let lock_path = {
            let lock = OrchestratorLock::acquire(temp.path()).unwrap();
            lock.lock_path.clone()
        };
        assert!(
            !lock_path.exists(),
            "Lock file should be removed after drop"
        );
    }

    #[test]
    fn test_verify_after_write_prevents_dual_steal() {
        let temp = setup_temp_dir();
        let lock_path = temp.path().join(".orkestra/orchestrator.lock");

        // Write a stale lock from a dead PID
        let old_ts = now_secs() - 60;
        std::fs::write(&lock_path, format!("99999999:{old_ts}")).unwrap();

        let our_pid = std::process::id();
        let lock_path_clone = lock_path.clone();

        // Spawn a thread that watches for our write and immediately overwrites with a rival PID
        let rival_handle = std::thread::spawn(move || {
            for _ in 0..50 {
                if let Ok(content) = std::fs::read_to_string(&lock_path_clone) {
                    if content.starts_with(&format!("{our_pid}:")) {
                        // We beat acquire()'s write — overwrite before the verify reads it
                        let _ = std::fs::write(&lock_path_clone, format!("11111:{}", now_secs()));
                        return true;
                    }
                }
                std::thread::sleep(Duration::from_millis(1));
            }
            false // did not manage to overwrite in time
        });

        let result = OrchestratorLock::acquire(temp.path());
        let rival_overwrote = rival_handle.join().unwrap();

        if rival_overwrote {
            // Verify-after-write should have detected the overwrite — we must NOT return Ok.
            // AlreadyRunning is the normal case; Io can occur when the rival's write races
            // with our verify read (truncate+write window produces a temporarily empty/corrupt
            // file). Both mean we correctly declined ownership.
            assert!(
                result.is_err(),
                "Should not return Ok when rival overwrote our lock"
            );
        } else {
            // Rival didn't overwrite in time — normal acquire should have succeeded
            assert!(result.is_ok(), "Expected Ok when rival didn't overwrite");
        }
    }

    #[cfg(unix)]
    #[test]
    fn test_zombie_lock_reclaimed() {
        use std::time::Duration;

        let temp = setup_temp_dir();
        let lock_path = temp.path().join(".orkestra/orchestrator.lock");

        // Spawn a child and don't reap it so it becomes a zombie
        let mut child = std::process::Command::new("sh")
            .args(["-c", "exit 0"])
            .stdin(std::process::Stdio::null())
            .stdout(std::process::Stdio::null())
            .stderr(std::process::Stdio::null())
            .spawn()
            .expect("failed to spawn child");

        let zombie_pid = child.id();

        // Wait for it to exit and become a zombie
        std::thread::sleep(Duration::from_millis(50));

        // Write the zombie's PID with a fresh timestamp — tests that a zombie with a
        // fresh timestamp is still reclaimed (dead process path in Timestamped arm).
        let fresh_ts = now_secs();
        std::fs::write(&lock_path, format!("{zombie_pid}:{fresh_ts}")).unwrap();

        // Lock acquisition should succeed — dead process is stolen even with fresh timestamp
        let lock = OrchestratorLock::acquire(temp.path())
            .expect("should reclaim lock held by zombie process");
        assert!(lock.lock_path.exists());

        // Reap the child
        child.wait().unwrap();
        drop(lock);
    }
}
