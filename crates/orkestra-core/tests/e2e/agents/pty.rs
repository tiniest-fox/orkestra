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

/// Resume with bookkeeping bytes before turn: the old byte-growth heuristic
/// would treat bookkeeping writes as "ready" and exit the retry loop with zero
/// resends, causing `tail_transcript_until_stop` to block forever.
/// The hook-gated readiness path waits for `UserPromptSubmit`, so bookkeeping
/// bytes don't trigger a false positive.
#[test]
#[ignore = "requires PTY support and Python3; run with --ignored on a developer machine"]
fn pty_resume_bookkeeping_does_not_cause_hang() {
    let env = helpers::AgentTestEnv::new_pty_mock();
    let task_id = env.create_task(
        "PTY resume bookkeeping test",
        "Test resume with bookkeeping.",
    );

    // First run
    env.run_to_completion(&task_id, Duration::from_mins(1));
    env.assert_has_artifact(&task_id, "summary");

    // Reject to trigger resume
    env.reject(&task_id, "Please try again with more detail.");

    // Second run — mock writes bookkeeping bytes to transcript before reading
    // stdin. Under the old code, this caused an immediate false "ready" then
    // hang. Under the new code, readiness requires the UserPromptSubmit hook.
    env.run_to_completion(&task_id, Duration::from_mins(1));

    let session = env.get_stage_session(&task_id, "work");
    assert!(
        session.spawn_count >= 2,
        "Should have spawned at least twice (initial + resume)"
    );
    env.assert_has_artifact(&task_id, "summary");
}

/// Cold boot with bookkeeping bytes before first turn: the mock writes a
/// bookkeeping line to the transcript before reading stdin, simulating
/// Claude Code's TUI init. The hook-gated readiness path is immune to this.
#[test]
#[ignore = "requires PTY support and Python3; run with --ignored on a developer machine"]
fn pty_cold_boot_bookkeeping_does_not_block() {
    let env = helpers::AgentTestEnv::new_pty_mock();
    let task_id = env.create_task("PTY cold boot test", "Test cold boot with bookkeeping.");

    env.run_to_completion(&task_id, Duration::from_mins(1));
    env.assert_has_logs(&task_id, "work");
    env.assert_has_artifact(&task_id, "summary");
}

/// Crash recovery and session resume: verify that a PTY process that exits without
/// firing the Stop hook is detected as dead, transcript is still read, and subsequent
/// runs after rejection complete normally.
///
/// Steps:
/// 1. Install the crash mock (exits without Stop hook)
/// 2. Run to `AwaitingApproval` — dead-process detection must fire within the timeout
/// 3. Verify `has_activity=true` (transcript was read despite no Stop hook)
/// 4. Verify first spawn used `--session-id` (not `--resume`)
/// 5. Reject and swap to normal mock
/// 6. Run to `AwaitingApproval` again — second run completes normally
/// 7. Verify second spawn used `--session-id` (Restart trigger supersedes session)
#[test]
#[ignore = "requires PTY support and Python3; run with --ignored on a developer machine"]
fn pty_crash_recovery_resumes_session() {
    // Set up args capture sidecar
    let args_file = tempfile::NamedTempFile::new().expect("args capture file");
    let args_path = args_file.path().to_path_buf();
    std::env::set_var("ORK_CAPTURE_ARGS_FILE", &args_path);

    let env = helpers::AgentTestEnv::new_pty_crash_mock();
    let task_id = env.create_task("PTY crash test", "Test crash recovery.");

    // First run — crash mock exits without Stop hook; dead-process detection must catch it
    env.run_to_completion(&task_id, Duration::from_mins(1));

    // Verify has_activity was set (transcript was read despite no Stop hook)
    let session = env.get_stage_session(&task_id, "work");
    assert!(
        session.has_activity,
        "has_activity should be true after first run — transcript was parsed"
    );

    // Verify first spawn used --session-id (not --resume)
    let args_content = std::fs::read_to_string(&args_path).expect("read args file");
    let first_line = args_content
        .lines()
        .next()
        .expect("should have first spawn args");
    assert!(
        first_line.starts_with("--session-id"),
        "First spawn should use --session-id, got: {first_line}"
    );

    // Reject and swap to normal mock for second run
    env.reject(&task_id, "Please try again.");
    env.swap_to_normal_mock();

    // Second run — normal mock fires Stop hook; should complete normally
    env.run_to_completion(&task_id, Duration::from_mins(1));

    // Verify second spawn args: Restart trigger supersedes the session, so claude_session_id
    // is cleared and is_resume=false → second spawn also uses --session-id (fresh session)
    let args_content = std::fs::read_to_string(&args_path).expect("read args file");
    let lines: Vec<&str> = args_content.lines().collect();
    assert!(
        lines.len() >= 2,
        "Should have at least 2 spawn records, got {}",
        lines.len()
    );
    let second_line = lines[1];
    println!("Second spawn args: {second_line}");
    assert!(
        second_line.starts_with("--session-id"),
        "Second spawn should use --session-id (Restart supersedes session), got: {second_line}"
    );

    env.assert_has_artifact(&task_id, "summary");

    // Clean up env var so it doesn't leak to other tests
    std::env::remove_var("ORK_CAPTURE_ARGS_FILE");
}
