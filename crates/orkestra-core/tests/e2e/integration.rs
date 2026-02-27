//! E2E tests for the integration choice point (`auto_merge`, `merge_task`, `open_pr`, Failed state).

use orkestra_core::testutil::fixtures::test_default_workflow;
use orkestra_core::workflow::ports::{PrError, WorkflowError};
use orkestra_core::workflow::runtime::TaskState;
use orkestra_core::workflow::{create_pr_sync, merge_task_sync};

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
    assert!(matches!(task.state, TaskState::Done), "Task should be Done");

    // Tick several more times — task should stay Done+Idle (not auto-integrated)
    ctx.advance();
    ctx.advance();
    ctx.advance();

    let task = ctx.api().get_task(&task_id).unwrap();
    assert!(
        matches!(task.state, TaskState::Done),
        "Task should still be Done"
    );
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
        task.state,
        TaskState::Archived,
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
    assert!(matches!(task.state, TaskState::Done), "Task should be Done");

    // User triggers merge (sync=true runs inline for tests)
    merge_task_sync(ctx.api_arc(), &task_id).unwrap();

    let task = ctx.api().get_task(&task_id).unwrap();
    assert!(
        matches!(task.state, TaskState::Archived),
        "Task should be Archived"
    );
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
    assert!(matches!(task.state, TaskState::Done), "Task should be Done");

    // Begin PR creation
    let task = ctx.api().begin_pr_creation(&task_id).unwrap();

    assert_eq!(
        task.state,
        TaskState::Integrating,
        "Task should be in Integrating state"
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
    assert!(matches!(task.state, TaskState::Done), "Task should be Done");

    // Begin PR creation
    ctx.api().begin_pr_creation(&task_id).unwrap();

    // Simulate successful PR creation
    let task = ctx
        .api()
        .pr_creation_succeeded(&task_id, "https://github.com/test/repo/pull/42")
        .unwrap();

    assert!(
        matches!(task.state, TaskState::Done),
        "Task should still be Done"
    );
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
    assert!(matches!(task.state, TaskState::Done), "Task should be Done");

    // Begin PR creation
    ctx.api().begin_pr_creation(&task_id).unwrap();

    // Simulate PR creation failure
    let task = ctx
        .api()
        .pr_creation_failed(&task_id, "Failed to create pull request: auth expired")
        .unwrap();

    let TaskState::Failed { error } = &task.state else {
        panic!("Task should be in Failed state, got: {:?}", task.state)
    };
    assert!(error.is_some(), "Failed state should have error message");
    let err_msg = error.as_ref().unwrap();
    assert!(
        err_msg.contains("Failed to create pull request"),
        "Error message should mention PR creation failure"
    );
    assert_eq!(task.pr_url, None, "PR URL should not be set on failure");
}

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
    assert!(matches!(task.state, TaskState::Done), "Task should be Done");

    // Begin and fail PR creation
    ctx.api().begin_pr_creation(&task_id).unwrap();
    ctx.api()
        .pr_creation_failed(&task_id, "Failed to create pull request: network error")
        .unwrap();

    // Verify task is Failed
    let task = ctx.api().get_task(&task_id).unwrap();
    assert!(
        matches!(task.state, TaskState::Failed { .. }),
        "Task should be Failed"
    );

    // Retry PR creation
    let task = ctx.api().retry_pr_creation(&task_id).unwrap();

    assert!(
        matches!(task.state, TaskState::Done),
        "Task should be Done again"
    );
    assert_eq!(task.pr_url, None, "PR URL should still be None");

    // Now can successfully create PR
    ctx.api().begin_pr_creation(&task_id).unwrap();
    let task = ctx
        .api()
        .pr_creation_succeeded(&task_id, "https://github.com/test/repo/pull/43")
        .unwrap();

    assert!(matches!(task.state, TaskState::Done));
    assert!(task.is_done());
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
    assert!(matches!(task.state, TaskState::Done), "Task should be Done");

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
    assert!(matches!(task.state, TaskState::Done), "Task should be Done");

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
    assert!(matches!(task.state, TaskState::Done), "Task should be Done");

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

/// `create_pr_sync` runs the full PR pipeline (commit, push, create PR) synchronously.
#[test]
fn create_pr_sync_completes_pr_creation() {
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
    assert!(matches!(task.state, TaskState::Done), "Task should be Done");

    // Configure mock PR service to succeed
    ctx.pr_service()
        .set_next_result(Ok("https://github.com/test/repo/pull/42".to_string()));

    // Call create_pr_sync directly — marks task as Integrating, runs the full pipeline inline
    let task = create_pr_sync(ctx.api_arc(), &task_id).unwrap();

    // Verify PR creation completed (task has pr_url and returned to Idle)
    assert!(
        matches!(task.state, TaskState::Done),
        "Task should still be Done"
    );
    assert_eq!(
        task.pr_url,
        Some("https://github.com/test/repo/pull/42".to_string()),
        "PR URL should be stored"
    );
}

