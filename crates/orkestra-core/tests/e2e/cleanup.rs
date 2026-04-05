//! E2E tests for process cleanup and task deletion.
//!
//! Tests that deleting tasks kills running gate processes, cascade-deletes
//! subtask processes, and cleans up orphaned agents from previous crashes.
//!
//! All tests use the `sleep_script()` or `instant_script()` workflow helpers,
//! which create agent stages with gate scripts. The agent mock completes
//! immediately (output pre-loaded), then the gate runs as a real OS process.
//! Gate PIDs are recorded in the session so cleanup infrastructure can find them.

use std::time::Duration;

use orkestra_core::process::is_process_running;

use crate::helpers::{self, workflows, MockAgentOutput, TestEnv};

// =============================================================================
// Helpers
// =============================================================================

/// Simple artifact output for advancing through an agent stage.
fn simple_artifact() -> MockAgentOutput {
    MockAgentOutput::Artifact {
        name: "output".to_string(),
        content: "done".to_string(),
        activity_log: None,
        resources: vec![],
    }
}

/// Advance a task through the agent stage to the gate.
///
/// Requires mock output to be pre-loaded via `set_output()` before calling.
/// After this, the gate process is running and its PID is in the session.
fn advance_to_gate(ctx: &TestEnv) {
    ctx.tick(); // spawn agent (mock output queued)
    ctx.tick(); // process agent output → AwaitingGate
    ctx.tick(); // spawn gate (real process, PID recorded in session)
                // Small delay to ensure the OS process has started
    std::thread::sleep(Duration::from_millis(50));
}

// =============================================================================
// Delete with Cleanup Tests
// =============================================================================

#[test]
fn test_delete_task_with_cleanup_kills_script() {
    let ctx = TestEnv::with_workflow(workflows::sleep_script());

    // Create task — goes through real API, async setup, first stage = "work"
    let task = ctx.create_task("Test task", "Test cleanup", None);
    let task_id = task.id.clone();
    assert_eq!(task.current_stage(), Some("work"));

    // Pre-load mock agent output so the agent completes in the first tick
    ctx.set_output(&task_id, simple_artifact());

    // Advance through agent → AwaitingGate → gate spawn → PID recorded
    advance_to_gate(&ctx);

    // Verify the gate PID was recorded in the session
    let pid = ctx
        .get_session_pid(&task_id, "work")
        .expect("Session should have gate PID after gate spawn");
    assert!(is_process_running(pid), "Gate should be running");

    // Delete with cleanup — kills gate process via PID in session, then deletes DB records
    ctx.api().delete_task_with_cleanup(&task_id).unwrap();

    // Reap the zombie and verify the process is dead
    helpers::reap_pid(pid);
    assert!(
        !is_process_running(pid),
        "Gate should be killed after delete"
    );

    // Verify all DB records are gone (get_task returns Err for deleted tasks)
    assert!(
        ctx.api().get_task(&task_id).is_err(),
        "Task should be deleted"
    );
    assert!(ctx.api().get_iterations(&task_id).unwrap().is_empty());
    assert!(ctx.api().get_stage_sessions(&task_id).unwrap().is_empty());
}

#[test]
fn test_delete_task_with_cleanup_kills_subtask_scripts() {
    let ctx = TestEnv::with_workflow(workflows::sleep_script());

    // Create parent + 2 subtasks — all get gates spawned by orchestrator.
    // Output must be set right after each task is created: each create_subtask()
    // runs a setup tick that will spawn any already-queued tasks. Setting output
    // before the next creation ensures agents find their output when spawned.
    let parent = ctx.create_task("Parent", "Parent task", None);
    let parent_id = parent.id.clone();
    ctx.set_output(&parent_id, simple_artifact());

    let child1 = ctx.create_subtask(&parent_id, "Child 1", "First subtask");
    let child1_id = child1.id.clone();
    ctx.set_output(&child1_id, simple_artifact());

    let child2 = ctx.create_subtask(&parent_id, "Child 2", "Second subtask");
    let child2_id = child2.id.clone();
    ctx.set_output(&child2_id, simple_artifact());

    // Advance through agent → AwaitingGate → gate spawn → PIDs recorded
    advance_to_gate(&ctx);

    let pid_parent = ctx
        .get_session_pid(&parent_id, "work")
        .expect("Parent should have gate PID");
    let pid_child1 = ctx
        .get_session_pid(&child1_id, "work")
        .expect("Child 1 should have gate PID");
    let pid_child2 = ctx
        .get_session_pid(&child2_id, "work")
        .expect("Child 2 should have gate PID");

    assert!(is_process_running(pid_parent));
    assert!(is_process_running(pid_child1));
    assert!(is_process_running(pid_child2));

    // Delete parent — cascades to subtasks (kills all + deletes all DB records)
    ctx.api().delete_task_with_cleanup(&parent_id).unwrap();

    // Reap all killed processes
    helpers::reap_pid(pid_parent);
    helpers::reap_pid(pid_child1);
    helpers::reap_pid(pid_child2);

    assert!(!is_process_running(pid_parent));
    assert!(!is_process_running(pid_child1));
    assert!(!is_process_running(pid_child2));

    // All DB records should be gone
    assert!(ctx.api().get_task(&parent_id).is_err());
    assert!(ctx.api().get_task(&child1_id).is_err());
    assert!(ctx.api().get_task(&child2_id).is_err());
}

