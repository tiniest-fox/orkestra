//! E2e tests for PR description audit — verifies the audit flow calls PR service correctly.

use orkestra_core::testutil::fixtures::test_default_workflow;
use orkestra_core::workflow::audit_pr_description_sync;
use orkestra_core::workflow::ports::PrError;
use orkestra_core::workflow::runtime::TaskState;

use super::helpers::{disable_auto_merge, MockAgentOutput, TestEnv};

/// Helper to advance a task through all stages to Done (same pattern as integration.rs).
fn advance_to_done(ctx: &TestEnv, task_id: &str) {
    ctx.set_output(
        task_id,
        MockAgentOutput::Artifact {
            name: "plan".to_string(),
            content: "Implementation plan".to_string(),
            activity_log: None,
        },
    );
    ctx.advance();
    ctx.advance();
    ctx.api().approve(task_id).unwrap();
    ctx.advance();

    ctx.set_output(
        task_id,
        MockAgentOutput::Artifact {
            name: "breakdown".to_string(),
            content: "Task breakdown".to_string(),
            activity_log: None,
        },
    );
    ctx.advance();
    ctx.advance();
    ctx.api().approve(task_id).unwrap();
    ctx.advance();

    ctx.set_output(
        task_id,
        MockAgentOutput::Artifact {
            name: "summary".to_string(),
            content: "Implementation complete".to_string(),
            activity_log: None,
        },
    );
    ctx.advance();
    ctx.advance();
    ctx.api().approve(task_id).unwrap();
    ctx.advance();

    ctx.set_output(
        task_id,
        MockAgentOutput::Approval {
            decision: "approve".to_string(),
            content: "LGTM".to_string(),
            activity_log: None,
        },
    );
    ctx.advance();
    ctx.advance();
}

// =============================================================================
// Happy Path
// =============================================================================

/// Audit reads current PR body and applies an updated body via the PR service.
#[test]
fn audit_calls_get_and_update_on_pr_service() {
    let workflow = disable_auto_merge(test_default_workflow());
    let ctx = TestEnv::with_mock_git(&workflow, &["planner", "breakdown", "worker", "reviewer"]);

    let task = ctx.create_task("Add feature", "Description", None);
    let task_id = task.id.clone();

    advance_to_done(&ctx, &task_id);

    // Give the task a PR URL
    ctx.api().begin_pr_creation(&task_id).unwrap();
    ctx.api()
        .pr_creation_succeeded(&task_id, "https://github.com/test/repo/pull/1")
        .unwrap();

    // Configure PR service to return an existing body
    ctx.pr_service()
        .set_next_get_body_result(Ok("## Summary\n\n- Old description".to_string()));

    // Run audit synchronously
    let api_arc = ctx.api_arc();
    audit_pr_description_sync(&api_arc, &task_id);

    // Verify the PR body was updated exactly once
    let calls = ctx.pr_service().update_body_calls();
    assert_eq!(
        calls.len(),
        1,
        "update_pull_request_body should be called once"
    );

    let (branch, body) = &calls[0];
    let task = ctx.api().get_task(&task_id).unwrap();
    assert_eq!(
        branch,
        task.branch_name.as_deref().unwrap(),
        "update should target the task's branch"
    );
    assert!(!body.is_empty(), "updated body should be non-empty");
}

// =============================================================================
// Failure Is Non-Fatal
// =============================================================================

/// Audit failure (get body returns error) does not panic and skips the update.
#[test]
fn audit_failure_is_non_fatal() {
    let workflow = disable_auto_merge(test_default_workflow());
    let ctx = TestEnv::with_mock_git(&workflow, &["planner", "breakdown", "worker", "reviewer"]);

    let task = ctx.create_task("Add feature", "Description", None);
    let task_id = task.id.clone();

    advance_to_done(&ctx, &task_id);

    // Give the task a PR URL
    ctx.api().begin_pr_creation(&task_id).unwrap();
    ctx.api()
        .pr_creation_succeeded(&task_id, "https://github.com/test/repo/pull/1")
        .unwrap();

    // Configure PR service to fail on get_body
    ctx.pr_service()
        .set_next_get_body_result(Err(PrError::ReadFailed("not found".to_string())));

    // Run audit — should not panic despite the error
    let api_arc = ctx.api_arc();
    audit_pr_description_sync(&api_arc, &task_id);

    // Verify no update was attempted
    let calls = ctx.pr_service().update_body_calls();
    assert!(
        calls.is_empty(),
        "update_pull_request_body should not be called when get fails"
    );
}