/// `create_pr_sync` handles PR creation failures and transitions task to Failed.
#[test]
fn create_pr_sync_handles_failure() {
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

    // Call create_pr_sync directly — records failure via pr_creation_failed
    let task = create_pr_sync(ctx.api_arc(), &task_id).unwrap();

    // Verify task transitioned to Failed
    let TaskState::Failed { error } = &task.state else {
        panic!("Task should be in Failed state, got: {:?}", task.state)
    };
    assert!(error.is_some(), "Failed state should have error message");
    let err_msg = error.as_ref().unwrap();
    assert!(
        err_msg.contains("PR creation failed"),
        "Error message should mention PR creation failure"
    );
    assert!(task.is_failed(), "Task should be Failed");
    assert_eq!(task.pr_url, None, "PR URL should not be set on failure");
}

// =============================================================================
// Remote Sync Tests
// =============================================================================

/// Integration syncs base branch from remote before rebase and pushes after merge.
#[test]
fn integration_syncs_and_pushes_for_non_task_branches() {
    use super::helpers::workflows;

    let workflow = disable_auto_merge(workflows::with_subtasks());
    let ctx = TestEnv::with_mock_git(&workflow, &["planner", "breakdown", "worker", "reviewer"]);

    let task = ctx.create_task("Test task", "Description", None);
    let task_id = task.id.clone();

    // Verify task has base_branch = "main" (not starting with "task/")
    assert_eq!(task.base_branch, "main");

    // Clear any sync calls from task creation
    let pre_integration_sync_calls = ctx.mock_git_service().get_sync_base_branch_calls();
    let pre_integration_push_calls = ctx.mock_git_service().get_push_branch_calls();

    advance_to_done(&ctx, &task_id);

    // User triggers merge
    merge_task_sync(ctx.api_arc(), &task_id).unwrap();

    let task = ctx.api().get_task(&task_id).unwrap();
    assert!(
        matches!(task.state, TaskState::Archived),
        "Task should be Archived"
    );

    // Verify sync_base_branch was called with "main" during integration
    let post_integration_sync_calls = ctx.mock_git_service().get_sync_base_branch_calls();
    let integration_sync_calls: Vec<_> = post_integration_sync_calls
        .iter()
        .skip(pre_integration_sync_calls.len())
        .collect();
    assert!(
        integration_sync_calls.contains(&&"main".to_string()),
        "sync_base_branch should be called with 'main' during integration, got: {integration_sync_calls:?}"
    );

    // Verify push_branch was called with "main" during integration
    let post_integration_push_calls = ctx.mock_git_service().get_push_branch_calls();
    let integration_push_calls: Vec<_> = post_integration_push_calls
        .iter()
        .skip(pre_integration_push_calls.len())
        .collect();
    assert!(
        integration_push_calls.contains(&&"main".to_string()),
        "push_branch should be called with 'main' during integration, got: {integration_push_calls:?}"
    );
}

/// Helper to advance two tasks through a single stage together.
/// Sets mock outputs for both, advances orchestrator, and approves both if needed.
fn advance_both_through_stage(
    ctx: &TestEnv,
    task1_id: &str,
    task2_id: &str,
    artifact_name: &str,
    is_approval_stage: bool,
) {
    if is_approval_stage {
        ctx.set_output(
            task1_id,
            MockAgentOutput::Approval {
                decision: "approve".to_string(),
                content: "LGTM".to_string(),
                activity_log: None,
            },
        );
        ctx.set_output(
            task2_id,
            MockAgentOutput::Approval {
                decision: "approve".to_string(),
                content: "LGTM".to_string(),
                activity_log: None,
            },
        );
    } else {
        ctx.set_output(
            task1_id,
            MockAgentOutput::Artifact {
                name: artifact_name.to_string(),
                content: format!("Content for {artifact_name}"),
                activity_log: None,
            },
        );
        ctx.set_output(
            task2_id,
            MockAgentOutput::Artifact {
                name: artifact_name.to_string(),
                content: format!("Content for {artifact_name}"),
                activity_log: None,
            },
        );
    }
    ctx.advance(); // spawn agents
    ctx.advance(); // process outputs

    // Approve if tasks need review (non-automated stages)
    if !is_approval_stage {
        if ctx.api().get_task(task1_id).unwrap().needs_review() {
            ctx.api().approve(task1_id).unwrap();
        }
        if ctx.api().get_task(task2_id).unwrap().needs_review() {
            ctx.api().approve(task2_id).unwrap();
        }
        ctx.advance(); // commit + advance
    }
}

