//! End-to-end workflow tests using realistic code paths.
//!
//! These tests verify the complete task lifecycle using the exact same code paths
//! as production:
//! - UI actions (Tauri) → `tasks::` module functions
//! - Agent actions (Claude Code) → actual CLI binary execution
//!
//! Key test scenarios:
//! - Task creation with git worktree
//! - Planning phase (agent sets plan via CLI, user approves via tasks::)
//! - Working phase (agent makes changes, completes via CLI)
//! - Review phase (UI starts review, reviewer agent approves via CLI)
//! - Completion with automatic merge back to primary branch
//! - Merge conflict detection and task reopening

use orkestra_core::{
    domain::{IntegrationResult, TaskStatus},
    tasks,
    testutil::{create_orkestra_dirs, create_temp_git_repo, create_test_orchestrator},
};
use std::path::Path;
use std::process::Command;

// =============================================================================
// Full Workflow Tests (realistic code paths)
// =============================================================================

#[test]
fn test_full_workflow_with_successful_merge() {
    // Setup test orchestrator with temp git repo
    let (orchestrator, _temp_dir) =
        create_test_orchestrator().expect("Failed to create test orchestrator");

    // Step 1: UI creates task (what Tauri does)
    let task = tasks::create_task(
        &orchestrator.project,
        "Implement feature X",
        "Add the new feature X to the codebase",
    )
    .expect("Failed to create task");

    assert_eq!(task.id, "TASK-001");
    assert_eq!(task.status, TaskStatus::Planning);
    assert!(task.branch_name.is_some());
    assert!(task.worktree_path.is_some());

    // Verify worktree was created
    let worktree_path = task.worktree_path.as_ref().unwrap();
    assert!(Path::new(worktree_path).exists());
    assert_eq!(task.branch_name.as_ref().unwrap(), "task/TASK-001");

    // Set skip_breakdown for simpler flow
    orchestrator
        .project
        .store()
        .update_field(&task.id, "skip_breakdown", Some("1"))
        .unwrap();

    // Step 2: Agent (Claude Code) sets plan via CLI from worktree
    orchestrator
        .run_cli_in_worktree(
            &task.id,
            &[
                "task",
                "set-plan",
                &task.id,
                "--plan",
                "1. Create module\n2. Add tests\n3. Update docs",
            ],
        )
        .expect("Agent should be able to set plan via CLI");

    // Reload task to see plan
    let task = tasks::get_task(&orchestrator.project, &task.id)
        .unwrap()
        .unwrap();
    assert!(task.plan.is_some());

    // Step 3: UI approves plan (what Tauri does)
    let task = tasks::approve_task_plan(&orchestrator.project, &task.id)
        .expect("Failed to approve plan");
    assert_eq!(task.status, TaskStatus::Working);

    // Step 4: Agent (Claude Code) makes changes in worktree
    let feature_content =
        "pub fn feature_x() -> &'static str {\n    \"Hello from feature X!\"\n}\n";
    orchestrator
        .simulate_worker_file_change(&task.id, "feature_x.rs", feature_content)
        .expect("Failed to simulate worker changes");

    // Verify file was created in worktree
    let worktree_path = task.worktree_path.as_ref().unwrap();
    assert!(Path::new(worktree_path).join("feature_x.rs").exists());

    // Step 5: Agent (Claude Code) completes task via CLI
    orchestrator
        .run_cli_in_worktree(
            &task.id,
            &[
                "task",
                "complete",
                &task.id,
                "--summary",
                "Implemented feature X with tests",
            ],
        )
        .expect("Agent should be able to complete task via CLI");

    // Reload task to verify summary
    let task = tasks::get_task(&orchestrator.project, &task.id)
        .unwrap()
        .unwrap();
    assert!(task.summary.is_some());
    assert_eq!(task.status, TaskStatus::Working); // Still working, waiting for review

    // Step 6: UI starts automated review (what Tauri does)
    // This transitions to Reviewing status and would spawn reviewer agent
    let task = tasks::start_automated_review(&orchestrator.project, &task.id)
        .expect("Failed to start automated review");
    assert_eq!(task.status, TaskStatus::Reviewing);

    // Step 7: Reviewer agent approves via CLI (what reviewer Claude Code does)
    orchestrator
        .run_cli_in_worktree(&task.id, &["task", "approve-review", &task.id])
        .expect("Reviewer should be able to approve via CLI");

    // Reload task to verify final state
    let task = tasks::get_task(&orchestrator.project, &task.id);
    // Task should be deleted after successful merge, so it won't be found
    assert!(
        task.unwrap().is_none(),
        "Task should be deleted after successful merge"
    );

    // Verify worktree was cleaned up
    assert!(!Path::new(worktree_path).exists());

    // Verify changes are now in main branch with correct content
    let feature_file = orchestrator.project_root.join("feature_x.rs");
    assert!(
        feature_file.exists(),
        "feature_x.rs should be merged to main"
    );

    let content = std::fs::read_to_string(&feature_file).expect("Failed to read merged file");
    assert!(
        content.contains("Hello from feature X!"),
        "File content should match what worker created"
    );
}

