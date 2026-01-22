//! End-to-end workflow tests using real Project code.
//!
//! These tests verify the complete task lifecycle using the actual production
//! code paths in `Project`. The only mocking is for process spawning (Claude Code).
//!
//! Key test scenarios:
//! - Task creation with git worktree
//! - Planning phase (set plan, approve)
//! - Working phase (simulated worker changes)
//! - Completion with automatic merge back to primary branch
//! - Merge conflict detection and task reopening

use orkestra_core::{
    domain::{IntegrationResult, TaskStatus},
    ports::{ProcessSpawner, SpawnConfig},
    testutil::{
        create_orkestra_dirs, create_temp_git_repo, create_test_orchestrator, MockProcessSpawner,
        MockStore,
    },
};
use std::path::{Path, PathBuf};
use std::process::Command;

// =============================================================================
// Full Workflow Tests (using real Project code)
// =============================================================================

#[test]
fn test_full_workflow_with_successful_merge() {
    // Setup using convenience function - creates temp git repo with real Project
    let (orchestrator, _temp_dir) =
        create_test_orchestrator().expect("Failed to create test orchestrator");

    // Step 1: Create task (uses real Project::create_task which creates worktree)
    let task = orchestrator
        .project
        .create_task("Implement feature X", "Add the new feature X to the codebase")
        .expect("Failed to create task");

    assert_eq!(task.id, "TASK-001");
    assert_eq!(task.status, TaskStatus::Planning);
    assert!(task.branch_name.is_some());
    assert!(task.worktree_path.is_some());

    // Verify worktree was created
    let worktree_path = task.worktree_path.as_ref().unwrap();
    assert!(Path::new(worktree_path).exists());
    assert_eq!(task.branch_name.as_ref().unwrap(), "task/TASK-001");

    // Skip breakdown for this test
    orchestrator
        .project
        .update_task(&task.id, |t| {
            t.skip_breakdown = true;
            Ok(())
        })
        .unwrap();

    // Step 2: Planner completes planning (uses real Project::set_plan)
    let task = orchestrator
        .project
        .set_plan(&task.id, "1. Create module\n2. Add tests\n3. Update docs")
        .expect("Failed to set plan");

    assert_eq!(task.status, TaskStatus::Planning);
    assert!(task.plan.is_some());

    // Step 3: Plan approved (uses real Project::approve_plan)
    let task = orchestrator
        .project
        .approve_plan(&task.id)
        .expect("Failed to approve plan");

    assert_eq!(task.status, TaskStatus::Working);

    // Step 4: Worker makes changes in worktree (simulated)
    orchestrator
        .simulate_worker_changes(&task.id, "Implemented feature X with tests")
        .expect("Failed to simulate worker changes");

    // Verify changes were committed in worktree
    let worktree_path = task.worktree_path.as_ref().unwrap();
    assert!(Path::new(worktree_path).join("changes.txt").exists());

    // Step 5: Complete work (uses real Project::complete_task)
    let task = orchestrator
        .project
        .complete_task(&task.id, "Implemented feature X with tests")
        .expect("Failed to complete work");

    assert_eq!(task.status, TaskStatus::Working);
    assert!(task.summary.is_some());

    // Step 6: Approve review and integrate (uses real Project::approve_review)
    let task = orchestrator
        .project
        .approve_review(&task.id)
        .expect("Failed to approve review");

    assert_eq!(task.status, TaskStatus::Done);

    // Verify integration result
    match &task.integration_result {
        Some(IntegrationResult::Merged {
            target_branch,
            commit_sha,
            ..
        }) => {
            assert_eq!(target_branch, "main");
            assert!(!commit_sha.is_empty());
        }
        other => panic!("Expected Merged result, got {:?}", other),
    }

    // Verify worktree was cleaned up
    assert!(!Path::new(worktree_path).exists());

    // Verify changes are now in main branch
    let changes_in_main = orchestrator.project_root.join("changes.txt");
    assert!(changes_in_main.exists(), "Changes should be merged to main");
}

