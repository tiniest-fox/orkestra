//! E2E tests for task creation.
//!
//! Tests that creating tasks correctly sets up worktrees, branches,
//! base branch tracking, setup scripts, subtask inheritance, and
//! title generation fallback.

use std::path::Path;

use orkestra_core::testutil::fixtures::test_default_workflow;
use orkestra_core::workflow::ports::GitError;
use orkestra_core::workflow::runtime::Phase;

use crate::helpers::TestEnv;

// =============================================================================
// Worktree Creation
// =============================================================================

#[test]
fn test_task_creation_creates_worktree() {
    let ctx = TestEnv::with_git(&test_default_workflow(), &["planner", "worker"]);

    let task = ctx.create_task("Test worktree", "Verify worktree creation", None);

    // Branch should be created
    let branch = task
        .branch_name
        .as_ref()
        .expect("Task should have a branch");
    assert!(
        branch.starts_with("task/"),
        "Branch should follow task/{{id}} pattern, got: {branch}"
    );

    // Worktree path should be set and exist on disk
    let wt_path = task
        .worktree_path
        .as_ref()
        .expect("Task should have a worktree path");
    assert!(
        Path::new(wt_path).exists(),
        "Worktree directory should exist at {wt_path}"
    );
}

#[test]
fn test_task_creation_sets_base_branch() {
    let ctx = TestEnv::with_git(&test_default_workflow(), &["planner", "worker"]);

    let task = ctx.create_task(
        "Base branch test",
        "Verify base branch defaults to main",
        None,
    );

    assert_eq!(
        task.base_branch.as_str(),
        "main",
        "Default base branch should be 'main'"
    );
}

#[test]
fn test_task_creation_from_specific_branch() {
    let ctx = TestEnv::with_git(&test_default_workflow(), &["planner", "worker"]);

    // Create a "feature" branch in the test repo
    std::process::Command::new("git")
        .args(["branch", "feature"])
        .current_dir(ctx.repo_path())
        .output()
        .expect("Should create feature branch");

    // Create task from the feature branch
    let task = ctx.create_task(
        "From feature",
        "Task based on feature branch",
        Some("feature"),
    );

    assert_eq!(
        task.base_branch.as_str(),
        "feature",
        "Base branch should be 'feature' when explicitly provided"
    );
}

// =============================================================================
// Phase Lifecycle
// =============================================================================

#[test]
fn test_task_starts_in_setting_up() {
    let ctx = TestEnv::with_git(&test_default_workflow(), &["planner", "worker"]);

    // Call the API directly (don't use create_task helper which waits for setup)
    let task = ctx
        .api()
        .create_task("Phase test", "Verify initial phase", None)
        .expect("Should create task");

    assert_eq!(
        task.phase,
        Phase::AwaitingSetup,
        "Task should start in AwaitingSetup phase"
    );
}

// =============================================================================
// Setup Script
// =============================================================================

#[test]
fn test_setup_script_runs_on_creation() {
    let ctx = TestEnv::with_git(&test_default_workflow(), &["planner", "worker"]);

    // Write a setup script that creates a marker file
    orkestra_core::testutil::create_worktree_setup_script(ctx.repo_path())
        .expect("Should create setup script");

    let task = ctx.create_task("Setup script test", "Verify setup script runs", None);

    let wt_path = task
        .worktree_path
        .as_ref()
        .expect("Task should have worktree path");
    let marker = Path::new(wt_path).join(".setup_complete");
    assert!(
        marker.exists(),
        "Setup script should have created marker file at {}",
        marker.display()
    );
}

#[test]
fn test_setup_script_failure_fails_task() {
    let ctx = TestEnv::with_git(&test_default_workflow(), &["planner", "worker"]);

    // Write a setup script that exits with error
    let script_path = ctx.repo_path().join(".orkestra/scripts/worktree_setup.sh");
    std::fs::create_dir_all(script_path.parent().unwrap()).expect("Should create scripts dir");
    std::fs::write(&script_path, "#!/bin/bash\nexit 1\n").expect("Should write failing script");

    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let mut perms = std::fs::metadata(&script_path)
            .expect("Should read perms")
            .permissions();
        perms.set_mode(0o755);
        std::fs::set_permissions(&script_path, perms).expect("Should set perms");
    }

    // create_task waits for setup, which should transition to Failed
    let task = ctx.create_task("Failing setup", "Script should fail", None);

    assert!(
        task.is_failed(),
        "Task should be failed when setup script exits with error, got status: {:?}",
        task.status
    );
}

// =============================================================================
// Subtask Inheritance
// =============================================================================

#[test]
fn test_subtask_gets_own_worktree() {
    let ctx = TestEnv::with_git(&test_default_workflow(), &["planner", "worker"]);

    let parent = ctx.create_task("Parent", "Parent task for subtask test", None);
    let parent_id = parent.id.clone();

    let child = ctx.create_subtask(&parent_id, "Child", "Subtask should get own worktree");

    // Subtask should get its OWN worktree, not share parent's
    assert_ne!(
        child.worktree_path, parent.worktree_path,
        "Subtask should have a different worktree path from parent"
    );
    assert_ne!(
        child.branch_name, parent.branch_name,
        "Subtask should have a different branch from parent"
    );

    // Subtask's base_branch should be the parent's branch_name
    assert_eq!(
        child.base_branch,
        parent.branch_name.clone().unwrap_or_default(),
        "Subtask's base_branch should be parent's branch_name"
    );

    // Both worktrees should exist on disk
    let parent_wt = parent
        .worktree_path
        .as_ref()
        .expect("Parent should have worktree");
    let child_wt = child
        .worktree_path
        .as_ref()
        .expect("Child should have worktree");
    assert!(
        Path::new(parent_wt).exists(),
        "Parent worktree should exist"
    );
    assert!(Path::new(child_wt).exists(), "Child worktree should exist");
}

