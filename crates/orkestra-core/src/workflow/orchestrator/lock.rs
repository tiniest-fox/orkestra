//! PID-based lock file that enforces a single orchestrator per project.
//!
//! `OrchestratorLock` is a RAII guard: created by `acquire()`, it holds the lock
//! for its lifetime and removes the lock file on `Drop`.

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
pub struct OrchestratorLock {
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
    pub fn acquire(project_root: &Path) -> Result<Self, LockError> {
        let lock_path = project_root.join(".orkestra/orchestrator.lock");

        if lock_path.exists() {
            let is_alive = match std::fs::read_to_string(&lock_path) {
                Ok(contents) => match contents.trim().parse::<u32>() {
                    Ok(pid) => {
                        if crate::process::is_process_running(pid) {
                            return Err(LockError::AlreadyRunning(pid));
                        }
                        false
                    }
                    Err(_) => false, // Unparseable PID — stale
                },
                Err(_) => false, // Unreadable — stale
            };
            let _ = is_alive; // already handled above
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
}
