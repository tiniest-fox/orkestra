//! End-to-end workflow tests with mocked Claude Code.
//!
//! These tests verify the complete task lifecycle:
//! - Task creation with git worktree
//! - Planning phase
//! - Working phase
//! - Review phase
//! - Completion with automatic merge back to primary branch

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
// Full Workflow Tests
// =============================================================================

#[test]
fn test_full_workflow_with_successful_merge() {
    // Setup using convenience function
    let (orchestrator, _temp_dir) =
        create_test_orchestrator().expect("Failed to create test orchestrator");

    // Step 1: Create task with worktree
    let task = orchestrator
        .create_task_with_worktree("Implement feature X", "Add the new feature X to the codebase")
        .expect("Failed to create task");

    assert_eq!(task.id, "TASK-001");
    assert_eq!(task.status, TaskStatus::Planning);
    assert!(task.branch_name.is_some());
    assert!(task.worktree_path.is_some());

    // Verify worktree was created
    let worktree_path = task.worktree_path.as_ref().unwrap();
    assert!(Path::new(worktree_path).exists());
    assert_eq!(task.branch_name.as_ref().unwrap(), "task/TASK-001");

    // Step 2: Planner completes planning
    let task = orchestrator
        .simulate_planner_complete(&task.id, "1. Create module\n2. Add tests\n3. Update docs")
        .expect("Failed to set plan");

    assert_eq!(task.status, TaskStatus::Planning);
    assert!(task.plan.is_some());

    // Step 3: Plan approved, move to Working
    let task = orchestrator
        .task_service
        .approve_plan(&task.id)
        .expect("Failed to approve plan");

    assert_eq!(task.status, TaskStatus::Working);

    // Step 4: Worker completes work (makes changes in worktree)
    let task = orchestrator
        .simulate_worker_complete(&task.id, "Implemented feature X with tests")
        .expect("Failed to complete work");

    assert_eq!(task.status, TaskStatus::Working);
    assert!(task.summary.is_some());

    // Verify changes were committed in worktree
    let worktree_path = task.worktree_path.as_ref().unwrap();
    assert!(Path::new(worktree_path).join("changes.txt").exists());

    // Step 5: Approve review and integrate (merge back to main)
    let task = orchestrator
        .complete_and_integrate(&task.id)
        .expect("Failed to complete and integrate");

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
        .create_task_with_worktree("Feature causing conflict", "This will conflict")
        .expect("Failed to create task");

    // Complete planning phase
    orchestrator
        .simulate_planner_complete(&task.id, "Make conflicting changes")
        .unwrap();
    orchestrator.task_service.approve_plan(&task.id).unwrap();

    // Make conflicting change on main BEFORE worker completes
    std::fs::write(
        orchestrator.project_root.join("conflict.txt"),
        "Main branch content\n",
    )
    .expect("Failed to write on main");

    Command::new("git")
        .args(["add", "conflict.txt"])
        .current_dir(&orchestrator.project_root)
        .output()
        .unwrap();

    Command::new("git")
        .args(["commit", "-m", "Change on main"])
        .current_dir(&orchestrator.project_root)
        .output()
        .unwrap();

    // Worker makes conflicting change in worktree
    let worktree_path = task.worktree_path.as_ref().unwrap();
    std::fs::write(
        Path::new(worktree_path).join("conflict.txt"),
        "Worktree branch content\n",
    )
    .expect("Failed to write in worktree");

    Command::new("git")
        .args(["add", "conflict.txt"])
        .current_dir(worktree_path)
        .output()
        .unwrap();

    Command::new("git")
        .args(["commit", "-m", "Conflicting change in worktree"])
        .current_dir(worktree_path)
        .output()
        .unwrap();

    // Complete work
    orchestrator
        .task_service
        .complete(&task.id, "Made changes")
        .unwrap();

    // Try to integrate - should detect conflict and reopen task
    let task = orchestrator
        .complete_and_integrate(&task.id)
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
        .create_task_with_worktree("Parent task", "Parent description")
        .expect("Failed to create parent task");

    // Create child task (simulating what breakdown would do)
    let child = orchestrator
        .task_service
        .create("Child task", "Child description", false)
        .unwrap();

    // Set child's parent_id and inherit worktree
    orchestrator
        .task_service
        .update(&child.id, |t| {
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
        .task_service
        .complete(&child.id, "Child work done")
        .unwrap();

    // Integration should be skipped for child
    let child = orchestrator
        .complete_and_integrate(&child.id)
        .expect("Failed to complete child");

    assert_eq!(child.status, TaskStatus::Done);
    match &child.integration_result {
        Some(IntegrationResult::Skipped { reason }) => {
            assert!(
                reason.contains("Not a root task"),
                "Should skip because it's a child task"
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
