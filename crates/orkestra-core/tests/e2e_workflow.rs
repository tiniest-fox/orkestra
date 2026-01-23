//! End-to-end workflow tests using realistic code paths.
//!
//! These tests verify the complete task lifecycle using the exact same code paths
//! as production:
//! - UI actions (Tauri) → `tasks::` module functions
//! - Agent actions (Claude Code) → actual CLI binary execution
//!
//! Key test scenarios:
//! - Task creation with git worktree
//! - Planning phase (agent sets plan via CLI, user approves via `tasks::`)
//! - Working phase (agent makes changes, completes via CLI)
//! - Review phase (UI starts review, reviewer agent approves via CLI)
//! - Completion with automatic merge back to primary branch
//! - Merge conflict detection and task reopening

use orkestra_core::{
    domain::{LoopOutcome, TaskStatus},
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

    // ID should be a petname (hyphenated lowercase words)
    assert!(task.id.contains('-'), "ID should be a petname: {}", task.id);
    assert_eq!(task.status, TaskStatus::Planning);
    assert!(task.branch_name.is_some());
    assert!(task.worktree_path.is_some());

    // Verify worktree was created
    let worktree_path = task.worktree_path.as_ref().unwrap();
    assert!(Path::new(worktree_path).exists());
    // Branch name should be "task/{id}"
    let expected_branch = format!("task/{}", task.id);
    assert_eq!(task.branch_name.as_ref().unwrap(), &expected_branch);

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
    let task =
        tasks::approve_task_plan(&orchestrator.project, &task.id).expect("Failed to approve plan");
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
    // This now just sets status to Done
    orchestrator
        .run_cli_in_worktree(&task.id, &["task", "approve-review", &task.id])
        .expect("Reviewer should be able to approve via CLI");

    // Task should now be in Done status, waiting for orchestrator to integrate
    let task = tasks::get_task(&orchestrator.project, &task.id)
        .unwrap()
        .expect("Task should exist in Done status");
    assert_eq!(task.status, TaskStatus::Done);

    // Step 8: Orchestrator integrates the done task (merge branch, cleanup, delete from DB)
    tasks::integrate_done_task(&orchestrator.project, &task.id)
        .expect("Integration should succeed");

    // Task should be deleted after successful merge
    let task = tasks::get_task(&orchestrator.project, &task.id);
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

    // Reviewer agent approves - this now just sets status to Done
    orchestrator
        .run_cli_in_worktree(&task.id, &["task", "approve-review", &task.id])
        .expect("CLI should succeed");

    // Task should be in Done status
    let task = tasks::get_task(&orchestrator.project, &task.id)
        .unwrap()
        .expect("Task should exist in Done status");
    assert_eq!(task.status, TaskStatus::Done);

    // Orchestrator tries to integrate - should detect conflict and reopen task
    tasks::integrate_done_task(&orchestrator.project, &task.id)
        .expect("Integration should handle conflict gracefully");

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

    // Verify conflict was recorded in the previous loop's outcome
    let loops = orchestrator
        .project
        .store()
        .get_loops(&task.id)
        .expect("Should get loops");

    // Find the most recent completed loop (should have IntegrationFailed outcome)
    let completed_loop = loops.iter().rev().find(|l| l.outcome.is_some());
    match completed_loop.and_then(|l| l.outcome.as_ref()) {
        Some(LoopOutcome::IntegrationFailed { conflict_files, .. }) => {
            let files = conflict_files.as_ref().expect("Should have conflict files");
            assert!(
                files.contains(&"conflict.txt".to_string()),
                "Should identify conflict.txt as conflicting"
            );
        }
        other => panic!("Expected IntegrationFailed outcome, got {other:?}"),
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
    store.update_status(&child.id, TaskStatus::Working).unwrap();
    store
        .update_field(&child.id, "skip_breakdown", Some("1"))
        .unwrap();

    // Child agent completes task
    orchestrator
        .run_cli_in_worktree(
            &parent.id, // Run from parent's worktree
            &[
                "task",
                "complete",
                &child.id,
                "--summary",
                "Child work done",
            ],
        )
        .unwrap();

    // UI starts automated review for child
    tasks::start_automated_review(&orchestrator.project, &child.id).unwrap();

    // Reviewer agent approves child - this now just sets status to Done
    orchestrator
        .run_cli_in_worktree(&parent.id, &["task", "approve-review", &child.id])
        .unwrap();

    // Child should be in Done status
    let child = tasks::get_task(&orchestrator.project, &child.id)
        .unwrap()
        .expect("Child task should exist in Done status");
    assert_eq!(child.status, TaskStatus::Done);

    // Orchestrator integrates - should skip because it's a child task, then delete
    tasks::integrate_done_task(&orchestrator.project, &child.id).unwrap();

    // Child task should be deleted (integration was skipped but task is cleaned up)
    let child = tasks::get_task(&orchestrator.project, &child.id).unwrap();
    assert!(
        child.is_none(),
        "Child task should be deleted after integration (even when skipped)"
    );

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
    // Note: integration_result is now tracked in WorkLoop outcomes
    // The success of the merge is confirmed by the task being deleted below

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
    let task = tasks::create_task(&orchestrator.project, "Test task", "Test description").unwrap();

    // List via CLI (could be UI or agent)
    let output = orchestrator
        .run_cli(&["task", "list"])
        .expect("CLI list should work");

    assert!(output.contains(&task.id), "Output should contain task ID");
    assert!(output.contains("Test task"));
}

#[test]
fn test_cli_show_task() {
    let (orchestrator, _temp_dir) =
        create_test_orchestrator().expect("Failed to create test orchestrator");

    // Create a task
    let task = tasks::create_task(
        &orchestrator.project,
        "Show me task",
        "Detailed description",
    )
    .unwrap();

    // Show via CLI
    let output = orchestrator
        .run_cli(&["task", "show", &task.id])
        .expect("CLI show should work");

    assert!(output.contains(&task.id), "Output should contain task ID");
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

// =============================================================================
// WorkLoop Tests
// =============================================================================

#[test]
fn test_loop_created_on_task_creation() {
    let (orchestrator, _temp_dir) =
        create_test_orchestrator().expect("Failed to create test orchestrator");

    // Create a task
    let task = tasks::create_task(&orchestrator.project, "Test task", "Description")
        .expect("Failed to create task");

    // Verify Loop 1 was created
    let loops = orchestrator
        .project
        .store()
        .get_loops(&task.id)
        .expect("Should get loops");

    assert_eq!(loops.len(), 1, "Should have exactly one loop");
    assert_eq!(loops[0].loop_number, 1, "First loop should be number 1");
    assert_eq!(
        loops[0].started_from,
        TaskStatus::Planning,
        "Loop should start from Planning"
    );
    assert!(
        loops[0].outcome.is_none(),
        "Loop should be active (no outcome)"
    );
    assert!(loops[0].ended_at.is_none(), "Loop should not have ended");
}

#[test]
fn test_plan_rejection_creates_new_loop() {
    let (orchestrator, _temp_dir) =
        create_test_orchestrator().expect("Failed to create test orchestrator");

    // Create task
    let task = tasks::create_task(&orchestrator.project, "Test task", "Description")
        .expect("Failed to create task");

    // Agent sets plan
    orchestrator
        .run_cli_in_worktree(
            &task.id,
            &["task", "set-plan", &task.id, "--plan", "Initial plan"],
        )
        .expect("Should set plan");

    // Verify still on Loop 1
    let loops = orchestrator.project.store().get_loops(&task.id).unwrap();
    assert_eq!(loops.len(), 1);

    // UI rejects the plan
    tasks::request_plan_changes(&orchestrator.project, &task.id, "Need more detail")
        .expect("Should request changes");

    // Verify Loop 1 ended with PlanRejected, and Loop 2 started
    let loops = orchestrator.project.store().get_loops(&task.id).unwrap();
    assert_eq!(loops.len(), 2, "Should have two loops after rejection");

    // Check Loop 1
    assert_eq!(loops[0].loop_number, 1);
    assert!(loops[0].ended_at.is_some(), "Loop 1 should have ended");
    match &loops[0].outcome {
        Some(LoopOutcome::PlanRejected { feedback }) => {
            assert_eq!(feedback, "Need more detail");
        }
        other => panic!("Expected PlanRejected outcome, got {other:?}"),
    }

    // Check Loop 2
    assert_eq!(loops[1].loop_number, 2);
    assert_eq!(loops[1].started_from, TaskStatus::Planning);
    assert!(loops[1].outcome.is_none(), "Loop 2 should be active");
}

#[test]
fn test_work_rejection_creates_new_loop() {
    let (orchestrator, _temp_dir) =
        create_test_orchestrator().expect("Failed to create test orchestrator");

    // Create task and get to Working status
    let task = tasks::create_task(&orchestrator.project, "Test task", "Description").unwrap();

    orchestrator
        .project
        .store()
        .update_field(&task.id, "skip_breakdown", Some("1"))
        .unwrap();

    orchestrator
        .run_cli_in_worktree(&task.id, &["task", "set-plan", &task.id, "--plan", "Plan"])
        .unwrap();

    tasks::approve_task_plan(&orchestrator.project, &task.id).unwrap();

    // Agent completes work
    orchestrator
        .run_cli_in_worktree(
            &task.id,
            &["task", "complete", &task.id, "--summary", "Done"],
        )
        .unwrap();

    // Verify still on Loop 1
    let loops = orchestrator.project.store().get_loops(&task.id).unwrap();
    assert_eq!(loops.len(), 1);

    // UI rejects the work
    tasks::request_review_changes(&orchestrator.project, &task.id, "Fix the tests")
        .expect("Should request changes");

    // Verify Loop 1 ended with WorkRejected, and Loop 2 started
    let loops = orchestrator.project.store().get_loops(&task.id).unwrap();
    assert_eq!(loops.len(), 2, "Should have two loops after work rejection");

    // Check Loop 1 outcome
    match &loops[0].outcome {
        Some(LoopOutcome::WorkRejected { feedback }) => {
            assert_eq!(feedback, "Fix the tests");
        }
        other => panic!("Expected WorkRejected outcome, got {other:?}"),
    }

    // Check Loop 2 started from Working
    assert_eq!(loops[1].loop_number, 2);
    assert_eq!(loops[1].started_from, TaskStatus::Working);
    assert!(loops[1].outcome.is_none());
}

#[test]
fn test_reviewer_rejection_creates_new_loop() {
    let (orchestrator, _temp_dir) =
        create_test_orchestrator().expect("Failed to create test orchestrator");

    // Create task and get to Reviewing status
    let task = tasks::create_task(&orchestrator.project, "Test task", "Description").unwrap();

    orchestrator
        .project
        .store()
        .update_field(&task.id, "skip_breakdown", Some("1"))
        .unwrap();

    orchestrator
        .run_cli_in_worktree(&task.id, &["task", "set-plan", &task.id, "--plan", "Plan"])
        .unwrap();

    tasks::approve_task_plan(&orchestrator.project, &task.id).unwrap();

    orchestrator
        .run_cli_in_worktree(
            &task.id,
            &["task", "complete", &task.id, "--summary", "Done"],
        )
        .unwrap();

    // Start automated review
    tasks::start_automated_review(&orchestrator.project, &task.id).unwrap();

    // Verify still on Loop 1
    let loops = orchestrator.project.store().get_loops(&task.id).unwrap();
    assert_eq!(loops.len(), 1);

    // Reviewer agent rejects via CLI
    orchestrator
        .run_cli_in_worktree(
            &task.id,
            &[
                "task",
                "reject-review",
                &task.id,
                "--feedback",
                "Code doesn't follow conventions",
            ],
        )
        .expect("Should reject review");

    // Verify Loop 1 ended with ReviewerRejected, and Loop 2 started
    let loops = orchestrator.project.store().get_loops(&task.id).unwrap();
    assert_eq!(
        loops.len(),
        2,
        "Should have two loops after reviewer rejection"
    );

    // Check Loop 1 outcome
    match &loops[0].outcome {
        Some(LoopOutcome::ReviewerRejected { feedback }) => {
            assert_eq!(feedback, "Code doesn't follow conventions");
        }
        other => panic!("Expected ReviewerRejected outcome, got {other:?}"),
    }

    // Check Loop 2
    assert_eq!(loops[1].loop_number, 2);
    assert_eq!(loops[1].started_from, TaskStatus::Working);
    assert!(loops[1].outcome.is_none());

    // Task should be back in Working status
    let task = tasks::get_task(&orchestrator.project, &task.id)
        .unwrap()
        .unwrap();
    assert_eq!(task.status, TaskStatus::Working);
}

#[test]
fn test_successful_completion_loop_outcome() {
    let (orchestrator, _temp_dir) =
        create_test_orchestrator().expect("Failed to create test orchestrator");

    // Run full workflow
    let task = orchestrator
        .run_full_workflow(
            "Feature task",
            "A feature",
            "1. Do stuff",
            "// code",
            "All done",
        )
        .expect("Full workflow should succeed");

    // Get the task ID before it gets deleted
    let task_id = task.id.clone();

    // Note: After successful merge, the task is deleted from DB
    // But the loops should also be cleaned up
    // Let's verify the task is gone
    let task = tasks::get_task(&orchestrator.project, &task_id).unwrap();
    assert!(
        task.is_none(),
        "Task should be deleted after successful merge"
    );

    // Loops are also deleted when task is deleted (cascade)
    let loops = orchestrator.project.store().get_loops(&task_id).unwrap();
    assert!(
        loops.is_empty(),
        "Loops should be deleted when task is deleted"
    );
}

#[test]
fn test_multiple_rejections_loop_progression() {
    let (orchestrator, _temp_dir) =
        create_test_orchestrator().expect("Failed to create test orchestrator");

    // Create task
    let task = tasks::create_task(&orchestrator.project, "Test task", "Description").unwrap();

    // First plan rejection
    orchestrator
        .run_cli_in_worktree(
            &task.id,
            &["task", "set-plan", &task.id, "--plan", "Plan v1"],
        )
        .unwrap();
    tasks::request_plan_changes(&orchestrator.project, &task.id, "Rejection 1").unwrap();

    // Second plan rejection
    orchestrator
        .run_cli_in_worktree(
            &task.id,
            &["task", "set-plan", &task.id, "--plan", "Plan v2"],
        )
        .unwrap();
    tasks::request_plan_changes(&orchestrator.project, &task.id, "Rejection 2").unwrap();

    // Third plan rejection
    orchestrator
        .run_cli_in_worktree(
            &task.id,
            &["task", "set-plan", &task.id, "--plan", "Plan v3"],
        )
        .unwrap();
    tasks::request_plan_changes(&orchestrator.project, &task.id, "Rejection 3").unwrap();

    // Verify we have 4 loops (1 initial + 3 from rejections)
    let loops = orchestrator.project.store().get_loops(&task.id).unwrap();
    assert_eq!(loops.len(), 4, "Should have 4 loops after 3 rejections");

    // Verify loop numbers progress correctly
    for (i, loop_) in loops.iter().enumerate() {
        assert_eq!(
            loop_.loop_number,
            (i + 1) as u32,
            "Loop {} should have number {}",
            i,
            i + 1
        );
    }

    // Verify first 3 loops ended with PlanRejected
    for i in 0..3 {
        assert!(
            matches!(loops[i].outcome, Some(LoopOutcome::PlanRejected { .. })),
            "Loop {} should have PlanRejected outcome",
            i + 1
        );
        assert!(loops[i].ended_at.is_some());
    }

    // Verify Loop 4 is active
    assert!(loops[3].outcome.is_none(), "Loop 4 should be active");
    assert!(loops[3].ended_at.is_none());
}

#[test]
fn test_feedback_retrieval_from_loops() {
    let (orchestrator, _temp_dir) =
        create_test_orchestrator().expect("Failed to create test orchestrator");

    // Create task and reject plan
    let task = tasks::create_task(&orchestrator.project, "Test task", "Description").unwrap();

    orchestrator
        .run_cli_in_worktree(
            &task.id,
            &["task", "set-plan", &task.id, "--plan", "Bad plan"],
        )
        .unwrap();

    tasks::request_plan_changes(
        &orchestrator.project,
        &task.id,
        "This feedback should be retrievable",
    )
    .unwrap();

    // Retrieve feedback using the helper
    let feedback = orchestrator
        .project
        .store()
        .get_previous_loop_feedback(&task.id)
        .expect("Should get feedback");

    assert_eq!(
        feedback,
        Some("This feedback should be retrievable".to_string()),
        "Should retrieve correct feedback from previous loop"
    );
}

#[test]
fn test_breakdown_rejection_creates_new_loop() {
    let (orchestrator, _temp_dir) =
        create_test_orchestrator().expect("Failed to create test orchestrator");

    // Create task (breakdown enabled by default)
    let task =
        tasks::create_task(&orchestrator.project, "Complex task", "Needs breakdown").unwrap();

    // Set and approve plan
    orchestrator
        .run_cli_in_worktree(
            &task.id,
            &["task", "set-plan", &task.id, "--plan", "Big plan"],
        )
        .unwrap();

    tasks::approve_task_plan(&orchestrator.project, &task.id).unwrap();

    // Set breakdown
    orchestrator
        .run_cli_in_worktree(
            &task.id,
            &[
                "task",
                "set-breakdown",
                &task.id,
                "--breakdown",
                "Split into parts",
            ],
        )
        .unwrap();

    // Verify still on Loop 1
    let loops = orchestrator.project.store().get_loops(&task.id).unwrap();
    assert_eq!(loops.len(), 1);

    // Reject breakdown
    tasks::request_breakdown_changes(&orchestrator.project, &task.id, "Need more subtasks")
        .expect("Should request breakdown changes");

    // Verify new loop created
    let loops = orchestrator.project.store().get_loops(&task.id).unwrap();
    assert_eq!(
        loops.len(),
        2,
        "Should have two loops after breakdown rejection"
    );

    // Check Loop 1 outcome
    match &loops[0].outcome {
        Some(LoopOutcome::BreakdownRejected { feedback }) => {
            assert_eq!(feedback, "Need more subtasks");
        }
        other => panic!("Expected BreakdownRejected outcome, got {other:?}"),
    }

    // Check Loop 2
    assert_eq!(loops[1].loop_number, 2);
    assert_eq!(loops[1].started_from, TaskStatus::BreakingDown);
}
