//! E2E tests for auto-resolve PR monitoring and iteration triggering.
//!
//! These tests verify that the orchestrator's periodic `check_auto_resolve` job
//! correctly polls done tasks with `auto_resolve=true`, detects new PR feedback,
//! and creates `PrFeedback` iterations.

use std::sync::Arc;

use orkestra_core::testutil::fixtures::test_default_workflow;
use orkestra_core::workflow::domain::IterationTrigger;
use orkestra_core::workflow::ports::{
    AutoResolveCheckRun, AutoResolveComment, AutoResolveStatus, PrState,
};
use orkestra_core::workflow::ports::{MockPrMonitor, PrMonitor};
use orkestra_core::workflow::runtime::TaskState;

use super::helpers::{disable_auto_merge, MockAgentOutput, TestEnv};

// =============================================================================
// Helpers
// =============================================================================

/// Advance a task through all stages to Done (no auto-merge).
fn advance_to_done(ctx: &TestEnv, task_id: &str) {
    // Planning stage
    ctx.set_output(
        task_id,
        MockAgentOutput::Artifact {
            name: "plan".to_string(),
            content: "Plan".to_string(),
            activity_log: None,
            resources: vec![],
        },
    );
    ctx.advance();
    ctx.advance();
    ctx.api().approve(task_id).unwrap();
    ctx.advance();

    // Breakdown stage
    ctx.set_output(
        task_id,
        MockAgentOutput::Artifact {
            name: "breakdown".to_string(),
            content: "Breakdown".to_string(),
            activity_log: None,
            resources: vec![],
        },
    );
    ctx.advance();
    ctx.advance();
    ctx.api().approve(task_id).unwrap();
    ctx.advance();

    // Work stage
    ctx.set_output(
        task_id,
        MockAgentOutput::Artifact {
            name: "summary".to_string(),
            content: "Done".to_string(),
            activity_log: None,
            resources: vec![],
        },
    );
    ctx.advance();
    ctx.advance();
    ctx.api().approve(task_id).unwrap();
    ctx.advance();

    // Review stage
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
    ctx.advance();
    ctx.api().approve(task_id).unwrap();
    ctx.advance();
}

/// Manually set `pr_url` on a task (simulates PR creation).
fn set_pr_url(ctx: &TestEnv, task_id: &str, url: &str) {
    let mut task = ctx.api().get_task(task_id).unwrap();
    task.pr_url = Some(url.to_string());
    ctx.api().save_task(&task).unwrap();
}

/// Manually set `auto_resolve` on a task.
fn set_auto_resolve(ctx: &TestEnv, task_id: &str, enabled: bool) {
    let mut task = ctx.api().get_task(task_id).unwrap();
    task.auto_resolve = enabled;
    ctx.api().save_task(&task).unwrap();
}

// =============================================================================
// Tests
// =============================================================================

/// Auto-resolve triggers when new failed checks are present and CI is concluded.
#[test]
fn test_auto_resolve_triggers_on_new_failed_checks() {
    let workflow = disable_auto_merge(test_default_workflow());
    let mut ctx = TestEnv::with_git(&workflow, &["planner", "breakdown", "worker", "reviewer"]);

    let task = ctx.create_task("Fix CI", "Fix the CI failures", None);
    let task_id = task.id.clone();

    advance_to_done(&ctx, &task_id);

    let task = ctx.api().get_task(&task_id).unwrap();
    assert!(task.state.is_done(), "Task should be Done");

    set_pr_url(&ctx, &task_id, "https://github.com/acme/repo/pull/1");
    set_auto_resolve(&ctx, &task_id, true);

    // Configure mock monitor to return a failed check
    let mock = Arc::new(MockPrMonitor::new());
    mock.set_next_status(AutoResolveStatus {
        pr_state: PrState::Open,
        failed_checks: vec![AutoResolveCheckRun {
            id: 101,
            name: "CI / test".to_string(),
            log_excerpt: Some("assertion failed".to_string()),
        }],
        comments: vec![],
        reviews: vec![],
        all_checks_concluded: true,
    });
    ctx.set_pr_monitor(mock.clone() as Arc<dyn PrMonitor>);

    // Force the periodic job due so it fires on this tick regardless of when
    // it last ran (it fired during advance_to_done with 0 candidates).
    ctx.force_auto_resolve_check();
    ctx.tick();

    // Task should have returned to Queued with a PrFeedback iteration
    let task = ctx.api().get_task(&task_id).unwrap();
    assert!(
        matches!(task.state, TaskState::Queued { .. }),
        "Task should be Queued after PrFeedback trigger, got: {:?}",
        task.state
    );

    let iterations = ctx.api().get_iterations(&task_id).unwrap();
    let last = iterations.last().unwrap();
    assert!(
        matches!(
            &last.incoming_context,
            Some(IterationTrigger::PrFeedback { checks, .. }) if !checks.is_empty()
        ),
        "Last iteration should have PrFeedback trigger with checks"
    );
}