/// Integration succeeds even when `sync_base_branch` fails (network/auth issues).
#[test]
fn integration_succeeds_when_sync_fails() {
    use super::helpers::workflows;
    use orkestra_core::workflow::ports::GitError;

    let workflow = disable_auto_merge(workflows::with_subtasks());
    let ctx = TestEnv::with_mock_git(&workflow, &["planner", "breakdown", "worker", "reviewer"]);

    let task = ctx.create_task("Test task", "Description", None);
    let task_id = task.id.clone();

    advance_to_done(&ctx, &task_id);

    // Configure sync to fail before integration
    ctx.mock_git_service()
        .set_next_sync_result(Err(GitError::Other("Network error".to_string())));

    // User triggers merge - should succeed despite sync failure
    merge_task_sync(ctx.api_arc(), &task_id).unwrap();

    let task = ctx.api().get_task(&task_id).unwrap();
    assert_eq!(
        task.state,
        TaskState::Archived,
        "Task should be Archived despite sync failure"
    );
}

/// Integration succeeds even when `push_branch` fails (network/auth issues).
#[test]
fn integration_succeeds_when_push_fails() {
    use super::helpers::workflows;
    use orkestra_core::workflow::ports::GitError;

    let workflow = disable_auto_merge(workflows::with_subtasks());
    let ctx = TestEnv::with_mock_git(&workflow, &["planner", "breakdown", "worker", "reviewer"]);

    let task = ctx.create_task("Test task", "Description", None);
    let task_id = task.id.clone();

    advance_to_done(&ctx, &task_id);

    // Configure push to fail after merge
    ctx.mock_git_service()
        .set_next_push_result(Err(GitError::Other("Auth expired".to_string())));

    // User triggers merge - should succeed despite push failure
    merge_task_sync(ctx.api_arc(), &task_id).unwrap();

    let task = ctx.api().get_task(&task_id).unwrap();
    assert_eq!(
        task.state,
        TaskState::Archived,
        "Task should be Archived despite push failure"
    );
}

/// Integration skips sync and push for task/* branches (subtask integration).
#[test]
fn integration_skips_sync_and_push_for_task_branches() {
    let workflow = disable_auto_merge(test_default_workflow());
    let ctx = TestEnv::with_mock_git(&workflow, &["planner", "breakdown", "worker", "reviewer"]);

    // Create parent task (stays Active - we'll set mock outputs for both)
    let parent = ctx.create_task("Parent task", "Description", None);
    let parent_id = parent.id.clone();

    // Create subtask - its base_branch will be task/{parent_id}
    let subtask = ctx.create_subtask(&parent_id, "Subtask", "Child task");
    let subtask_id = subtask.id.clone();

    // Verify subtask has task/* base_branch
    assert!(
        subtask.base_branch.starts_with("task/"),
        "Subtask base_branch should start with 'task/', got: {}",
        subtask.base_branch
    );

    // Capture call counts before subtask integration
    let pre_integration_sync_calls = ctx.mock_git_service().get_sync_base_branch_calls();
    let pre_integration_push_calls = ctx.mock_git_service().get_push_branch_calls();

    // Advance both tasks through all stages to get subtask to Done
    advance_both_through_stage(&ctx, &parent_id, &subtask_id, "plan", false);
    advance_both_through_stage(&ctx, &parent_id, &subtask_id, "breakdown", false);
    advance_both_through_stage(&ctx, &parent_id, &subtask_id, "summary", false);
    advance_both_through_stage(&ctx, &parent_id, &subtask_id, "verdict", true);

    // Subtasks auto-integrate after review approval (they merge to parent's branch, not main)
    // So the subtask should already be Archived - no need to call merge_task_sync
    let subtask = ctx.api().get_task(&subtask_id).unwrap();
    assert_eq!(
        subtask.state,
        TaskState::Archived,
        "Subtask should be Archived after auto-integration"
    );

    // Verify sync_base_branch was NOT called with task/* branch during integration
    let post_integration_sync_calls = ctx.mock_git_service().get_sync_base_branch_calls();
    let integration_sync_calls: Vec<_> = post_integration_sync_calls
        .iter()
        .skip(pre_integration_sync_calls.len())
        .filter(|b| b.starts_with("task/"))
        .collect();
    assert!(
        integration_sync_calls.is_empty(),
        "sync_base_branch should NOT be called for task/* branches, got: {integration_sync_calls:?}"
    );

    // Verify push_branch was NOT called with task/* branch during integration
    let post_integration_push_calls = ctx.mock_git_service().get_push_branch_calls();
    let integration_push_calls: Vec<_> = post_integration_push_calls
        .iter()
        .skip(pre_integration_push_calls.len())
        .filter(|b| b.starts_with("task/"))
        .collect();
    assert!(
        integration_push_calls.is_empty(),
        "push_branch should NOT be called for task/* branches, got: {integration_push_calls:?}"
    );
}

