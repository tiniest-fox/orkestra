//! E2E tests for the orchestrator PID lock file.
//!
//! These tests exercise lock behavior through the orchestrator's `run()` method.

use std::fs;
use std::sync::{Arc, Mutex};
use std::time::Duration;

use tempfile::TempDir;

use orkestra_core::adapters::sqlite::DatabaseConnection;
use orkestra_core::workflow::{
    config::WorkflowConfig, orchestrator::LockError, OrchestratorEvent, OrchestratorExitReason,
    OrchestratorLoop, SqliteWorkflowStore, WorkflowApi,
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

/// Collect events and exit reason from `run()` with a stop-after duration.
///
/// Spawns `run()` on a background thread. After `wait`, sets the stop flag
/// and joins the thread. Returns all emitted events and the exit reason.
fn run_with_timeout(
    orchestrator: OrchestratorLoop,
    wait: Duration,
) -> (Vec<OrchestratorEvent>, OrchestratorExitReason) {
    let events = Arc::new(Mutex::new(Vec::new()));
    let events_clone = Arc::clone(&events);
    let stop = orchestrator.stop_flag();

    let handle = std::thread::spawn(move || {
        let reason = orchestrator.run(|event| {
            events_clone.lock().unwrap().push(event);
        });
        reason
    });

    std::thread::sleep(wait);
    stop.store(true, std::sync::atomic::Ordering::Relaxed);
    let reason = handle.join().unwrap();

    (
        Arc::try_unwrap(events).unwrap().into_inner().unwrap(),
        reason,
    )
}

// =============================================================================
// Lock E2E Tests
// =============================================================================

/// A second `run()` call on the same project blocks and emits a lock-contention error.
#[test]
fn test_second_orchestrator_blocked() {
    let temp = setup_project();
    let lock_path = temp.path().join(".orkestra/orchestrator.lock");

    // Start orchestrator A to acquire the real lock
    let orch_a = build_orchestrator(temp.path().to_path_buf());
    let stop_a = orch_a.stop_flag();
    let handle_a = std::thread::spawn(move || orch_a.run(|_| {}));

    // Wait for A to write its lock file
    let deadline = std::time::Instant::now() + Duration::from_secs(2);
    while !lock_path.exists() {
        assert!(
            std::time::Instant::now() < deadline,
            "Orchestrator A never wrote the lock file"
        );
        std::thread::sleep(Duration::from_millis(10));
    }

    // Start orchestrator B — should be blocked by A's lock and eventually time out
    let orch_b = build_orchestrator(temp.path().to_path_buf());
    let (events, _reason) = run_with_timeout(orch_b, Duration::from_millis(100));

    // Stop A
    stop_a.store(true, std::sync::atomic::Ordering::Relaxed);
    handle_a.join().unwrap();

    assert!(
        !events.is_empty(),
        "Expected at least one error event, got none"
    );
    let has_lock_error = events.iter().any(|e| {
        if let OrchestratorEvent::Error { error, .. } = e {
            error.contains("Timed out")
        } else {
            false
        }
    });
    assert!(
        has_lock_error,
        "Expected 'Timed out' lock error, got: {events:?}"
    );
}

/// A stale timestamped lock (`pid:old_timestamp`) is stolen and the orchestrator starts normally.
#[test]
fn test_stale_timestamped_lock_stolen() {
    let temp = setup_project();
    let lock_path = temp.path().join(".orkestra/orchestrator.lock");

    // Write a lock with timestamp >30s in the past and a dead PID — the new format
    let old_ts = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap()
        .as_secs()
        - 60;
    fs::write(&lock_path, format!("99999999:{old_ts}")).unwrap();

    let orchestrator = build_orchestrator(temp.path().to_path_buf());
    let (events, _reason) = run_with_timeout(orchestrator, Duration::from_millis(100));

    let has_error = events
        .iter()
        .any(|e| matches!(e, OrchestratorEvent::Error { .. }));
    assert!(
        !has_error,
        "Expected no error events (stale timestamped lock should be stolen), got: {events:?}"
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

// =============================================================================
// OrchestratorExitReason tests
// =============================================================================

/// `run()` returns `LockFailed` (timed out) when the lock is held by a live orchestrator.
#[test]
fn test_exit_reason_already_running() {
    let temp = setup_project();
    let lock_path = temp.path().join(".orkestra/orchestrator.lock");

    // Start orchestrator A to hold the real lock
    let orch_a = build_orchestrator(temp.path().to_path_buf());
    let stop_a = orch_a.stop_flag();
    let handle_a = std::thread::spawn(move || orch_a.run(|_| {}));

    // Wait for A to write its lock file
    let deadline = std::time::Instant::now() + Duration::from_secs(2);
    while !lock_path.exists() {
        assert!(
            std::time::Instant::now() < deadline,
            "Orchestrator A never wrote the lock file"
        );
        std::thread::sleep(Duration::from_millis(10));
    }

    // Start orchestrator B — should time out waiting for A's lock
    let orch_b = build_orchestrator(temp.path().to_path_buf());
    let (_events, reason) = run_with_timeout(orch_b, Duration::from_millis(100));

    // Stop A
    stop_a.store(true, std::sync::atomic::Ordering::Relaxed);
    handle_a.join().unwrap();

    match &reason {
        OrchestratorExitReason::LockFailed(msg) => {
            assert!(
                msg.contains("Timed out"),
                "Expected 'Timed out' in LockFailed message, got: {msg}"
            );
        }
        other => panic!("Expected LockFailed exit reason, got: {other:?}"),
    }
}

/// `run()` returns `Stopped` on normal shutdown via stop flag.
#[test]
fn test_exit_reason_stopped() {
    let temp = setup_project();

    let orchestrator = build_orchestrator(temp.path().to_path_buf());
    let (_events, reason) = run_with_timeout(orchestrator, Duration::from_millis(100));

    assert_eq!(
        reason,
        OrchestratorExitReason::Stopped,
        "Expected Stopped exit reason, got: {reason:?}"
    );
}

/// `OrchestratorExitReason` Display impl includes useful context.
#[test]
fn test_exit_reason_display() {
    assert_eq!(OrchestratorExitReason::Stopped.to_string(), "Stopped");

    let reason = OrchestratorExitReason::AlreadyRunning(9999);
    assert!(reason.to_string().contains("9999"));

    let reason = OrchestratorExitReason::LockFailed("permission denied".into());
    assert!(reason.to_string().contains("permission denied"));
}