/// Audit failure (update body returns error) does not panic; the attempt is still recorded.
#[test]
fn audit_update_failure_is_non_fatal() {
    let workflow = disable_auto_merge(test_default_workflow());
    let ctx = TestEnv::with_mock_git(&workflow, &["planner", "breakdown", "worker", "reviewer"]);

    let task = ctx.create_task("Add feature", "Description", None);
    let task_id = task.id.clone();

    advance_to_done(&ctx, &task_id);

    // Give the task a PR URL
    ctx.api().begin_pr_creation(&task_id).unwrap();
    ctx.api()
        .pr_creation_succeeded(&task_id, "https://github.com/test/repo/pull/1")
        .unwrap();

    // Get succeeds; update fails
    ctx.pr_service()
        .set_next_get_body_result(Ok("## Summary\n\n- Existing description".to_string()));
    ctx.pr_service()
        .set_next_update_body_result(Err(PrError::UpdateFailed("network error".to_string())));

    // Run audit — should not panic despite the update error
    let api_arc = ctx.api_arc();
    audit_pr_description_sync(&api_arc, &task_id);

    // The mock records the call before returning the error, so length should be 1
    let calls = ctx.pr_service().update_body_calls();
    assert_eq!(
        calls.len(),
        1,
        "update_pull_request_body should have been attempted once"
    );
}

// =============================================================================
// Skipped When No Open PR
// =============================================================================

/// Audit is skipped entirely when the task has no open PR.
#[test]
fn audit_skipped_when_no_open_pr() {
    let workflow = disable_auto_merge(test_default_workflow());
    let ctx = TestEnv::with_mock_git(&workflow, &["planner", "breakdown", "worker", "reviewer"]);

    let task = ctx.create_task("Add feature", "Description", None);
    let task_id = task.id.clone();

    advance_to_done(&ctx, &task_id);

    // Task is Done but has no PR URL
    let task = ctx.api().get_task(&task_id).unwrap();
    assert!(task.pr_url.is_none(), "task should have no PR");

    // Run audit — should silently skip
    let api_arc = ctx.api_arc();
    audit_pr_description_sync(&api_arc, &task_id);

    // Neither get nor update should have been called
    let calls = ctx.pr_service().update_body_calls();
    assert!(
        calls.is_empty(),
        "update_pull_request_body should not be called when task has no PR"
    );
}

// =============================================================================
// Integration: Push Then Audit
// =============================================================================

/// After `commit_and_push_pr_changes`, calling audit updates the PR description.
#[test]
fn push_followed_by_audit_updates_description() {
    use super::helpers::workflows;

    let workflow = disable_auto_merge(workflows::with_subtasks());
    let ctx = TestEnv::with_mock_git(&workflow, &["planner", "breakdown", "worker", "reviewer"]);

    let task = ctx.create_task("Add feature", "Description", None);
    let task_id = task.id.clone();

    advance_to_done(&ctx, &task_id);

    // Give the task a PR URL
    ctx.api().begin_pr_creation(&task_id).unwrap();
    ctx.api()
        .pr_creation_succeeded(&task_id, "https://github.com/test/repo/pull/1")
        .unwrap();

    // Push PR changes
    let task = ctx.api().commit_and_push_pr_changes(&task_id).unwrap();
    assert!(
        matches!(task.state, TaskState::Done),
        "Task should still be Done after push"
    );

    // Run audit after push
    ctx.pr_service()
        .set_next_get_body_result(Ok("## Summary\n\n- Pre-push description".to_string()));

    let api_arc = ctx.api_arc();
    audit_pr_description_sync(&api_arc, &task_id);

    // Verify the PR body was updated
    let calls = ctx.pr_service().update_body_calls();
    assert_eq!(
        calls.len(),
        1,
        "update_pull_request_body should be called once after push+audit"
    );
}