#[test]
fn test_workflow_with_merge_conflict() {
    let (orchestrator, _temp_dir) =
        create_test_orchestrator().expect("Failed to create test orchestrator");

    // UI creates task
    let task = tasks::create_task(
        &orchestrator.project,
        "Feature causing conflict",
        "This will conflict",
    )
    .expect("Failed to create task");

    // Set skip_breakdown
    orchestrator
        .project
        .store()
        .update_field(&task.id, "skip_breakdown", Some("1"))
        .unwrap();

    // Agent sets plan via CLI
    orchestrator
        .run_cli_in_worktree(
            &task.id,
            &[
                "task",
                "set-plan",
                &task.id,
                "--plan",
                "Make conflicting changes",
            ],
        )
        .unwrap();

    // UI approves plan
    tasks::approve_task_plan(&orchestrator.project, &task.id).unwrap();

    // Make conflicting change on main BEFORE worker completes
    orchestrator
        .make_main_branch_changes("conflict.txt", "Main branch content\n", "Change on main")
        .expect("Failed to make changes on main");

    // Agent makes conflicting change in worktree
    orchestrator
        .simulate_worker_file_change(&task.id, "conflict.txt", "Worktree branch content\n")
        .expect("Failed to simulate worker file change");

    // Agent completes task via CLI
    orchestrator
        .run_cli_in_worktree(
            &task.id,
            &["task", "complete", &task.id, "--summary", "Made changes"],
        )
        .unwrap();

    // UI starts automated review
    tasks::start_automated_review(&orchestrator.project, &task.id).unwrap();

    // Reviewer agent tries to approve - should detect conflict and reopen task
    orchestrator
        .run_cli_in_worktree(&task.id, &["task", "approve-review", &task.id])
        .expect("CLI should succeed even with conflict (it reopens the task)");

    // Reload task to check state
    let task = tasks::get_task(&orchestrator.project, &task.id)
        .unwrap()
        .expect("Task should still exist after conflict");

    // Task should be reopened (back to Working)
    assert_eq!(
        task.status,
        TaskStatus::Working,
        "Task should be reopened due to conflict"
    );

    // Verify conflict was recorded
    match &task.integration_result {
        Some(IntegrationResult::Conflict { conflict_files }) => {
            assert!(
                conflict_files.contains(&"conflict.txt".to_string()),
                "Should identify conflict.txt as conflicting"
            );
        }
        other => panic!("Expected Conflict result, got {:?}", other),
    }

    // Worktree should still exist for conflict resolution
    let worktree_path = task.worktree_path.as_ref().unwrap();
    assert!(
        Path::new(worktree_path).exists(),
        "Worktree should be preserved for conflict resolution"
    );
}

#[test]
fn test_child_task_skips_integration() {
    let (orchestrator, _temp_dir) =
        create_test_orchestrator().expect("Failed to create test orchestrator");

    // UI creates parent task
    let parent = tasks::create_task(&orchestrator.project, "Parent task", "Parent description")
        .expect("Failed to create parent task");

    // Set skip_breakdown on parent
    orchestrator
        .project
        .store()
        .update_field(&parent.id, "skip_breakdown", Some("1"))
        .unwrap();

    // Agent sets plan and UI approves
    orchestrator
        .run_cli_in_worktree(
            &parent.id,
            &["task", "set-plan", &parent.id, "--plan", "Do stuff"],
        )
        .unwrap();
    tasks::approve_task_plan(&orchestrator.project, &parent.id).unwrap();

    // Simulate creating a child task (normally done by breakdown agent)
    // We'll manually set up a child task that shares the parent's worktree
    let child =
        tasks::create_task(&orchestrator.project, "Child task", "Child description").unwrap();

    // Make it a child of parent (inherit worktree)
    let store = orchestrator.project.store();
    store
        .update_field(&child.id, "parent_id", Some(&parent.id))
        .unwrap();
    store
        .update_field(&child.id, "branch_name", parent.branch_name.as_deref())
        .unwrap();
    store
        .update_field(&child.id, "worktree_path", parent.worktree_path.as_deref())
        .unwrap();
    store
        .update_status(&child.id, TaskStatus::Working)
        .unwrap();
    store
        .update_field(&child.id, "skip_breakdown", Some("1"))
        .unwrap();

    // Child agent completes task
    orchestrator
        .run_cli_in_worktree(
            &parent.id, // Run from parent's worktree
            &["task", "complete", &child.id, "--summary", "Child work done"],
        )
        .unwrap();

    // UI starts automated review for child
    tasks::start_automated_review(&orchestrator.project, &child.id).unwrap();

    // Reviewer agent approves child - integration should be skipped for child
    orchestrator
        .run_cli_in_worktree(&parent.id, &["task", "approve-review", &child.id])
        .unwrap();

    // Reload child to check state
    let child = tasks::get_task(&orchestrator.project, &child.id)
        .unwrap()
        .expect("Child task should still exist (not deleted since integration was skipped)");

    assert_eq!(child.status, TaskStatus::Done);
    match &child.integration_result {
        Some(IntegrationResult::Skipped { reason }) => {
            assert!(
                reason.contains("Child task") || reason.contains("parent"),
                "Should skip because it's a child task, got: {}",
                reason
            );
        }
        other => panic!("Expected Skipped result, got {:?}", other),
    }

    // Parent's worktree should still exist
    let parent_worktree = parent.worktree_path.as_ref().unwrap();
    assert!(
        Path::new(parent_worktree).exists(),
        "Parent worktree should still exist"
    );
}

