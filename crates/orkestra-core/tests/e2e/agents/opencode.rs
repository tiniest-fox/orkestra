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
