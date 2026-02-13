//! E2E tests for the integration choice point (`auto_merge`, `merge_task`, `open_pr`, Failed state).

use orkestra_core::testutil::fixtures::test_default_workflow;
use orkestra_core::workflow::ports::{PrError, WorkflowError};
use orkestra_core::workflow::runtime::{Phase, Status};

use super::helpers::{disable_auto_merge, MockAgentOutput, TestEnv};

/// Helper to advance a task through all stages to Done.
fn advance_to_done(ctx: &TestEnv, task_id: &str) {
    // Planning stage
    ctx.set_output(
        task_id,
        MockAgentOutput::Artifact {
            name: "plan".to_string(),
            content: "Implementation plan".to_string(),
            activity_log: None,
        },
    );
    ctx.advance(); // spawn planner
    ctx.advance(); // process plan
    ctx.api().approve(task_id).unwrap();
    ctx.advance(); // commit + advance to breakdown

    // Breakdown stage
    ctx.set_output(
        task_id,
        MockAgentOutput::Artifact {
            name: "breakdown".to_string(),
            content: "Task breakdown".to_string(),
            activity_log: None,
        },
    );
    ctx.advance(); // spawn breakdown
    ctx.advance(); // process breakdown
    ctx.api().approve(task_id).unwrap();
    ctx.advance(); // commit + advance to work

    // Work stage
    ctx.set_output(
        task_id,
        MockAgentOutput::Artifact {
            name: "summary".to_string(),
            content: "Implementation complete".to_string(),
            activity_log: None,
        },
    );
    ctx.advance(); // spawn worker
    ctx.advance(); // process summary
    ctx.api().approve(task_id).unwrap();
    ctx.advance(); // commit + advance to review

    // Review stage
    ctx.set_output(
        task_id,
        MockAgentOutput::Approval {
            decision: "approve".to_string(),
            content: "LGTM".to_string(),
            activity_log: None,
        },
    );
    ctx.advance(); // spawn reviewer
    ctx.advance(); // process approval -> Done
}

// =============================================================================
// auto_merge Gating Tests
// =============================================================================

/// When `auto_merge` is false, Done tasks are NOT auto-integrated.
#[test]
fn auto_merge_disabled_pauses_done_tasks() {
    let workflow = disable_auto_merge(test_default_workflow());
    let ctx = TestEnv::with_git(&workflow, &["planner", "breakdown", "worker", "reviewer"]);

    let task = ctx.create_task("Test task", "Description", None);
    let task_id = task.id.clone();

    advance_to_done(&ctx, &task_id);

    // Verify task is Done+Idle after review stage
    let task = ctx.api().get_task(&task_id).unwrap();
    assert_eq!(task.status, Status::Done, "Task should be Done");
    assert_eq!(task.phase, Phase::Idle, "Task should be Idle");

    // Tick several more times — task should stay Done+Idle (not auto-integrated)
    ctx.advance();
    ctx.advance();
    ctx.advance();

    let task = ctx.api().get_task(&task_id).unwrap();
    assert_eq!(task.status, Status::Done, "Task should still be Done");
    assert_eq!(task.phase, Phase::Idle, "Task should still be Idle");
    // Task should NOT be Archived (integration didn't happen)
}

/// When `auto_merge` is explicitly enabled, Done tasks are auto-integrated.
#[test]
fn auto_merge_enabled_integrates_normally() {
    let mut workflow = test_default_workflow();
    workflow.integration.auto_merge = true; // Explicitly enable auto_merge
    let ctx = TestEnv::with_git(&workflow, &["planner", "breakdown", "worker", "reviewer"]);

    let task = ctx.create_task("Test task", "Description", None);
    let task_id = task.id.clone();

    advance_to_done(&ctx, &task_id);

    // With auto_merge enabled and sync_background, the task auto-integrates
    // in the same tick that processes the review approval.
    // By the time advance_to_done returns, integration has already happened.
    let task = ctx.api().get_task(&task_id).unwrap();
    assert_eq!(
        task.status,
        Status::Archived,
        "Task should be Archived (auto-integrated)"
    );
}

