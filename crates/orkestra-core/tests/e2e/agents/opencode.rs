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
    let env = helpers::AgentTestEnv::new("opencode/kimi-k2.5-free");
    let task_id = env.create_task(
        "List files",
        "List the files in the current directory using ls. Report what you see. Do NOT create or modify any files.",
    );
    env.run_to_completion(&task_id, Duration::from_secs(120));
    env.assert_has_logs(&task_id, "work");
    env.assert_has_artifact(&task_id, "result");
}