/// Auto-resolve triggers when new PR comments are present.
#[test]
fn test_auto_resolve_triggers_on_new_comments() {
    let workflow = disable_auto_merge(test_default_workflow());
    let mut ctx = TestEnv::with_git(&workflow, &["planner", "breakdown", "worker", "reviewer"]);

    let task = ctx.create_task("Address feedback", "Address review comments", None);
    let task_id = task.id.clone();

    advance_to_done(&ctx, &task_id);

    set_pr_url(&ctx, &task_id, "https://github.com/acme/repo/pull/2");
    set_auto_resolve(&ctx, &task_id, true);

    let mock = Arc::new(MockPrMonitor::new());
    mock.set_next_status(AutoResolveStatus {
        pr_state: PrState::Open,
        failed_checks: vec![],
        comments: vec![AutoResolveComment {
            id: 42,
            author: "reviewer".to_string(),
            body: "Please rename this variable".to_string(),
            path: Some("src/lib.rs".to_string()),
            line: Some(10),
        }],
        reviews: vec![],
        all_checks_concluded: true,
    });
    ctx.set_pr_monitor(mock.clone() as Arc<dyn PrMonitor>);

    ctx.force_auto_resolve_check();
    ctx.tick();

    let task = ctx.api().get_task(&task_id).unwrap();
    assert!(
        matches!(task.state, TaskState::Queued { .. }),
        "Task should be Queued after comment trigger"
    );

    let iterations = ctx.api().get_iterations(&task_id).unwrap();
    let last = iterations.last().unwrap();
    if let Some(IterationTrigger::PrFeedback { comments, .. }) = &last.incoming_context {
        assert_eq!(comments.len(), 1);
        assert_eq!(comments[0].id, Some(42));
        assert_eq!(comments[0].author, "reviewer");
    } else {
        panic!("Expected PrFeedback trigger with comments");
    }
}

/// After first trigger, a second tick with the same IDs does not create another iteration.
#[test]
fn test_auto_resolve_dedup_skips_seen_ids() {
    let workflow = disable_auto_merge(test_default_workflow());
    let mut ctx = TestEnv::with_git(&workflow, &["planner", "breakdown", "worker", "reviewer"]);

    let task = ctx.create_task("Dedup test", "Test dedup behavior", None);
    let task_id = task.id.clone();

    advance_to_done(&ctx, &task_id);
    set_pr_url(&ctx, &task_id, "https://github.com/acme/repo/pull/3");
    set_auto_resolve(&ctx, &task_id, true);

    let mock = Arc::new(MockPrMonitor::new());
    // First poll: new comment ID 99
    mock.set_next_status(AutoResolveStatus {
        pr_state: PrState::Open,
        failed_checks: vec![],
        comments: vec![AutoResolveComment {
            id: 99,
            author: "reviewer".to_string(),
            body: "Please update docs".to_string(),
            path: None,
            line: None,
        }],
        reviews: vec![],
        all_checks_concluded: true,
    });
    ctx.set_pr_monitor(mock.clone() as Arc<dyn PrMonitor>);
    ctx.force_auto_resolve_check();
    ctx.tick();

    let iterations_after_first = ctx.api().get_iterations(&task_id).unwrap().len();

    // Return the task to Done manually to simulate the work cycle completing
    // For dedup test: just verify the ID is saved even if we can't easily cycle back
    let task = ctx.api().get_task(&task_id).unwrap();
    assert!(
        task.resolved_feedback_ids.comment_ids.contains(&99),
        "Comment ID 99 should be in resolved_feedback_ids"
    );
    assert_eq!(task.auto_resolve_count, 1);

    // Second poll with the same ID — should not trigger again
    // Set task back to Done with auto_resolve=true and pr_url
    let mut task = task;
    task.state = orkestra_core::workflow::runtime::TaskState::Done;
    task.auto_resolve = true;
    ctx.api().save_task(&task).unwrap();

    mock.set_next_status(AutoResolveStatus {
        pr_state: PrState::Open,
        failed_checks: vec![],
        comments: vec![AutoResolveComment {
            id: 99, // same ID
            author: "reviewer".to_string(),
            body: "Please update docs".to_string(),
            path: None,
            line: None,
        }],
        reviews: vec![],
        all_checks_concluded: true,
    });
    ctx.force_auto_resolve_check();
    ctx.tick();

    let iterations_after_second = ctx.api().get_iterations(&task_id).unwrap().len();
    assert_eq!(
        iterations_after_second, iterations_after_first,
        "No new iteration should be created for already-seen comment ID"
    );
}

