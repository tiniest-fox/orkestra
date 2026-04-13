//! E2E tests for the orchestrator PID lock file.
//!
//! These tests exercise lock behavior through the orchestrator's `run()` method.

use std::fs;
use std::sync::{Arc, Mutex};
use std::time::Duration;

use tempfile::TempDir;

use orkestra_core::adapters::sqlite::DatabaseConnection;
use orkestra_core::workflow::{
    config::WorkflowConfig, LockError, OrchestratorEvent, OrchestratorLoop, SqliteWorkflowStore,
    WorkflowApi,
};

// =============================================================================
// Helpers
// =============================================================================

/// Create a minimal temp project dir with `.orkestra/` subdirectory.
fn setup_project() -> TempDir {
    let temp = TempDir::new().unwrap();
    fs::create_dir_all(temp.path().join(".orkestra")).unwrap();
    temp
}

/// Build a minimal `OrchestratorLoop` for `project_root` using `for_project()`.
fn build_orchestrator(project_root: std::path::PathBuf) -> OrchestratorLoop {
    let workflow = WorkflowConfig::new(vec![]);

    let db_path = project_root.join(".orkestra/test.db");
    let db_conn = DatabaseConnection::open(&db_path).expect("Failed to open test db");

    let store: Arc<dyn orkestra_core::workflow::ports::WorkflowStore> =
        Arc::new(SqliteWorkflowStore::new(db_conn.shared()));

    let api = Arc::new(Mutex::new(WorkflowApi::new(
        workflow.clone(),
        Arc::clone(&store),
    )));

    OrchestratorLoop::for_project(api, workflow, project_root, store)
}

/// Collect events from `run()` with a stop-after duration.
///
/// Spawns `run()` on a background thread. After `wait`, sets the stop flag
/// and joins the thread. Returns all emitted events.
fn run_with_timeout(orchestrator: OrchestratorLoop, wait: Duration) -> Vec<OrchestratorEvent> {
    let events = Arc::new(Mutex::new(Vec::new()));
    let events_clone = Arc::clone(&events);
    let stop = orchestrator.stop_flag();

    let handle = std::thread::spawn(move || {
        orchestrator.run(|event| {
            events_clone.lock().unwrap().push(event);
        });
    });

    std::thread::sleep(wait);
    stop.store(true, std::sync::atomic::Ordering::Relaxed);
    handle.join().unwrap();

    Arc::try_unwrap(events).unwrap().into_inner().unwrap()
}

// =============================================================================
// Lock E2E Tests
// =============================================================================

/// A second `run()` call on the same project (simulated via lock file with
/// current PID) emits an error event and returns immediately.
#[test]
fn test_second_orchestrator_blocked() {
    let temp = setup_project();
    let lock_path = temp.path().join(".orkestra/orchestrator.lock");

    // Simulate a running orchestrator by writing the current PID
    fs::write(&lock_path, std::process::id().to_string()).unwrap();

    let orchestrator = build_orchestrator(temp.path().to_path_buf());
    let events = run_with_timeout(orchestrator, Duration::from_millis(100));

    assert!(
        !events.is_empty(),
        "Expected at least one error event, got none"
    );
    let has_already_running = events.iter().any(|e| {
        if let OrchestratorEvent::Error { error, .. } = e {
            error.contains("already running") || error.contains("Already running")
        } else {
            false
        }
    });
    assert!(
        has_already_running,
        "Expected 'already running' error, got: {events:?}"
    );

    // Lock file should still exist (we wrote it, we didn't hold the guard)
    assert!(lock_path.exists(), "Lock file should still exist");
}

/// A stale lock file (dead PID) is stolen and the orchestrator starts normally.
#[test]
fn test_stale_lock_stolen() {
    let temp = setup_project();
    let lock_path = temp.path().join(".orkestra/orchestrator.lock");

    // Write a dead PID
    fs::write(&lock_path, "99999999").unwrap();

    let orchestrator = build_orchestrator(temp.path().to_path_buf());
    let events = run_with_timeout(orchestrator, Duration::from_millis(100));

    let has_error = events
        .iter()
        .any(|e| matches!(e, OrchestratorEvent::Error { .. }));
    assert!(
        !has_error,
        "Expected no error events (stale lock should be stolen), got: {events:?}"
    );

    // Lock file should be cleaned up after stop
    assert!(
        !lock_path.exists(),
        "Lock file should be removed after graceful shutdown"
    );
}

/// Lock file is removed after orchestrator stops gracefully.
#[test]
fn test_lock_cleaned_on_shutdown() {
    let temp = setup_project();
    let lock_path = temp.path().join(".orkestra/orchestrator.lock");

    let orchestrator = build_orchestrator(temp.path().to_path_buf());
    let stop = orchestrator.stop_flag();

    let events_buf: Arc<Mutex<Vec<OrchestratorEvent>>> = Arc::new(Mutex::new(Vec::new()));
    let events_clone = Arc::clone(&events_buf);

    let handle = std::thread::spawn(move || {
        orchestrator.run(|event| {
            events_clone.lock().unwrap().push(event);
        });
    });

    // Wait briefly for the orchestrator to start and write the lock
    std::thread::sleep(Duration::from_millis(100));
    assert!(
        lock_path.exists(),
        "Lock file should exist while orchestrator is running"
    );

    // Stop the orchestrator
    stop.store(true, std::sync::atomic::Ordering::Relaxed);
    handle.join().unwrap();

    assert!(
        !lock_path.exists(),
        "Lock file should be removed after graceful shutdown"
    );
}

// =============================================================================
// LockError display test
// =============================================================================

/// `LockError::AlreadyRunning` has a display message containing the PID.
#[test]
fn test_lock_error_display() {
    let err = LockError::AlreadyRunning(12345);
    assert!(err.to_string().contains("12345"));
}
