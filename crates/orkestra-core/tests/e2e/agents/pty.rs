//! End-to-end test for PTY-based agent execution through the real orchestrator.
//!
//! Uses `mock_claude_pty.sh` injected via PATH to exercise the full PTY dispatch
//! path without requiring a real Claude API key.

use std::time::Duration;

use super::agent_helpers as helpers;

/// Full PTY orchestrator run: create a task, tick through the PTY dispatch path,
/// verify logs are persisted and the artifact is extracted from the JSONL transcript.
///
/// Exercises the entire PTY pipeline: task creation → worktree setup →
/// orchestrator spawns via `ExecutionMode::Pty` → mock claude writes JSONL →
/// Stop hook fires → transcript parsed → artifact stored.
#[test]
#[ignore = "requires PTY support and Python3; run with --ignored on a developer machine"]
fn pty_full_orchestrator_run() {
    let env = helpers::AgentTestEnv::new_pty_mock();
    let task_id = env.create_task("PTY test", "A simple PTY test task.");

    env.run_to_completion(&task_id, Duration::from_mins(1));
    env.assert_has_logs(&task_id, "work");
    env.assert_has_artifact(&task_id, "summary");
}

/// Session resume after rejection: verify that after a reject+re-run the
/// spawn count increases and additional logs are appended.
///
/// Steps:
/// 1. Run to `AwaitingApproval` (first iteration)
/// 2. Record spawn count and log count
/// 3. Reject with feedback
/// 4. Run to `AwaitingApproval` again (second iteration)
/// 5. Assert spawn count increased and log count increased
#[test]
#[ignore = "requires PTY support and Python3; run with --ignored on a developer machine"]
fn pty_session_resume_after_rejection() {
    let env = helpers::AgentTestEnv::new_pty_mock();
    let task_id = env.create_task("PTY resume test", "A PTY task to test session resumption.");

    // First run
    env.run_to_completion(&task_id, Duration::from_mins(1));

    let session_before = env.get_stage_session(&task_id, "work");
    let logs_before = env.get_log_count(&task_id, "work");
    println!(
        "Before rejection: spawn_count={}, logs={}",
        session_before.spawn_count, logs_before,
    );

    assert!(logs_before > 0, "Should have logs from first run");
    assert!(
        session_before.spawn_count >= 1,
        "Should have been spawned at least once"
    );

    // Reject and re-run
    env.reject(&task_id, "Please try again.");
    env.run_to_completion(&task_id, Duration::from_mins(1));

    let session_after = env.get_stage_session(&task_id, "work");
    let logs_after = env.get_log_count(&task_id, "work");
    println!(
        "After rejection: spawn_count={}, logs={}",
        session_after.spawn_count, logs_after,
    );

    assert!(
        session_after.spawn_count > session_before.spawn_count,
        "Spawn count should increase: before={}, after={}",
        session_before.spawn_count,
        session_after.spawn_count,
    );

    assert!(
        logs_after > logs_before,
        "Log count should increase: before={logs_before}, after={logs_after}"
    );

    env.assert_has_artifact(&task_id, "summary");
}
