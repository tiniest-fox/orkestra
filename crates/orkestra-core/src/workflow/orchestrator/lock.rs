//! PID-based lock file that enforces a single orchestrator per project.
//!
//! `OrchestratorLock` is a RAII guard: created by `acquire()`, it holds the lock
//! for its lifetime and removes the lock file on `Drop`.

use crate::orkestra_debug;
use std::path::{Path, PathBuf};

// ============================================================================
// Lock Error
// ============================================================================

/// Errors returned by `OrchestratorLock::acquire`.
#[derive(Debug)]
pub enum LockError {
    /// Another orchestrator is alive at this PID.
    AlreadyRunning(u32),
    /// Filesystem error writing the lock.
    Io(std::io::Error),
}

impl std::fmt::Display for LockError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::AlreadyRunning(pid) => {
                write!(f, "Another orchestrator is already running (PID {pid})")
            }
            Self::Io(e) => write!(f, "Lock I/O error: {e}"),
        }
    }
}

impl std::error::Error for LockError {
    fn source(&self) -> Option<&(dyn std::error::Error + 'static)> {
        match self {
            Self::Io(e) => Some(e),
            Self::AlreadyRunning(_) => None,
        }
    }
}

// ============================================================================
// Orchestrator Lock
// ============================================================================

/// RAII guard that holds the orchestrator PID lock file.
///
/// Created via `acquire()`; the lock file is removed on `Drop`.
#[derive(Debug)]
pub(super) struct OrchestratorLock {
    lock_path: PathBuf,
}

impl OrchestratorLock {
    /// Acquire the orchestrator lock for `project_root`.
    ///
    /// Algorithm (mirrors `cleanup_stale_target_lock`):
    /// 1. Build `<project_root>/.orkestra/orchestrator.lock`
    /// 2. If the file exists, read the PID and check liveness
    /// 3. Alive → `Err(AlreadyRunning(pid))`
    /// 4. Dead / unreadable / unparseable → treat as stale, steal
    /// 5. Write current PID and return the guard
    pub(super) fn acquire(project_root: &Path) -> Result<Self, LockError> {
        let lock_path = project_root.join(".orkestra/orchestrator.lock");

        if lock_path.exists() {
            if let Ok(contents) = std::fs::read_to_string(&lock_path) {
                if let Ok(pid) = contents.trim().parse::<u32>() {
                    if crate::process::is_process_running(pid) {
                        if crate::process::is_zombie(pid) {
                            orkestra_debug!(
                                "lock",
                                "Zombie process (PID {}) holding orchestrator lock — reclaiming",
                                pid
                            );
                            // Fall through to steal the lock
                        } else {
                            return Err(LockError::AlreadyRunning(pid));
                        }
                    }
                }
            }
            // Unreadable or unparseable PID — treat as stale, steal the lock
        }

        let current_pid = std::process::id();
        std::fs::write(&lock_path, current_pid.to_string()).map_err(LockError::Io)?;

        Ok(Self { lock_path })
    }

    // -- Helpers --

    fn release(&self) {
        let _ = std::fs::remove_file(&self.lock_path);
    }
}

impl Drop for OrchestratorLock {
    fn drop(&mut self) {
        self.release();
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
    fn test_lock_file_contains_pid() {
        let temp = setup_temp_dir();
        let lock = OrchestratorLock::acquire(temp.path()).unwrap();
        let contents = std::fs::read_to_string(&lock.lock_path).unwrap();
        assert_eq!(contents.trim(), std::process::id().to_string());
    }

    #[test]
    fn test_acquire_blocked_by_live_process() {
        let temp = setup_temp_dir();
        let lock_path = temp.path().join(".orkestra/orchestrator.lock");
        // Write the current process's PID — it is definitely alive
        std::fs::write(&lock_path, std::process::id().to_string()).unwrap();

        let result = OrchestratorLock::acquire(temp.path());
        match result {
            Err(LockError::AlreadyRunning(pid)) => {
                assert_eq!(pid, std::process::id());
            }
            other => panic!("Expected AlreadyRunning, got {other:?}"),
        }
    }

    #[test]
    fn test_acquire_steals_stale_lock() {
        let temp = setup_temp_dir();
        let lock_path = temp.path().join(".orkestra/orchestrator.lock");
        // PID 99999999 is almost certainly dead
        std::fs::write(&lock_path, "99999999").unwrap();

        let lock = OrchestratorLock::acquire(temp.path()).unwrap();
        assert!(lock.lock_path.exists());
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

        // Write the zombie's PID to the lock file
        std::fs::write(&lock_path, zombie_pid.to_string()).unwrap();

        // Lock acquisition should succeed — zombie is bypassed
        let lock = OrchestratorLock::acquire(temp.path())
            .expect("should reclaim lock held by zombie process");
        assert!(lock.lock_path.exists());

        // Reap the child
        child.wait().unwrap();
        drop(lock);
    }
}