#[test]
fn test_convenience_run_full_workflow() {
    let (orchestrator, _temp_dir) =
        create_test_orchestrator().expect("Failed to create test orchestrator");

    // Use the convenience method that exercises all realistic code paths
    let task = orchestrator
        .run_full_workflow(
            "Quick feature",
            "A simple feature",
            "1. Do X\n2. Do Y",
            "Implementation content",
            "All done!",
        )
        .expect("Full workflow should succeed");

    assert_eq!(task.status, TaskStatus::Done);
    assert!(matches!(
        task.integration_result,
        Some(IntegrationResult::Merged { .. })
    ));

    // Task should be deleted from database after successful merge
    let tasks_list = tasks::load_tasks(&orchestrator.project).unwrap();
    assert!(
        tasks_list.is_empty(),
        "Task should be deleted after successful merge"
    );
}

// =============================================================================
// CLI Integration Tests
// =============================================================================

#[test]
fn test_cli_list_tasks() {
    let (orchestrator, _temp_dir) =
        create_test_orchestrator().expect("Failed to create test orchestrator");

    // Create a task via tasks:: (UI action)
    tasks::create_task(&orchestrator.project, "Test task", "Test description").unwrap();

    // List via CLI (could be UI or agent)
    let output = orchestrator
        .run_cli(&["task", "list"])
        .expect("CLI list should work");

    assert!(output.contains("TASK-001"));
    assert!(output.contains("Test task"));
}

#[test]
fn test_cli_show_task() {
    let (orchestrator, _temp_dir) =
        create_test_orchestrator().expect("Failed to create test orchestrator");

    // Create a task
    let task =
        tasks::create_task(&orchestrator.project, "Show me task", "Detailed description").unwrap();

    // Show via CLI
    let output = orchestrator
        .run_cli(&["task", "show", &task.id])
        .expect("CLI show should work");

    assert!(output.contains("TASK-001"));
    assert!(output.contains("Show me task"));
    assert!(output.contains("Detailed description"));
}

// =============================================================================
// Infrastructure Tests
// =============================================================================

#[test]
fn test_temp_git_repo_creation() {
    let temp_dir = create_temp_git_repo().expect("Failed to create temp repo");

    // Verify it's a git repo
    let git_dir = temp_dir.path().join(".git");
    assert!(git_dir.exists(), ".git directory should exist");

    // Verify main branch exists
    let output = Command::new("git")
        .args(["branch", "--show-current"])
        .current_dir(temp_dir.path())
        .output()
        .unwrap();

    let branch = String::from_utf8_lossy(&output.stdout).trim().to_string();
    assert_eq!(branch, "main", "Should be on main branch");

    // Verify initial commit exists
    let output = Command::new("git")
        .args(["log", "--oneline"])
        .current_dir(temp_dir.path())
        .output()
        .unwrap();

    let log = String::from_utf8_lossy(&output.stdout);
    assert!(log.contains("Initial commit"), "Should have initial commit");
}

#[test]
fn test_orkestra_dirs_creation() {
    let temp_dir = tempfile::TempDir::new().unwrap();
    create_orkestra_dirs(temp_dir.path()).expect("Failed to create orkestra dirs");

    assert!(temp_dir.path().join(".orkestra").exists());
    assert!(temp_dir.path().join(".orkestra/worktrees").exists());
}