// =============================================================================
// merge_task() Tests
// =============================================================================

/// `merge_task()` triggers integration for a Done task.
#[test]
fn merge_task_triggers_integration() {
    let workflow = disable_auto_merge(test_default_workflow());
    let ctx = TestEnv::with_git(&workflow, &["planner", "breakdown", "worker", "reviewer"]);

    let task = ctx.create_task("Test task", "Description", None);
    let task_id = task.id.clone();

    advance_to_done(&ctx, &task_id);

    // Verify task is Done+Idle before explicit merge
    let task = ctx.api().get_task(&task_id).unwrap();
    assert_eq!(task.status, Status::Done, "Task should be Done");
    assert_eq!(task.phase, Phase::Idle, "Task should be Idle");

    // Task is Done but not integrated (auto_merge is false)
    ctx.api().merge_task(&task_id).unwrap();

    // Integration runs in background, but sync_background makes it run inline
    ctx.advance(); // let integration complete

    let task = ctx.api().get_task(&task_id).unwrap();
    assert_eq!(task.status, Status::Archived, "Task should be Archived");
}

/// `merge_task()` fails if task is not Done.
#[test]
fn merge_task_rejects_non_done_task() {
    let workflow = disable_auto_merge(test_default_workflow());
    let ctx = TestEnv::with_git(&workflow, &["planner", "breakdown", "worker", "reviewer"]);

    let task = ctx.create_task("Test task", "Description", None);
    let task_id = task.id.clone();

    // Task is in Active (planning) state
    let result = ctx.api().merge_task(&task_id);
    assert!(
        matches!(result, Err(WorkflowError::InvalidTransition(_))),
        "merge_task should return InvalidTransition for non-Done task"
    );
}

// =============================================================================
// open_pr() Tests
// =============================================================================

/// `begin_pr_creation()` transitions task to Integrating phase.
#[test]
fn begin_pr_creation_transitions_to_integrating() {
    let workflow = disable_auto_merge(test_default_workflow());
    let ctx = TestEnv::with_git(&workflow, &["planner", "breakdown", "worker", "reviewer"]);

    let task = ctx.create_task("Test task", "Description", None);
    let task_id = task.id.clone();

    advance_to_done(&ctx, &task_id);

    // Verify task is Done+Idle before PR creation
    let task = ctx.api().get_task(&task_id).unwrap();
    assert_eq!(task.status, Status::Done, "Task should be Done");
    assert_eq!(task.phase, Phase::Idle, "Task should be Idle");

    // Begin PR creation
    let task = ctx.api().begin_pr_creation(&task_id).unwrap();

    assert_eq!(task.status, Status::Done, "Task should still be Done");
    assert_eq!(
        task.phase,
        Phase::Integrating,
        "Task should be in Integrating phase"
    );
}

/// PR creation success stores URL and returns task to Done+Idle.
#[test]
fn pr_creation_succeeded_stores_url_and_returns_to_idle() {
    let workflow = disable_auto_merge(test_default_workflow());
    let ctx = TestEnv::with_git(&workflow, &["planner", "breakdown", "worker", "reviewer"]);

    let task = ctx.create_task("Test task", "Description", None);
    let task_id = task.id.clone();

    advance_to_done(&ctx, &task_id);

    // Verify task is Done+Idle before PR creation
    let task = ctx.api().get_task(&task_id).unwrap();
    assert_eq!(task.status, Status::Done, "Task should be Done");
    assert_eq!(task.phase, Phase::Idle, "Task should be Idle");

    // Begin PR creation
    ctx.api().begin_pr_creation(&task_id).unwrap();

    // Simulate successful PR creation
    let task = ctx
        .api()
        .pr_creation_succeeded(&task_id, "https://github.com/test/repo/pull/42")
        .unwrap();

    assert_eq!(task.status, Status::Done, "Task should still be Done");
    assert_eq!(task.phase, Phase::Idle, "Task should return to Idle");
    assert_eq!(
        task.pr_url,
        Some("https://github.com/test/repo/pull/42".to_string()),
        "PR URL should be stored"
    );
}