// =============================================================================
// Kill Running Agents Tests
// =============================================================================

#[test]
fn test_kill_running_agents() {
    let ctx = TestEnv::with_workflow(workflows::sleep_script());

    // Two independent tasks, each with a running gate.
    // Output must be set right after each task is created: the second
    // create_task() runs a setup tick that spawns the first task. Setting
    // output before the second creation ensures task1 finds its output.
    let task1 = ctx.create_task("Task 1", "First task", None);
    let task1_id = task1.id.clone();
    ctx.set_output(&task1_id, simple_artifact());

    let task2 = ctx.create_task("Task 2", "Second task", None);
    let task2_id = task2.id.clone();
    ctx.set_output(&task2_id, simple_artifact());

    // Advance through agent → AwaitingGate → gate spawn → PIDs recorded
    advance_to_gate(&ctx);

    let pid1 = ctx
        .get_session_pid(&task1_id, "work")
        .expect("Task 1 should have gate PID");
    let pid2 = ctx
        .get_session_pid(&task2_id, "work")
        .expect("Task 2 should have gate PID");

    let killed = ctx.api().kill_running_agents().unwrap();
    assert_eq!(killed, 2);

    helpers::reap_pid(pid1);
    helpers::reap_pid(pid2);
    assert!(!is_process_running(pid1));
    assert!(!is_process_running(pid2));
}

// =============================================================================
// Orphan Cleanup Tests
// =============================================================================

#[test]
fn test_cleanup_orphaned_agents_clears_stale_pids() {
    // Use instant gate — exits immediately after spawn
    let ctx = TestEnv::with_workflow(workflows::instant_script());

    let task = ctx.create_task("Stale PID test", "Test orphan cleanup", None);
    let task_id = task.id.clone();

    // Pre-load mock output so agent completes and gate is spawned.
    // The gate (echo hello) exits immediately, but we simulate a crash by
    // never calling tick() again after gate spawn — so the completion is never
    // processed. This leaves a stale dead PID in the session.
    ctx.set_output(&task_id, simple_artifact());
    ctx.tick(); // spawn agent
    ctx.tick(); // process agent output → AwaitingGate
    ctx.tick(); // spawn gate (PID recorded in session)
    std::thread::sleep(Duration::from_millis(100));

    // Get the PID from the session
    let pid = ctx
        .get_session_pid(&task_id, "work")
        .expect("Session should have gate PID after tick");

    // Reap the zombie (in a real crash, the OS would reap when the parent exits)
    helpers::reap_pid(pid);
    assert!(!is_process_running(pid), "Instant gate should have exited");

    // Run orphan cleanup — process is dead, PID is stale
    let orphans = ctx.api().cleanup_orphaned_agents().unwrap();
    assert_eq!(orphans, 0, "Dead process should not count as orphan");

    // But the PID should be cleared from the session
    let session = ctx
        .api()
        .get_stage_session(&task_id, "work")
        .unwrap()
        .unwrap();
    assert!(
        session.agent_pid.is_none(),
        "Stale PID should be cleared from session"
    );
}

#[test]
fn test_cleanup_orphaned_agents_kills_running() {
    let ctx = TestEnv::with_workflow(workflows::sleep_script());

    let task = ctx.create_task("Orphan test", "Test orphan killing", None);
    let task_id = task.id.clone();

    // Pre-load mock output so agent completes and gate spawns.
    // Don't call tick again — simulates crash. Gate is running, PID is in session.
    ctx.set_output(&task_id, simple_artifact());
    advance_to_gate(&ctx);

    let pid = ctx
        .get_session_pid(&task_id, "work")
        .expect("Session should have gate PID");
    assert!(is_process_running(pid));

    // Run orphan cleanup (as if app just restarted)
    let orphans = ctx.api().cleanup_orphaned_agents().unwrap();
    assert_eq!(orphans, 1);

    helpers::reap_pid(pid);
    assert!(!is_process_running(pid));

    // PID should be cleared
    let session = ctx
        .api()
        .get_stage_session(&task_id, "work")
        .unwrap()
        .unwrap();
    assert!(session.agent_pid.is_none());
}