/// After 10 auto-resolve iterations, `auto_resolve` is disabled.
#[test]
fn test_auto_resolve_limit_pauses() {
    let workflow = disable_auto_merge(test_default_workflow());
    let mut ctx = TestEnv::with_git(&workflow, &["planner", "breakdown", "worker", "reviewer"]);

    let task = ctx.create_task("Limit test", "Hit the auto-resolve limit", None);
    let task_id = task.id.clone();

    advance_to_done(&ctx, &task_id);
    set_pr_url(&ctx, &task_id, "https://github.com/acme/repo/pull/4");

    // Pre-set auto_resolve_count to 9 and auto_resolve=true
    let mut task = ctx.api().get_task(&task_id).unwrap();
    task.auto_resolve = true;
    task.auto_resolve_count = 9;
    ctx.api().save_task(&task).unwrap();

    let mock = Arc::new(MockPrMonitor::new());
    mock.set_next_status(AutoResolveStatus {
        pr_state: PrState::Open,
        failed_checks: vec![],
        comments: vec![AutoResolveComment {
            id: 200,
            author: "reviewer".to_string(),
            body: "One more comment".to_string(),
            path: None,
            line: None,
        }],
        reviews: vec![],
        all_checks_concluded: true,
    });
    ctx.set_pr_monitor(mock.clone() as Arc<dyn PrMonitor>);
    ctx.force_auto_resolve_check();
    ctx.tick();

    // auto_resolve_count should now be 10, auto_resolve disabled
    let task = ctx.api().get_task(&task_id).unwrap();
    assert!(
        !task.auto_resolve,
        "auto_resolve should be disabled at limit"
    );
    assert_eq!(task.auto_resolve_count, 10);
}

/// Closed/merged PR results in no `PrFeedback` iteration.
#[test]
fn test_auto_resolve_skips_closed_pr() {
    let workflow = disable_auto_merge(test_default_workflow());
    let mut ctx = TestEnv::with_git(&workflow, &["planner", "breakdown", "worker", "reviewer"]);

    let task = ctx.create_task("Closed PR test", "PR was merged", None);
    let task_id = task.id.clone();

    advance_to_done(&ctx, &task_id);
    set_pr_url(&ctx, &task_id, "https://github.com/acme/repo/pull/5");
    set_auto_resolve(&ctx, &task_id, true);

    let mock = Arc::new(MockPrMonitor::new());
    mock.set_next_status(AutoResolveStatus {
        pr_state: PrState::Merged,
        failed_checks: vec![AutoResolveCheckRun {
            id: 300,
            name: "CI / test".to_string(),
            log_excerpt: None,
        }],
        comments: vec![],
        reviews: vec![],
        all_checks_concluded: true,
    });
    ctx.set_pr_monitor(mock.clone() as Arc<dyn PrMonitor>);

    let iterations_before = ctx.api().get_iterations(&task_id).unwrap().len();
    ctx.force_auto_resolve_check();
    ctx.tick();
    let iterations_after = ctx.api().get_iterations(&task_id).unwrap().len();

    assert_eq!(
        iterations_after, iterations_before,
        "No iteration should be created for a merged PR"
    );
    let task = ctx.api().get_task(&task_id).unwrap();
    assert!(task.state.is_done(), "Task should remain Done");
}