// =============================================================================
// PR Creation Failure → Failed State Tests
// =============================================================================

/// `pr_creation_failed()` transitions task to Failed with error message.
#[test]
fn pr_creation_failed_transitions_to_failed() {
    let workflow = disable_auto_merge(test_default_workflow());
    let ctx = TestEnv::with_git(&workflow, &["planner", "breakdown", "worker", "reviewer"]);

    let task = ctx.create_task("Test task", "Description", None);
    let task_id = task.id.clone();

    advance_to_done(&ctx, &task_id);

    // Verify task is Done+Idle before PR creation
    let task = ctx.api().get_task(&task_id).unwrap();
    assert_eq!(task.status, Status::Done, "Task should be Done");
    assert_eq!(task.phase, Phase::Idle, "Task should be Idle");

    // Begin PR creation
    ctx.api().begin_pr_creation(&task_id).unwrap();

    // Simulate PR creation failure
    let task = ctx
        .api()
        .pr_creation_failed(&task_id, "Failed to create pull request: auth expired")
        .unwrap();

    let Status::Failed { error } = &task.status else {
        panic!("Task should be in Failed state, got: {:?}", task.status)
    };
    assert!(error.is_some(), "Failed status should have error message");
    let err_msg = error.as_ref().unwrap();
    assert!(
        err_msg.contains("Failed to create pull request"),
        "Error message should mention PR creation failure"
    );
    assert_eq!(task.pr_url, None, "PR URL should not be set on failure");
}

// Note: Push failure test omitted because TestEnv::with_git uses Git2GitService (real git).
// Testing push failures would require adding MockGitService support to TestEnv, which is
// beyond the scope of this task. The production PrService implementation handles push
// failures correctly, and this scenario is covered by unit tests in the integration module.

// =============================================================================
// retry_pr_creation() Tests
// =============================================================================

/// `retry_pr_creation` recovers Failed task back to Done+Idle.
#[test]
fn retry_pr_creation_recovers_to_done() {
    let workflow = disable_auto_merge(test_default_workflow());
    let ctx = TestEnv::with_git(&workflow, &["planner", "breakdown", "worker", "reviewer"]);

    let task = ctx.create_task("Test task", "Description", None);
    let task_id = task.id.clone();

    advance_to_done(&ctx, &task_id);

    // Verify task is Done+Idle before PR creation
    let task = ctx.api().get_task(&task_id).unwrap();
    assert_eq!(task.status, Status::Done, "Task should be Done");
    assert_eq!(task.phase, Phase::Idle, "Task should be Idle");

    // Begin and fail PR creation
    ctx.api().begin_pr_creation(&task_id).unwrap();
    ctx.api()
        .pr_creation_failed(&task_id, "Failed to create pull request: network error")
        .unwrap();

    // Verify task is Failed
    let task = ctx.api().get_task(&task_id).unwrap();
    assert!(
        matches!(task.status, Status::Failed { .. }),
        "Task should be Failed"
    );

    // Retry PR creation
    let task = ctx.api().retry_pr_creation(&task_id).unwrap();

    assert_eq!(task.status, Status::Done, "Task should be Done again");
    assert_eq!(task.phase, Phase::Idle, "Task should be Idle");
    assert_eq!(task.pr_url, None, "PR URL should still be None");

    // Now can successfully create PR
    ctx.api().begin_pr_creation(&task_id).unwrap();
    let task = ctx
        .api()
        .pr_creation_succeeded(&task_id, "https://github.com/test/repo/pull/43")
        .unwrap();

    assert_eq!(task.status, Status::Done);
    assert_eq!(task.phase, Phase::Idle);
    assert_eq!(
        task.pr_url,
        Some("https://github.com/test/repo/pull/43".to_string())
    );
}

// =============================================================================
// One-Way-Door Invariant Tests
// =============================================================================