// =============================================================================
// commit_and_push_pr_changes() Tests
// =============================================================================

/// `commit_and_push_pr_changes` commits pending changes and pushes the task's branch to origin.
#[test]
fn commit_and_push_pr_changes_pushes_to_origin() {
    use super::helpers::workflows;

    let workflow = disable_auto_merge(workflows::with_subtasks());
    let ctx = TestEnv::with_mock_git(&workflow, &["planner", "breakdown", "worker", "reviewer"]);

    let task = ctx.create_task("Test task", "Description", None);
    let task_id = task.id.clone();

    advance_to_done(&ctx, &task_id);

    // Read the task to get the generated branch name
    let task_with_branch = ctx.api().get_task(&task_id).unwrap();
    let expected_branch = task_with_branch.branch_name.unwrap();

    // Give the task a PR URL (simulating a previous open_pr call)
    ctx.api().begin_pr_creation(&task_id).unwrap();
    ctx.api()
        .pr_creation_succeeded(&task_id, "https://github.com/test/repo/pull/42")
        .unwrap();

    // Capture push calls before commit_and_push_pr_changes
    let pre_push_calls = ctx.mock_git_service().get_push_branch_calls();

    // Push PR changes
    let task = ctx.api().commit_and_push_pr_changes(&task_id).unwrap();

    // Task should still be Done with the same PR URL
    assert!(
        matches!(task.state, TaskState::Done),
        "Task should still be Done"
    );
    assert_eq!(
        task.pr_url,
        Some("https://github.com/test/repo/pull/42".to_string()),
        "PR URL should be unchanged"
    );

    // Verify push_branch was called exactly once with the task's branch
    let post_push_calls = ctx.mock_git_service().get_push_branch_calls();
    let new_push_calls: Vec<_> = post_push_calls.iter().skip(pre_push_calls.len()).collect();
    assert_eq!(
        new_push_calls.len(),
        1,
        "push_branch should have been called exactly once"
    );
    assert_eq!(
        new_push_calls[0], &expected_branch,
        "push_branch should push the task's branch"
    );
}

/// `commit_and_push_pr_changes` fails when the git push fails.
#[test]
fn commit_and_push_pr_changes_propagates_git_error() {
    use super::helpers::workflows;
    use orkestra_core::workflow::ports::GitError;

    let workflow = disable_auto_merge(workflows::with_subtasks());
    let ctx = TestEnv::with_mock_git(&workflow, &["planner", "breakdown", "worker", "reviewer"]);

    let task = ctx.create_task("Test task", "Description", None);
    let task_id = task.id.clone();

    advance_to_done(&ctx, &task_id);

    // Give the task a PR URL
    ctx.api().begin_pr_creation(&task_id).unwrap();
    ctx.api()
        .pr_creation_succeeded(&task_id, "https://github.com/test/repo/pull/42")
        .unwrap();

    // Configure mock to fail on push_branch
    ctx.mock_git_service()
        .set_next_push_result(Err(GitError::Other("remote rejected".into())));

    // commit_and_push_pr_changes should propagate the error
    let result = ctx.api().commit_and_push_pr_changes(&task_id);
    assert!(
        matches!(result, Err(WorkflowError::GitError(_))),
        "commit_and_push_pr_changes should return GitError when push fails, got: {result:?}"
    );
}

/// `commit_and_push_pr_changes` fails if the task has no open PR.
#[test]
fn commit_and_push_pr_changes_rejects_task_without_pr() {
    use super::helpers::workflows;

    let workflow = disable_auto_merge(workflows::with_subtasks());
    let ctx = TestEnv::with_mock_git(&workflow, &["planner", "breakdown", "worker", "reviewer"]);

    let task = ctx.create_task("Test task", "Description", None);
    let task_id = task.id.clone();

    advance_to_done(&ctx, &task_id);

    // Task is Done but has no PR
    let result = ctx.api().commit_and_push_pr_changes(&task_id);
    assert!(
        matches!(result, Err(WorkflowError::InvalidTransition(_))),
        "commit_and_push_pr_changes should return InvalidTransition when task has no PR"
    );
}

/// `commit_and_push_pr_changes` fails if the task is not Done.
#[test]
fn commit_and_push_pr_changes_rejects_non_done_task() {
    use super::helpers::workflows;

    let workflow = disable_auto_merge(workflows::with_subtasks());
    let ctx = TestEnv::with_mock_git(&workflow, &["planner", "breakdown", "worker", "reviewer"]);

    let task = ctx.create_task("Test task", "Description", None);
    let task_id = task.id.clone();

    // Task is still in Active (planning) state
    let result = ctx.api().commit_and_push_pr_changes(&task_id);
    assert!(
        matches!(result, Err(WorkflowError::InvalidTransition(_))),
        "commit_and_push_pr_changes should return InvalidTransition for non-Done task"
    );
}
