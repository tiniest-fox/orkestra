//! E2E tests for mermaid validation in the PR creation pipeline.
//!
//! Verifies that broken mermaid in generated PR bodies triggers the agent-fix
//! retry loop, and that the PR service receives the correct final body.

use std::sync::Arc;

use orkestra_core::testutil::fixtures::test_default_workflow;
use orkestra_core::workflow::create_pr_sync;
use orkestra_core::MockPrDescriptionGenerator;
use orkestra_core::PrDescriptionGenerator;

use super::helpers::{disable_auto_merge, MockAgentOutput, TestEnv};

const BROKEN_MERMAID_BODY: &str =
    "## Summary\n\n- task\n\n```mermaid\ngraph TD\n  A[broken (parens)] --> B\n```\n";
const FIXED_MERMAID_BODY: &str =
    "## Summary\n\n- task\n\n```mermaid\ngraph TD\n  A[\"fixed\"] --> B\n```\n";

/// Helper: advance a task through all 4 stages to Done.
fn advance_to_done(ctx: &TestEnv, task_id: &str) {
    ctx.set_output(
        task_id,
        MockAgentOutput::Artifact {
            name: "plan".to_string(),
            content: "Implementation plan".to_string(),
            activity_log: None,
            resources: vec![],
        },
    );
    ctx.advance(); // spawn planner
    ctx.advance(); // process plan
    ctx.api().approve(task_id).unwrap();
    ctx.advance(); // commit + advance to breakdown

    ctx.set_output(
        task_id,
        MockAgentOutput::Artifact {
            name: "breakdown".to_string(),
            content: "Task breakdown".to_string(),
            activity_log: None,
            resources: vec![],
        },
    );
    ctx.advance(); // spawn breakdown
    ctx.advance(); // process breakdown
    ctx.api().approve(task_id).unwrap();
    ctx.advance(); // commit + advance to work

    ctx.set_output(
        task_id,
        MockAgentOutput::Artifact {
            name: "summary".to_string(),
            content: "Implementation complete".to_string(),
            activity_log: None,
            resources: vec![],
        },
    );
    ctx.advance(); // spawn worker
    ctx.advance(); // process summary
    ctx.api().approve(task_id).unwrap();
    ctx.advance(); // commit + advance to review

    ctx.set_output(
        task_id,
        MockAgentOutput::Approval {
            decision: "approve".to_string(),
            content: "LGTM".to_string(),
            route_to: None,
            activity_log: None,
            resources: vec![],
        },
    );
    ctx.advance(); // spawn reviewer → AwaitingApproval
    ctx.api().approve(task_id).unwrap();
    ctx.advance(); // commit pipeline → Done
}

/// Helper: init a bare git remote so `git push` succeeds in the test.
///
/// Returns the `TempDir` handle — callers must bind it (`let _bare = ...`)
/// so the directory outlives the `create_pr_sync` call.
fn add_bare_remote(ctx: &TestEnv) -> tempfile::TempDir {
    let bare = tempfile::tempdir().expect("bare repo tempdir");
    std::process::Command::new("git")
        .args(["init", "--bare"])
        .current_dir(bare.path())
        .output()
        .expect("git init --bare");
    std::process::Command::new("git")
        .args(["remote", "add", "origin", bare.path().to_str().unwrap()])
        .current_dir(ctx.temp_dir())
        .output()
        .expect("git remote add");
    bare
}

// =============================================================================
// Mermaid fix loop — broken body → fix succeeds
// =============================================================================

/// When the PR description generator returns broken mermaid, the fix loop fires
/// and the PR service receives the corrected body.
#[test]
fn broken_mermaid_pr_fix_succeeds() {
    let workflow = disable_auto_merge(test_default_workflow());
    let ctx = TestEnv::with_git(&workflow, &["planner", "breakdown", "worker", "reviewer"]);

    let _bare = add_bare_remote(&ctx);

    let task = ctx.create_task("Test task", "Description", None);
    let task_id = task.id.clone();

    advance_to_done(&ctx, &task_id);

    // Inject mock that generates broken mermaid and fixes it on first retry.
    let mock_gen = Arc::new(
        MockPrDescriptionGenerator::succeeding()
            .with_generate_body(BROKEN_MERMAID_BODY)
            .push_fix_response(Ok(FIXED_MERMAID_BODY.to_string())),
    );
    ctx.set_pr_description_generator(Arc::clone(&mock_gen) as Arc<dyn PrDescriptionGenerator>);
    ctx.pr_service()
        .set_next_result(Ok("https://github.com/test/repo/pull/42".to_string()));

    create_pr_sync(ctx.api_arc(), &task_id).unwrap();

    // PR was created with the fixed body.
    let calls = ctx.pr_service().create_pr_calls();
    assert_eq!(calls.len(), 1);
    assert_eq!(
        calls[0].1, FIXED_MERMAID_BODY,
        "PR body should be the fixed version"
    );
    assert_eq!(mock_gen.fix_call_count(), 1, "fix should be called once");

    // Validation errors were passed to the fix agent.
    let received_errors = mock_gen.fix_received_errors();
    assert_eq!(received_errors.len(), 1);
    assert!(
        !received_errors[0].is_empty(),
        "fix agent should receive the validation error"
    );
    assert!(
        received_errors[0][0].contains("unquoted special characters"),
        "error should describe the mermaid issue, got: {:?}",
        received_errors[0][0]
    );
}

// =============================================================================
// Mermaid fix loop — all retries exhausted → original body shipped
// =============================================================================

/// When all fix retries are exhausted the original body (not the last failed
/// attempt) is passed to the PR service.
#[test]
fn broken_mermaid_exhausted_retries_ships_original() {
    let workflow = disable_auto_merge(test_default_workflow());
    let ctx = TestEnv::with_git(&workflow, &["planner", "breakdown", "worker", "reviewer"]);

    let _bare = add_bare_remote(&ctx);

    let task = ctx.create_task("Test task", "Description", None);
    let task_id = task.id.clone();

    advance_to_done(&ctx, &task_id);

    let still_broken =
        "## Summary\n\n```mermaid\ngraph TD\n  A[still (broken)] --> B\n```\n".to_string();
    let mock_gen = Arc::new(
        MockPrDescriptionGenerator::succeeding()
            .with_generate_body(BROKEN_MERMAID_BODY)
            .push_fix_response(Ok(still_broken.clone()))
            .push_fix_response(Ok(still_broken.clone()))
            .push_fix_response(Ok(still_broken)),
    );
    ctx.set_pr_description_generator(Arc::clone(&mock_gen) as Arc<dyn PrDescriptionGenerator>);
    ctx.pr_service()
        .set_next_result(Ok("https://github.com/test/repo/pull/43".to_string()));

    create_pr_sync(ctx.api_arc(), &task_id).unwrap();

    // PR was created with the ORIGINAL broken body (not the last failed attempt).
    let calls = ctx.pr_service().create_pr_calls();
    assert_eq!(calls.len(), 1);
    assert_eq!(
        calls[0].1, BROKEN_MERMAID_BODY,
        "PR body should be the original body when all retries are exhausted"
    );
    assert_eq!(mock_gen.fix_call_count(), 3, "all 3 retries should fire");
}