/// Comments from the authenticated user are filtered out and don't trigger.
#[test]
fn test_auto_resolve_filters_self_comments() {
    let workflow = disable_auto_merge(test_default_workflow());
    let mut ctx = TestEnv::with_git(&workflow, &["planner", "breakdown", "worker", "reviewer"]);

    let task = ctx.create_task("Self-comment test", "Bot commenting on its own PR", None);
    let task_id = task.id.clone();

    advance_to_done(&ctx, &task_id);
    set_pr_url(&ctx, &task_id, "https://github.com/acme/repo/pull/6");
    set_auto_resolve(&ctx, &task_id, true);

    let mock = Arc::new(MockPrMonitor::new());
    mock.set_authenticated_user("orkestra-bot");
    mock.set_next_status(AutoResolveStatus {
        pr_state: PrState::Open,
        failed_checks: vec![],
        // Only self-comments — these must be filtered out
        comments: vec![AutoResolveComment {
            id: 400,
            author: "orkestra-bot".to_string(),
            body: "Work summary posted by bot".to_string(),
            path: None,
            line: None,
        }],
        reviews: vec![],
        all_checks_concluded: true,
    });
    ctx.set_pr_monitor(mock.clone() as Arc<dyn PrMonitor>);

    let iterations_before = ctx.api().get_iterations(&task_id).unwrap().len();
    ctx.force_auto_resolve_check();
    ctx.tick();
    let iterations_after = ctx.api().get_iterations(&task_id).unwrap().len();

    assert_eq!(
        iterations_after, iterations_before,
        "Self-comments should be filtered and not trigger an iteration"
    );
}

/// Tasks without `auto_resolve`, without `pr_url`, or not Done are not candidates.
#[test]
fn test_auto_resolve_candidate_filtering() {
    let workflow = disable_auto_merge(test_default_workflow());
    let mut ctx = TestEnv::with_git(&workflow, &["planner", "breakdown", "worker", "reviewer"]);

    // Task 1: Done + pr_url but auto_resolve=false → not a candidate
    let t1 = ctx.create_task("No auto_resolve flag", "auto_resolve disabled", None);
    let t1_id = t1.id.clone();
    advance_to_done(&ctx, &t1_id);
    set_pr_url(&ctx, &t1_id, "https://github.com/acme/repo/pull/7");
    // auto_resolve stays false (default)

    // Task 2: auto_resolve=true but no pr_url → not a candidate
    let t2 = ctx.create_task("No PR URL", "no pr_url set", None);
    let t2_id = t2.id.clone();
    advance_to_done(&ctx, &t2_id);
    set_auto_resolve(&ctx, &t2_id, true);
    // pr_url stays None

    // Task 3: auto_resolve=true + pr_url but still Queued → not a candidate
    let t3 = ctx.create_task("Not Done", "still in pipeline", None);
    let t3_id = t3.id.clone();
    // Don't advance — stays in planning/queued
    set_auto_resolve(&ctx, &t3_id, true);

    let mock = Arc::new(MockPrMonitor::new());
    // If any poll were triggered, set_next_status would not be configured,
    // causing the mock to return a default status. The test below verifies
    // no iterations changed.
    ctx.set_pr_monitor(mock.clone() as Arc<dyn PrMonitor>);

    let iters_t1_before = ctx.api().get_iterations(&t1_id).unwrap().len();
    let iters_t2_before = ctx.api().get_iterations(&t2_id).unwrap().len();
    let iters_t3_before = ctx.api().get_iterations(&t3_id).unwrap().len();

    ctx.force_auto_resolve_check();
    ctx.tick();

    let iters_t1_after = ctx.api().get_iterations(&t1_id).unwrap().len();
    let iters_t2_after = ctx.api().get_iterations(&t2_id).unwrap().len();
    let iters_t3_after = ctx.api().get_iterations(&t3_id).unwrap().len();

    assert_eq!(
        iters_t1_after, iters_t1_before,
        "t1: auto_resolve=false — should not be polled"
    );
    assert_eq!(
        iters_t2_after, iters_t2_before,
        "t2: no pr_url — should not be polled"
    );
    assert_eq!(
        iters_t3_after, iters_t3_before,
        "t3: not Done — should not be polled"
    );
    // Monitor should not have been called
    assert_eq!(
        mock.call_count(),
        0,
        "Monitor should not have been polled for non-candidates"
    );
}