// =============================================================================
// Multiple Tasks
// =============================================================================

#[test]
fn test_multiple_tasks_get_separate_worktrees() {
    let ctx = TestEnv::with_git(&test_default_workflow(), &["planner", "worker"]);

    let task1 = ctx.create_task("Task 1", "First task", None);
    let task2 = ctx.create_task("Task 2", "Second task", None);

    // Different branches
    assert_ne!(
        task1.branch_name, task2.branch_name,
        "Tasks should have distinct branch names"
    );

    // Different worktree directories
    assert_ne!(
        task1.worktree_path, task2.worktree_path,
        "Tasks should have distinct worktree paths"
    );

    // Both should exist on disk
    let wt1 = task1.worktree_path.as_ref().unwrap();
    let wt2 = task2.worktree_path.as_ref().unwrap();
    assert!(Path::new(wt1).exists(), "Task 1 worktree should exist");
    assert!(Path::new(wt2).exists(), "Task 2 worktree should exist");
}

// =============================================================================
// Title Generation Fallback
// =============================================================================

#[test]
fn test_empty_title_fallback() {
    let ctx = TestEnv::with_git_title_fail(&test_default_workflow(), &["planner", "worker"]);

    // Empty title + description — mock title gen fails, should fall back to description
    let task = ctx.create_task("", "Fix the login bug on the dashboard", None);

    assert_eq!(
        task.title, "Fix the login bug on the dashboard",
        "Title should fall back to description when title generation fails"
    );
}

// =============================================================================
// Base Branch Sync During Setup
// =============================================================================

/// Verify that `sync_base_branch()` is called during task setup with the correct branch.
#[test]
fn test_task_setup_syncs_base_branch() {
    let ctx = TestEnv::with_mock_git(&test_default_workflow(), &["planner", "worker"]);

    // Create a task with base_branch = "main"
    let task = ctx.create_task(
        "Test sync",
        "Verify sync is called during setup",
        Some("main"),
    );

    // Verify sync was called with "main"
    let sync_calls = ctx.mock_git_service().get_sync_base_branch_calls();
    assert!(
        sync_calls.contains(&"main".to_string()),
        "sync_base_branch should be called with 'main', got: {sync_calls:?}"
    );

    // Verify task setup succeeded
    assert_eq!(
        task.phase,
        Phase::Idle,
        "Task should be in Idle phase after setup"
    );
}

/// Verify that sync failure logs warning but doesn't block task creation.
#[test]
fn test_task_setup_continues_on_sync_failure() {
    let ctx = TestEnv::with_mock_git(&test_default_workflow(), &["planner", "worker"]);

    // Configure mock to fail sync
    ctx.mock_git_service()
        .set_next_sync_result(Err(GitError::Other("Network error".to_string())));

    // Create a task - should succeed despite sync failure
    let task = ctx.create_task(
        "Test sync failure",
        "Should not block on sync error",
        Some("main"),
    );

    // Verify task setup still succeeded despite sync failure
    assert_eq!(
        task.phase,
        Phase::Idle,
        "Task should be in Idle phase despite sync failure"
    );
    assert!(
        !task.is_failed(),
        "Task should not be Failed despite sync failure"
    );
}

/// Verify that subtask branches (task/*) skip sync.
#[test]
fn test_subtask_setup_skips_sync() {
    let ctx = TestEnv::with_mock_git(&test_default_workflow(), &["planner", "worker"]);

    // Create a parent task first
    let parent = ctx.create_task("Parent", "Parent task", Some("main"));
    let parent_id = parent.id.clone();

    // Clear sync calls to track only subtask setup
    // The parent setup already called sync for "main"
    let initial_sync_calls = ctx.mock_git_service().get_sync_base_branch_calls();
    assert!(
        initial_sync_calls.contains(&"main".to_string()),
        "Parent setup should have synced 'main'"
    );

    // Create a subtask - its base_branch will be the parent's branch (task/*)
    let subtask = ctx.create_subtask(&parent_id, "Subtask", "Should skip sync");

    // Verify subtask base_branch is task/* pattern
    assert!(
        subtask.base_branch.starts_with("task/"),
        "Subtask base_branch should be task/*, got: {}",
        subtask.base_branch
    );

    // Since subtask base_branch starts with "task/", sync should have been skipped
    // We can verify by checking that no additional sync calls were made for task/* branches
    let sync_calls = ctx.mock_git_service().get_sync_base_branch_calls();
    let task_branch_syncs: Vec<_> = sync_calls
        .iter()
        .filter(|b| b.starts_with("task/"))
        .collect();
    assert!(
        task_branch_syncs.is_empty(),
        "Should not sync task/* branches, found: {task_branch_syncs:?}"
    );
}

/// Verify sync is called with custom base branch (not just "main").
#[test]
fn test_task_setup_syncs_custom_base_branch() {
    let ctx = TestEnv::with_mock_git(&test_default_workflow(), &["planner", "worker"]);

    // Create a task with a custom base branch
    let task = ctx.create_task("Feature task", "Based on feature branch", Some("feature"));

    // Verify sync was called with the custom branch
    let sync_calls = ctx.mock_git_service().get_sync_base_branch_calls();
    assert!(
        sync_calls.contains(&"feature".to_string()),
        "sync_base_branch should be called with 'feature', got: {sync_calls:?}"
    );

    // Verify task setup succeeded
    assert_eq!(
        task.phase,
        Phase::Idle,
        "Task should be in Idle phase after setup"
    );
}
