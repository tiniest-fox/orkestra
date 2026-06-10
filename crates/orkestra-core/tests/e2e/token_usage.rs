//! End-to-end tests for token usage extraction from Claude Code JSONL files.

use std::path::PathBuf;

use orkestra_core::workflow::config::{GateConfig, IntegrationConfig, StageConfig, WorkflowConfig};
use orkestra_core::workflow::domain::{compute_transcript_path, TokenUsage};

use crate::helpers::{MockAgentOutput, TestEnv};

// =============================================================================
// Helpers
// =============================================================================

fn two_stage_workflow() -> WorkflowConfig {
    WorkflowConfig::new(vec![
        StageConfig::new("planning", "plan")
            .with_prompt("planner.md")
            .with_gate(GateConfig::Agentic),
        StageConfig::new("work", "summary").with_prompt("worker.md"),
    ])
    .with_integration(IntegrationConfig::new("work"))
}

/// Write a fake JSONL transcript with known token values.
fn write_fake_jsonl(path: &std::path::Path, messages: &[(u64, u64, u64, u64)]) {
    std::fs::create_dir_all(path.parent().unwrap()).unwrap();
    let mut lines = String::new();
    for (input, output, cache_create, cache_read) in messages {
        lines.push_str(
            &serde_json::json!({
                "type": "assistant",
                "message": {
                    "usage": {
                        "input_tokens": input,
                        "output_tokens": output,
                        "cache_creation_input_tokens": cache_create,
                        "cache_read_input_tokens": cache_read
                    }
                }
            })
            .to_string(),
        );
        lines.push('\n');
    }
    std::fs::write(path, lines).unwrap();
}

// =============================================================================
// Tests
// =============================================================================

/// Verify that token usage is correctly extracted from JSONL files and
/// grouped by stage with correct subtotals and a trak-level total.
#[test]
fn test_token_usage_with_mock_jsonl_files() {
    let workflow = two_stage_workflow();
    let env = TestEnv::with_git(&workflow, &["planner", "worker"]);

    let task = env.create_task("Token usage test", "Test token extraction", None);
    let task_id = task.id.clone();

    // Planning stage: produce a plan
    env.set_output(&task_id, MockAgentOutput::artifact("plan", "The plan"));
    env.advance(); // spawn planner
    env.advance(); // process plan output

    // Inject a fake session ID for the planning session
    let planning_session_id = "test-token-usage-planning-session";
    env.api()
        .set_session_id(&task_id, "planning", planning_session_id)
        .unwrap();

    env.api().approve(&task_id).unwrap();
    env.advance(); // advance to work stage

    // Work stage: produce output
    env.set_output(&task_id, MockAgentOutput::artifact("summary", "Work done"));
    env.advance(); // spawn worker
    env.advance(); // process work output

    let work_session_id = "test-token-usage-work-session";
    env.api()
        .set_session_id(&task_id, "work", work_session_id)
        .unwrap();

    // Get the task's worktree path
    let task = env.api().get_task(&task_id).unwrap();
    let worktree_path = task
        .worktree_path
        .as_ref()
        .expect("task should have worktree_path");

    // Use a temp dir as the fake home — avoids touching real ~/.claude/
    let fake_home = tempfile::TempDir::new().unwrap();
    let planning_path = compute_transcript_path(
        fake_home.path(),
        &PathBuf::from(worktree_path),
        planning_session_id,
    );
    let work_path = compute_transcript_path(
        fake_home.path(),
        &PathBuf::from(worktree_path),
        work_session_id,
    );

    // Planning: 2 messages totaling (1500, 300, 75, 15)
    write_fake_jsonl(&planning_path, &[(1000, 200, 50, 10), (500, 100, 25, 5)]);
    // Work: 1 message (2000, 400, 100, 20)
    write_fake_jsonl(&work_path, &[(2000, 400, 100, 20)]);

    // Exercise: extract token usage with the fake home dir injected at construction.
    env.api().set_home_dir(fake_home.path().to_path_buf());
    let usage = env
        .api()
        .get_token_usage(&task_id)
        .expect("token usage extraction should succeed");

    assert_eq!(usage.task_id, task_id);

    // Planning stage
    let planning_stage = usage
        .stages
        .iter()
        .find(|s| s.stage == "planning")
        .expect("should have planning stage");
    assert_eq!(planning_stage.sessions.len(), 1);
    let p_usage = planning_stage.sessions[0]
        .usage
        .as_ref()
        .expect("planning session should have usage");
    assert_eq!(p_usage.input_tokens, 1500);
    assert_eq!(p_usage.output_tokens, 300);
    assert_eq!(p_usage.cache_creation_input_tokens, 75);
    assert_eq!(p_usage.cache_read_input_tokens, 15);
    assert_eq!(planning_stage.total.input_tokens, 1500);

    // Work stage
    let work_stage = usage
        .stages
        .iter()
        .find(|s| s.stage == "work")
        .expect("should have work stage");
    let w_usage = work_stage.sessions[0]
        .usage
        .as_ref()
        .expect("work session should have usage");
    assert_eq!(w_usage.input_tokens, 2000);
    assert_eq!(w_usage.output_tokens, 400);

    // Trak total
    assert_eq!(usage.total.input_tokens, 3500);
    assert_eq!(usage.total.output_tokens, 700);
    assert_eq!(usage.total.cache_creation_input_tokens, 175);
    assert_eq!(usage.total.cache_read_input_tokens, 35);
}

/// Verify that a missing JSONL file produces `usage: None` instead of an error.
#[test]
fn test_missing_jsonl_produces_none_not_error() {
    let workflow = two_stage_workflow();
    let env = TestEnv::with_git(&workflow, &["planner", "worker"]);

    let task = env.create_task("Missing JSONL test", "Test missing file", None);
    let task_id = task.id.clone();

    env.set_output(&task_id, MockAgentOutput::artifact("plan", "The plan"));
    env.advance();
    env.advance();

    // Inject session ID but do NOT write a JSONL file
    let session_id = "test-token-usage-no-file-session";
    env.api()
        .set_session_id(&task_id, "planning", session_id)
        .unwrap();

    let fake_home = tempfile::TempDir::new().unwrap();
    env.api().set_home_dir(fake_home.path().to_path_buf());

    let usage = env
        .api()
        .get_token_usage(&task_id)
        .expect("should succeed even without JSONL file");

    let planning_stage = usage
        .stages
        .iter()
        .find(|s| s.stage == "planning")
        .expect("should have planning stage");
    let session = &planning_stage.sessions[0];
    assert!(
        session.usage.is_none(),
        "usage should be None when file is missing"
    );
}

/// Verify that a task with no `worktree_path` returns empty stages.
#[test]
fn test_task_without_worktree_returns_empty_stages() {
    let workflow = two_stage_workflow();
    let env = TestEnv::with_workflow(workflow);

    // sync setup is on, so create_task doesn't create a worktree
    let task = env
        .api()
        .create_task("No worktree task", "No worktree", None)
        .unwrap();

    let fake_home = tempfile::TempDir::new().unwrap();
    env.api().set_home_dir(fake_home.path().to_path_buf());

    let usage = env
        .api()
        .get_token_usage(&task.id)
        .expect("should succeed for task without worktree_path");

    assert_eq!(usage.task_id, task.id);
    assert!(
        usage.stages.is_empty(),
        "task without worktree should have no stages"
    );
    assert_eq!(usage.total, TokenUsage::default());
}
