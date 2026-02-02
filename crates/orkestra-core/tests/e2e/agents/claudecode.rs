//! End-to-end test for Claude Code running through the real orchestrator.
//!
//! Creates a real task, lets the orchestrator spawn Claude Code, and verifies
//! that logs are persisted and the final artifact is produced.

use std::time::Duration;

use super::agent_helpers as helpers;

/// Full end-to-end: create a task, let Claude Code work on it, verify logs + artifact.
///
/// Exercises the entire pipeline: task creation → worktree setup → orchestrator
/// spawns Claude Code → stream parsing → log persistence → output parsing → artifact storage.
#[test]
#[ignore] // requires claude CLI installed + API key
fn claudecode_full_orchestrator_run() {
    let env = helpers::AgentTestEnv::new("claudecode/haiku");
    let task_id = env.create_task(
        "List files",
        "List the files in the current directory using ls. Report what you see. Do NOT create or modify any files.",
    );
    env.run_to_completion(&task_id, Duration::from_secs(30));
    env.assert_has_logs(&task_id, "work");
    env.assert_has_artifact(&task_id, "result");
}

/// Fail-fast: an invalid model name should cause the task to fail immediately
/// with a meaningful error rather than hanging or retrying forever.
///
/// Claude Code emits a stream error event with the API 404 response, which
/// `extract_stream_error()` detects and propagates as a task failure.
#[test]
#[ignore] // requires claude CLI installed
fn claudecode_bad_model_fails_fast() {
    let env = helpers::AgentTestEnv::new("claudecode/nonexistent-model-xyz");
    let task_id = env.create_task("Should fail", "This should fail immediately.");
    let reason = env.run_to_failure(&task_id, Duration::from_secs(15));
    assert!(
        reason.contains("not_found") || reason.contains("model"),
        "Failure reason should mention the model error, got: {reason}"
    );
}
