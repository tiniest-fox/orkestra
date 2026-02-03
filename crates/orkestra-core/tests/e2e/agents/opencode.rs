//! End-to-end test for OpenCode running through the real orchestrator.
//!
//! Creates a real task, lets the orchestrator spawn OpenCode, and verifies
//! that logs are persisted and the final artifact is produced.

use std::time::Duration;

use super::agent_helpers as helpers;

/// Full end-to-end: create a task, let OpenCode work on it, verify logs + artifact.
///
/// Exercises the entire pipeline: task creation → worktree setup → orchestrator
/// spawns OpenCode → stream parsing → log persistence → output parsing → artifact storage.
#[test]
#[ignore] // requires opencode installed + API key
fn opencode_full_orchestrator_run() {
    let env = helpers::AgentTestEnv::new("opencode/kimi-k2.5");
    let task_id = env.create_task(
        "List files",
        "List the files in the current directory using ls. Report what you see. Do NOT create or modify any files.",
    );
    env.run_to_completion(&task_id, Duration::from_secs(60));
    env.assert_has_logs(&task_id, "work");
    env.assert_has_artifact(&task_id, "result");
}

/// Session resumption: reject the agent's work, verify it resumes the same
/// session with new logs appended.
///
/// This also validates provider-aware session ID generation: OpenCode has
/// `generates_own_session_id = true`, so no UUID is pre-generated. The session
/// ID is extracted from OpenCode's event stream during the first run, then
/// used for resume on the second run.
///
/// Steps:
/// 1. Run agent to AwaitingReview (first work iteration completes)
/// 2. Assert: session ID was extracted from stream (has `ses_` prefix, not a UUID)
/// 3. Reject with feedback
/// 4. Run agent to AwaitingReview again (second iteration resumes successfully)
/// 5. Assert: same claude_session_id (session continuity)
/// 6. Assert: spawn_count increased (agent was re-spawned)
/// 7. Assert: log count increased (new logs appended, not replaced)
/// 8. Assert: artifact still present
#[test]
#[ignore] // requires opencode installed + API key
fn opencode_session_resume_after_rejection() {
    let env = helpers::AgentTestEnv::new("opencode/kimi-k2.5");
    let task_id = env.create_task(
        "List files",
        "List the files in the current directory using ls. Report what you see. Do NOT create or modify any files.",
    );

    // First run
    env.run_to_completion(&task_id, Duration::from_secs(60));

    let session_before = env.get_stage_session(&task_id, "work");
    let logs_before = env.get_log_count(&task_id, "work");
    println!(
        "Before rejection: session_id={}, spawn_count={}, logs={}",
        session_before.claude_session_id.as_deref().unwrap_or("none"),
        session_before.spawn_count,
        logs_before,
    );

    assert!(logs_before > 0, "Should have logs from first run");
    assert!(
        session_before.spawn_count >= 1,
        "Should have been spawned at least once"
    );

    // Session ID should have been extracted from OpenCode's output stream
    // (not pre-generated as a UUID — OpenCode has generates_own_session_id = true)
    let session_id = session_before
        .claude_session_id
        .as_deref()
        .expect("Session ID should be populated after first run (extracted from stream)");
    assert!(
        session_id.starts_with("ses_"),
        "OpenCode session ID should have 'ses_' prefix (extracted from stream), got: {session_id}"
    );

    // Reject and re-run
    env.reject(&task_id, "Please also report the total number of files.");
    env.run_to_completion(&task_id, Duration::from_secs(60));

    let session_after = env.get_stage_session(&task_id, "work");
    let logs_after = env.get_log_count(&task_id, "work");
    println!(
        "After rejection: session_id={}, spawn_count={}, logs={}",
        session_after.claude_session_id.as_deref().unwrap_or("none"),
        session_after.spawn_count,
        logs_after,
    );

    // Same session ID — proves session continuity (resume, not fresh start)
    assert_eq!(
        session_before.claude_session_id, session_after.claude_session_id,
        "Session ID should be preserved across rejection (same session)"
    );

    // Spawn count increased — proves agent was actually re-spawned
    assert!(
        session_after.spawn_count > session_before.spawn_count,
        "Spawn count should increase: before={}, after={}",
        session_before.spawn_count,
        session_after.spawn_count,
    );

    // More logs — proves new activity was appended
    assert!(
        logs_after > logs_before,
        "Log count should increase: before={logs_before}, after={logs_after}"
    );

    // Artifact still present
    env.assert_has_artifact(&task_id, "result");
}

/// Fresh start when session ID is missing: simulate a crash before OpenCode's
/// session ID was extracted, then verify the retry spawns a fresh instance
/// instead of hanging on a bogus resume.
///
/// Steps:
/// 1. Run agent to AwaitingReview (session ID extracted as `ses_...`)
/// 2. Clear `claude_session_id` in the DB (simulates crash before extraction)
/// 3. Reject with feedback
/// 4. Run agent again — should start fresh and complete normally
/// 5. Assert: new session ID extracted (proves a real instance ran)
#[test]
#[ignore] // requires opencode installed + API key
fn opencode_fresh_start_without_session_id() {
    let env = helpers::AgentTestEnv::new("opencode/kimi-k2.5");
    let task_id = env.create_task(
        "List files",
        "List the files in the current directory using ls. Report what you see. Do NOT create or modify any files.",
    );

    // First run — establishes a session with a real ses_... ID
    env.run_to_completion(&task_id, Duration::from_secs(60));

    let session = env.get_stage_session(&task_id, "work");
    assert!(
        session.claude_session_id.is_some(),
        "Session ID should exist after first run"
    );
    assert!(
        session.spawn_count >= 1,
        "Should have been spawned at least once"
    );

    // Simulate crash: wipe the session ID as if it was never extracted.
    // The session still has spawn_count > 0, so without the fix this would
    // try to resume with a missing/bogus ID and OpenCode would hang.
    env.clear_session_id(&task_id, "work");

    let cleared = env.get_stage_session(&task_id, "work");
    assert!(cleared.claude_session_id.is_none(), "Session ID should be cleared");
    assert!(cleared.spawn_count >= 1, "spawn_count should still be > 0");

    // Reject and re-run — must start fresh (not resume)
    env.reject(&task_id, "Please also report the total number of files.");
    env.run_to_completion(&task_id, Duration::from_secs(60));

    // Should have completed with a new session ID extracted from stream
    let session_after = env.get_stage_session(&task_id, "work");
    let new_id = session_after
        .claude_session_id
        .expect("New session ID should be extracted after fresh start");
    assert!(
        new_id.starts_with("ses_"),
        "New session ID should have 'ses_' prefix, got: {new_id}"
    );

    env.assert_has_artifact(&task_id, "result");
}

/// Fail-fast: an invalid model name should cause the task to fail immediately
/// with a meaningful error rather than hanging forever.
///
/// OpenCode crashes with a `ProviderModelNotFoundError` on stderr and produces
/// zero stdout output. The runner detects zero stdout lines and extracts the
/// error from stderr.
#[test]
#[ignore] // requires opencode installed
fn opencode_bad_model_fails_fast() {
    let env = helpers::AgentTestEnv::new("opencode/nonexistent-model-xyz");
    let task_id = env.create_task("Should fail", "This should fail immediately.");
    let reason = env.run_to_failure(&task_id, Duration::from_secs(15));
    assert!(
        reason.contains("Error") || reason.contains("error") || reason.contains("model"),
        "Failure reason should mention the error, got: {reason}"
    );
}
