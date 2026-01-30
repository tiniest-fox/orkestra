//! E2E tests for process cleanup and task deletion.
//!
//! Tests that deleting tasks kills running script processes, cascade-deletes
//! subtask processes, and cleans up orphaned agents from previous crashes.

use std::time::Duration;

use orkestra_core::process::is_process_running;

use crate::helpers::{self, workflows, TestEnv};

// =============================================================================
// Delete with Cleanup Tests
// =============================================================================

#[test]
fn test_delete_task_with_cleanup_kills_script() {
    let ctx = TestEnv::with_workflow(workflows::sleep_script());

    // Create task — goes through real API, async setup, first stage = "work" (script)
    let task = ctx.create_task("Test task", "Test cleanup", None);
    let task_id = task.id.clone();
    assert_eq!(task.current_stage(), Some("work"));

    // Tick spawns the sleep script through the real pipeline:
    // orchestrator → stage_executor.spawn() → session creation → script spawn → PID recorded
    ctx.tick();
    std::thread::sleep(Duration::from_millis(50));

    // Verify the PID was recorded in the session (by the real pipeline)
    let pid = ctx
        .get_session_pid(&task_id, "work")
        .expect("Session should have PID after orchestrator tick");
    assert!(is_process_running(pid), "Script should be running");

    // Delete with cleanup — kills process via PID in session, then deletes DB records
    ctx.api().delete_task_with_cleanup(&task_id).unwrap();

    // Reap the zombie and verify the process is dead
    helpers::reap_pid(pid);
    assert!(
        !is_process_running(pid),
        "Script should be killed after delete"
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

    // Create parent + 2 subtasks — all get scripts spawned by orchestrator
    let parent = ctx.create_task("Parent", "Parent task", None);
    let parent_id = parent.id.clone();
    let child1 = ctx.create_subtask(&parent_id, "Child 1", "First subtask");
    let child2 = ctx.create_subtask(&parent_id, "Child 2", "Second subtask");
    let child1_id = child1.id.clone();
    let child2_id = child2.id.clone();

    // Tick spawns scripts for all three tasks
    ctx.tick();
    std::thread::sleep(Duration::from_millis(50));

    let pid_parent = ctx
        .get_session_pid(&parent_id, "work")
        .expect("Parent should have PID");
    let pid_child1 = ctx
        .get_session_pid(&child1_id, "work")
        .expect("Child 1 should have PID");
    let pid_child2 = ctx
        .get_session_pid(&child2_id, "work")
        .expect("Child 2 should have PID");

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

    // Two independent tasks, each with a running script
    let task1 = ctx.create_task("Task 1", "First task", None);
    let task2 = ctx.create_task("Task 2", "Second task", None);
    let task1_id = task1.id.clone();
    let task2_id = task2.id.clone();

    // Tick spawns scripts for both
    ctx.tick();
    std::thread::sleep(Duration::from_millis(50));

    let pid1 = ctx
        .get_session_pid(&task1_id, "work")
        .expect("Task 1 should have PID");
    let pid2 = ctx
        .get_session_pid(&task2_id, "work")
        .expect("Task 2 should have PID");

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
    // Use instant script — exits immediately after spawn
    let ctx = TestEnv::with_workflow(workflows::instant_script());

    let task = ctx.create_task("Stale PID test", "Test orphan cleanup", None);
    let task_id = task.id.clone();

    // Tick spawns the instant script (PID recorded in session).
    // The tick spawns AFTER polling, so the first tick won't process the completion
    // even if the script finishes instantly. This simulates a crash: PID is in the
    // session but the completion was never processed.
    ctx.tick();
    std::thread::sleep(Duration::from_millis(100));

    // Get the PID from the session
    let pid = ctx
        .get_session_pid(&task_id, "work")
        .expect("Session should have PID after tick");

    // Reap the zombie (in a real crash, the OS would reap when the parent exits)
    helpers::reap_pid(pid);
    assert!(
        !is_process_running(pid),
        "Instant script should have exited"
    );

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

    // Tick spawns the sleep script — process is alive, PID in session
    ctx.tick();
    std::thread::sleep(Duration::from_millis(50));

    let pid = ctx
        .get_session_pid(&task_id, "work")
        .expect("Session should have PID");
    assert!(is_process_running(pid));

    // Don't tick again — simulates crash. Script is running, PID is in session.
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