/// Cannot merge a task that already has an open PR.
#[test]
fn cannot_merge_after_pr_opened() {
    let workflow = disable_auto_merge(test_default_workflow());
    let ctx = TestEnv::with_git(&workflow, &["planner", "breakdown", "worker", "reviewer"]);

    let task = ctx.create_task("Test task", "Description", None);
    let task_id = task.id.clone();

    advance_to_done(&ctx, &task_id);

    // Verify task is Done+Idle before PR creation
    let task = ctx.api().get_task(&task_id).unwrap();
    assert_eq!(task.status, Status::Done, "Task should be Done");
    assert_eq!(task.phase, Phase::Idle, "Task should be Idle");

    // Successfully create PR
    ctx.api().begin_pr_creation(&task_id).unwrap();
    ctx.api()
        .pr_creation_succeeded(&task_id, "https://github.com/test/repo/pull/42")
        .unwrap();

    // Verify PR is open
    let task = ctx.api().get_task(&task_id).unwrap();
    assert!(task.pr_url.is_some(), "PR URL should be set");

    // Attempt to merge should fail
    let result = ctx.api().merge_task(&task_id);
    assert!(
        matches!(result, Err(WorkflowError::InvalidTransition(_))),
        "merge_task should return InvalidTransition after PR is open"
    );
}

/// Cannot open PR for a task that already has one.
#[test]
fn cannot_open_pr_twice() {
    let workflow = disable_auto_merge(test_default_workflow());
    let ctx = TestEnv::with_git(&workflow, &["planner", "breakdown", "worker", "reviewer"]);

    let task = ctx.create_task("Test task", "Description", None);
    let task_id = task.id.clone();

    advance_to_done(&ctx, &task_id);

    // Verify task is Done+Idle before PR creation
    let task = ctx.api().get_task(&task_id).unwrap();
    assert_eq!(task.status, Status::Done, "Task should be Done");
    assert_eq!(task.phase, Phase::Idle, "Task should be Idle");

    // Successfully create PR
    ctx.api().begin_pr_creation(&task_id).unwrap();
    ctx.api()
        .pr_creation_succeeded(&task_id, "https://github.com/test/repo/pull/42")
        .unwrap();

    // Attempt to open PR again should fail
    let result = ctx.api().begin_pr_creation(&task_id);
    assert!(
        matches!(result, Err(WorkflowError::InvalidTransition(_))),
        "begin_pr_creation should return InvalidTransition when PR already exists"
    );
}

/// `retry_pr_creation` rejects non-Failed tasks.
#[test]
fn retry_pr_rejects_non_failed_task() {
    let workflow = disable_auto_merge(test_default_workflow());
    let ctx = TestEnv::with_git(&workflow, &["planner", "breakdown", "worker", "reviewer"]);

    let task = ctx.create_task("Test task", "Description", None);
    let task_id = task.id.clone();

    advance_to_done(&ctx, &task_id);

    // Verify task is Done+Idle (not Failed)
    let task = ctx.api().get_task(&task_id).unwrap();
    assert_eq!(task.status, Status::Done, "Task should be Done");
    assert_eq!(task.phase, Phase::Idle, "Task should be Idle");

    // Attempt to retry should fail
    let result = ctx.api().retry_pr_creation(&task_id);
    assert!(
        matches!(result, Err(WorkflowError::InvalidTransition(_))),
        "retry_pr_creation should return InvalidTransition for non-Failed task"
    );
}

// =============================================================================
// Orchestrator-Driven PR Creation Tests
// =============================================================================