#[test]
fn test_workflow_with_merge_conflict() {
    let (orchestrator, _temp_dir) =
        create_test_orchestrator().expect("Failed to create test orchestrator");

    // Create task with worktree
    let task = orchestrator
        .project
        .create_task("Feature causing conflict", "This will conflict")
        .expect("Failed to create task");

    // Skip breakdown
    orchestrator
        .project
        .update_task(&task.id, |t| {
            t.skip_breakdown = true;
            Ok(())
        })
        .unwrap();

    // Complete planning phase
    orchestrator
        .project
        .set_plan(&task.id, "Make conflicting changes")
        .unwrap();
    orchestrator.project.approve_plan(&task.id).unwrap();

    // Make conflicting change on main BEFORE worker completes
    orchestrator
        .make_main_branch_changes("conflict.txt", "Main branch content\n", "Change on main")
        .expect("Failed to make changes on main");

    // Worker makes conflicting change in worktree
    orchestrator
        .simulate_worker_file_change(
            &task.id,
            "conflict.txt",
            "Worktree branch content\n",
            "Conflicting change in worktree",
        )
        .expect("Failed to simulate worker file change");

    // Complete work
    orchestrator
        .project
        .complete_task(&task.id, "Made changes")
        .unwrap();

    // Try to integrate - should detect conflict and reopen task
    let task = orchestrator
        .project
        .approve_review(&task.id)
        .expect("Failed to handle integration");

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

    // Create parent task
    let parent = orchestrator
        .project
        .create_task("Parent task", "Parent description")
        .expect("Failed to create parent task");

    // Skip breakdown on parent
    orchestrator
        .project
        .update_task(&parent.id, |t| {
            t.skip_breakdown = true;
            Ok(())
        })
        .unwrap();

    // Create child task (simulating what breakdown would do)
    let child = orchestrator
        .project
        .create_task("Child task", "Child description")
        .unwrap();

    // Set child's parent_id and inherit worktree (simulating breakdown)
    orchestrator
        .project
        .update_task(&child.id, |t| {
            t.parent_id = Some(parent.id.clone());
            t.branch_name = parent.branch_name.clone();
            t.worktree_path = parent.worktree_path.clone();
            t.status = TaskStatus::Working;
            t.skip_breakdown = true;
            Ok(())
        })
        .unwrap();

    // Complete the child task
    orchestrator
        .project
        .complete_task(&child.id, "Child work done")
        .unwrap();

    // Integration should be skipped for child
    let child = orchestrator
        .project
        .approve_review(&child.id)
        .expect("Failed to complete child");

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

    // Use the convenience method to run the entire workflow
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
}

// =============================================================================
// Mock Infrastructure Tests
// =============================================================================

#[test]
fn test_mock_spawner_records_calls() {
    let spawner = MockProcessSpawner::new();

    // Simulate spawning a process
    let config = SpawnConfig {
        args: &["--print", "--output-format", "stream-json"],
        cwd: Path::new("/tmp/test"),
        stdin_content: "Test prompt content",
    };

    let result = spawner
        .spawn(config, Box::new(|| {}))
        .expect("Spawn should succeed");

    assert!(result.pid >= 1000);
    assert!(result.session_id.is_some());
    assert!(spawner.is_running(result.pid));

    // Verify the call was recorded
    let calls = spawner.get_spawn_calls();
    assert_eq!(calls.len(), 1);
    assert_eq!(calls[0].prompt, "Test prompt content");
    assert_eq!(calls[0].cwd, PathBuf::from("/tmp/test"));
    assert!(!calls[0].is_resume);

    // Mark process as finished
    spawner.finish_process(result.pid);
    assert!(!spawner.is_running(result.pid));
}

#[test]
fn test_mock_store_basic_operations() {
    use orkestra_core::ports::TaskStore;

    let store = MockStore::new();

    // Generate IDs
    assert_eq!(store.next_id().unwrap(), "TASK-001");
    assert_eq!(store.next_id().unwrap(), "TASK-002");

    // Initially empty
    assert!(store.load_all().unwrap().is_empty());
    assert!(store.find_by_id("TASK-001").unwrap().is_none());
}

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
    assert!(
        log.contains("Initial commit"),
        "Should have initial commit"
    );
}

#[test]
fn test_orkestra_dirs_creation() {
    let temp_dir = tempfile::TempDir::new().unwrap();
    create_orkestra_dirs(temp_dir.path()).expect("Failed to create orkestra dirs");

    assert!(temp_dir.path().join(".orkestra").exists());
    assert!(temp_dir.path().join(".orkestra/worktrees").exists());
}