/// Orchestrator detects Done+Integrating tasks with no `pr_url` and spawns PR creation.
#[test]
fn orchestrator_spawns_pr_creation() {
    let workflow = disable_auto_merge(test_default_workflow());
    let ctx = TestEnv::with_git(&workflow, &["planner", "breakdown", "worker", "reviewer"]);

    // Create a local bare repository to push to (git push needs a valid target)
    let bare_repo = tempfile::tempdir().expect("Should create temp dir");
    std::process::Command::new("git")
        .args(["init", "--bare"])
        .current_dir(bare_repo.path())
        .output()
        .expect("Should init bare repo");

    // Add the bare repo as origin
    std::process::Command::new("git")
        .args([
            "remote",
            "add",
            "origin",
            bare_repo.path().to_str().unwrap(),
        ])
        .current_dir(ctx.temp_dir())
        .output()
        .expect("Should add git remote");

    let task = ctx.create_task("Test task", "Description", None);
    let task_id = task.id.clone();

    advance_to_done(&ctx, &task_id);

    // Verify task is Done+Idle before PR creation
    let task = ctx.api().get_task(&task_id).unwrap();
    assert_eq!(task.status, Status::Done, "Task should be Done");
    assert_eq!(task.phase, Phase::Idle, "Task should be Idle");

    // Configure mock PR service to succeed
    ctx.pr_service()
        .set_next_result(Ok("https://github.com/test/repo/pull/42".to_string()));

    // Begin PR creation (marks task as Integrating)
    ctx.api().begin_pr_creation(&task_id).unwrap();

    // Verify task is Integrating
    let task = ctx.api().get_task(&task_id).unwrap();
    assert_eq!(task.status, Status::Done, "Task should still be Done");
    assert_eq!(
        task.phase,
        Phase::Integrating,
        "Task should be in Integrating phase"
    );
    assert_eq!(task.pr_url, None, "PR URL should not be set yet");

    // Advance orchestrator — should detect Done+Integrating+no_pr_url and spawn PR creation
    ctx.advance();

    // Verify PR creation completed (task has pr_url and returned to Idle)
    let task = ctx.api().get_task(&task_id).unwrap();
    assert_eq!(task.status, Status::Done, "Task should still be Done");
    assert_eq!(task.phase, Phase::Idle, "Task should return to Idle");
    assert_eq!(
        task.pr_url,
        Some("https://github.com/test/repo/pull/42".to_string()),
        "PR URL should be stored"
    );
}

/// Orchestrator handles PR creation failures and transitions task to Failed.
#[test]
fn orchestrator_handles_pr_creation_failure() {
    let workflow = disable_auto_merge(test_default_workflow());
    let ctx = TestEnv::with_git(&workflow, &["planner", "breakdown", "worker", "reviewer"]);

    // Create a local bare repository to push to (git push needs a valid target)
    let bare_repo = tempfile::tempdir().expect("Should create temp dir");
    std::process::Command::new("git")
        .args(["init", "--bare"])
        .current_dir(bare_repo.path())
        .output()
        .expect("Should init bare repo");

    // Add the bare repo as origin
    std::process::Command::new("git")
        .args([
            "remote",
            "add",
            "origin",
            bare_repo.path().to_str().unwrap(),
        ])
        .current_dir(ctx.temp_dir())
        .output()
        .expect("Should add git remote");

    let task = ctx.create_task("Test task", "Description", None);
    let task_id = task.id.clone();

    advance_to_done(&ctx, &task_id);

    // Configure mock PR service to fail
    ctx.pr_service()
        .set_next_result(Err(PrError::CreationFailed(
            "Failed to create pull request: authentication failed".to_string(),
        )));

    // Begin PR creation
    ctx.api().begin_pr_creation(&task_id).unwrap();

    // Advance orchestrator — should detect Done+Integrating+no_pr_url and spawn PR creation
    ctx.advance();

    // Verify task transitioned to Failed
    let task = ctx.api().get_task(&task_id).unwrap();
    let Status::Failed { error } = &task.status else {
        panic!("Task should be in Failed state, got: {:?}", task.status)
    };
    assert!(error.is_some(), "Failed status should have error message");
    let err_msg = error.as_ref().unwrap();
    assert!(
        err_msg.contains("PR creation failed"),
        "Error message should mention PR creation failure"
    );
    assert_eq!(task.phase, Phase::Idle, "Task should be Idle");
    assert_eq!(task.pr_url, None, "PR URL should not be set on failure");
}
