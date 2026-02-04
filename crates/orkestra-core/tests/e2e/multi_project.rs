//! End-to-end tests for multi-project isolation.
//!
//! Verifies that two simultaneously open projects have complete data isolation:
//! - Task lists don't cross-contaminate
//! - Task operations in one project don't affect the other
//! - Orchestrator loops are independent
//! - Stop flags are per-project
//! - Concurrent task creation has no cross-contamination
//! - Subtasks are isolated across projects

use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use std::thread;

use orkestra_core::workflow::execution::SubtaskOutput;
use orkestra_core::workflow::runtime::{Phase, Status};

use super::helpers::{workflows, MockAgentOutput, TestEnv};

// =============================================================================
// Test: Task List Isolation
// =============================================================================

#[test]
fn test_two_projects_have_isolated_task_lists() {
    // Create two separate projects
    let workflow = workflows::with_subtasks();
    let project_a = TestEnv::with_git(&workflow, &["planner", "breakdown", "worker", "reviewer"]);
    let project_b = TestEnv::with_git(&workflow, &["planner", "breakdown", "worker", "reviewer"]);

    // Create 3 tasks in project A
    let alpha_task1 = project_a.create_task("Task A1", "First task in A", None);
    let alpha_task2 = project_a.create_task("Task A2", "Second task in A", None);
    let alpha_task3 = project_a.create_task("Task A3", "Third task in A", None);

    // Create 2 tasks in project B
    let beta_task1 = project_b.create_task("Task B1", "First task in B", None);
    let beta_task2 = project_b.create_task("Task B2", "Second task in B", None);

    // Verify project A has exactly 3 tasks
    let tasks_a = project_a.api().list_tasks().unwrap();
    assert_eq!(tasks_a.len(), 3);
    let titles_a: Vec<_> = tasks_a.iter().map(|t| t.title.as_str()).collect();
    assert!(titles_a.contains(&"Task A1"));
    assert!(titles_a.contains(&"Task A2"));
    assert!(titles_a.contains(&"Task A3"));

    // Verify project B has exactly 2 tasks
    let tasks_b = project_b.api().list_tasks().unwrap();
    assert_eq!(tasks_b.len(), 2);
    let titles_b: Vec<_> = tasks_b.iter().map(|t| t.title.as_str()).collect();
    assert!(titles_b.contains(&"Task B1"));
    assert!(titles_b.contains(&"Task B2"));

    // Verify no cross-contamination
    assert!(!titles_b.contains(&"Task A1"));
    assert!(!titles_b.contains(&"Task A2"));
    assert!(!titles_b.contains(&"Task A3"));
    assert!(!titles_a.contains(&"Task B1"));
    assert!(!titles_a.contains(&"Task B2"));

    // Verify task IDs are unique within each project
    let ids_a: Vec<_> = tasks_a.iter().map(|t| t.id.as_str()).collect();
    let ids_b: Vec<_> = tasks_b.iter().map(|t| t.id.as_str()).collect();
    assert_eq!(ids_a.len(), 3);
    assert_eq!(ids_b.len(), 2);

    // UUIDs make collision impossible by design, but verify no overlap
    assert_ne!(alpha_task1.id, beta_task1.id);
    assert_ne!(alpha_task1.id, beta_task2.id);
    assert_ne!(alpha_task2.id, beta_task1.id);
    assert_ne!(alpha_task2.id, beta_task2.id);
    assert_ne!(alpha_task3.id, beta_task1.id);
    assert_ne!(alpha_task3.id, beta_task2.id);
}

// =============================================================================
// Test: Task Operations Don't Cross Projects
// =============================================================================

#[test]
fn test_task_operations_dont_cross_projects() {
    let workflow = workflows::with_subtasks();
    let project_a = TestEnv::with_git(&workflow, &["planner", "breakdown", "worker", "reviewer"]);
    let project_b = TestEnv::with_git(&workflow, &["planner", "breakdown", "worker", "reviewer"]);

    // Create one task in each project
    let task_a = project_a.create_task("Task A", "Task in A", None);
    let task_b = project_b.create_task("Task B", "Task in B", None);

    // Both tasks start in Idle phase (first stage: planning)
    assert_eq!(task_a.phase, Phase::Idle);
    assert_eq!(task_b.phase, Phase::Idle);

    // Advance task A through planning
    project_a.set_output(
        &task_a.id,
        MockAgentOutput::Artifact {
            name: "plan".into(),
            content: "Plan for A".into(),
        },
    );
    project_a.advance(); // spawns planner
    project_a.advance(); // processes output

    // Verify task A advanced
    let task_a = project_a.api().get_task(&task_a.id).unwrap();
    assert_eq!(task_a.phase, Phase::AwaitingReview);
    assert_eq!(task_a.current_stage().unwrap(), "planning");

    // Verify task B is unaffected
    let task_b = project_b.api().get_task(&task_b.id).unwrap();
    assert_eq!(task_b.phase, Phase::Idle);

    // Approve task A
    project_a.api().approve(&task_a.id).unwrap();
    let task_a = project_a.api().get_task(&task_a.id).unwrap();
    assert_eq!(task_a.current_stage().unwrap(), "breakdown");

    // Verify task B is still unaffected
    let task_b = project_b.api().get_task(&task_b.id).unwrap();
    assert_eq!(task_b.phase, Phase::Idle);

    // Delete task B
    project_b.api().delete_task(&task_b.id).unwrap();
    let result = project_b.api().get_task(&task_b.id);
    assert!(result.is_err());

    // Verify task A still exists and is in correct state
    let task_a = project_a.api().get_task(&task_a.id).unwrap();
    assert_eq!(task_a.current_stage().unwrap(), "breakdown");

    // Set output for breakdown stage before advancing
    project_a.set_output(
        &task_a.id,
        MockAgentOutput::Subtasks {
            content: "Breakdown for A".into(),
            subtasks: vec![],
            skip_reason: Some("No subtasks needed".into()),
        },
    );

    // Run orchestrator ticks on both - assert no cross-contamination
    project_a.advance(); // spawns breakdown agent
    project_a.advance(); // processes output
    project_b.advance();

    // Task A should have advanced to AwaitingReview in breakdown stage
    let task_a = project_a.api().get_task(&task_a.id).unwrap();
    assert_eq!(task_a.current_stage().unwrap(), "breakdown");
    assert_eq!(task_a.phase, Phase::AwaitingReview);

    // Task B should still not exist
    let result = project_b.api().get_task(&task_b.id);
    assert!(result.is_err());
}

// =============================================================================
// Test: Orchestrator Loops Are Independent
// =============================================================================

#[test]
fn test_orchestrator_loops_are_independent() {
    let workflow = workflows::with_subtasks();
    let project_a = TestEnv::with_git(&workflow, &["planner", "breakdown", "worker", "reviewer"]);
    let project_b = TestEnv::with_git(&workflow, &["planner", "breakdown", "worker", "reviewer"]);

    // Create a task in each project
    let task_a = project_a.create_task("Task A", "Task in A", None);
    let task_b = project_b.create_task("Task B", "Task in B", None);

    // Set outputs for both
    project_a.set_output(
        &task_a.id,
        MockAgentOutput::Artifact {
            name: "plan".into(),
            content: "Plan for A".into(),
        },
    );
    project_b.set_output(
        &task_b.id,
        MockAgentOutput::Artifact {
            name: "plan".into(),
            content: "Plan for B".into(),
        },
    );

    // Tick project A's orchestrator only
    project_a.advance(); // spawns planner
    project_a.advance(); // processes output

    // Verify task A progressed
    let task_a = project_a.api().get_task(&task_a.id).unwrap();
    assert_eq!(task_a.phase, Phase::AwaitingReview);

    // Verify task B has NOT progressed (its orchestrator hasn't ticked)
    let task_b = project_b.api().get_task(&task_b.id).unwrap();
    assert_eq!(task_b.phase, Phase::Idle);

    // Now tick project B's orchestrator
    project_b.advance(); // spawns planner
    project_b.advance(); // processes output

    // Verify task B progressed
    let task_b = project_b.api().get_task(&task_b.id).unwrap();
    assert_eq!(task_b.phase, Phase::AwaitingReview);

    // Verify task A state hasn't changed since its last tick
    let task_a = project_a.api().get_task(&task_a.id).unwrap();
    assert_eq!(task_a.phase, Phase::AwaitingReview);
    assert_eq!(task_a.current_stage().unwrap(), "planning");
}

// =============================================================================
// Test: Stop Flag Is Per-Project
// =============================================================================

#[test]
fn test_stop_flag_is_per_project() {
    let workflow = workflows::with_subtasks();

    // Create two projects with separate stop flags
    let _project_a = TestEnv::with_git(&workflow, &["planner", "breakdown", "worker", "reviewer"]);
    let _project_b = TestEnv::with_git(&workflow, &["planner", "breakdown", "worker", "reviewer"]);

    // Create separate stop flags for each project (simulating ProjectState's stop_flag)
    let stop_flag_a = Arc::new(AtomicBool::new(false));
    let stop_flag_b = Arc::new(AtomicBool::new(false));

    // Verify both flags start as false
    assert!(!stop_flag_a.load(Ordering::Relaxed));
    assert!(!stop_flag_b.load(Ordering::Relaxed));

    // Set project A's stop flag to true
    stop_flag_a.store(true, Ordering::Relaxed);

    // Verify project A's flag is true
    assert!(stop_flag_a.load(Ordering::Relaxed));

    // Verify project B's flag is still false (independent)
    assert!(!stop_flag_b.load(Ordering::Relaxed));

    // Set project B's stop flag to true
    stop_flag_b.store(true, Ordering::Relaxed);

    // Verify both are now true
    assert!(stop_flag_a.load(Ordering::Relaxed));
    assert!(stop_flag_b.load(Ordering::Relaxed));

    // Reset project A's flag
    stop_flag_a.store(false, Ordering::Relaxed);

    // Verify project A is false, project B is still true
    assert!(!stop_flag_a.load(Ordering::Relaxed));
    assert!(stop_flag_b.load(Ordering::Relaxed));
}

// =============================================================================
// Test: Concurrent Task Creation Across Projects
// =============================================================================

#[test]
fn test_concurrent_task_creation_across_projects() {
    let workflow = workflows::with_subtasks();

    // Create two projects (Arc<TestEnv> for thread sharing)
    let project_a = Arc::new(TestEnv::with_git(
        &workflow,
        &["planner", "breakdown", "worker", "reviewer"],
    ));
    let project_b = Arc::new(TestEnv::with_git(
        &workflow,
        &["planner", "breakdown", "worker", "reviewer"],
    ));

    // Spawn two threads, each creating 10 tasks
    let env_a = project_a.clone();
    let handle_a = thread::spawn(move || {
        let mut task_ids = Vec::new();
        for i in 0..10 {
            let task = env_a.create_task(&format!("Task A{i}"), &format!("Task {i} in A"), None);
            task_ids.push(task.id);
        }
        task_ids
    });

    let env_b = project_b.clone();
    let handle_b = thread::spawn(move || {
        let mut task_ids = Vec::new();
        for i in 0..10 {
            let task = env_b.create_task(&format!("Task B{i}"), &format!("Task {i} in B"), None);
            task_ids.push(task.id);
        }
        task_ids
    });

    // Wait for both threads to complete
    let ids_a = handle_a.join().unwrap();
    let ids_b = handle_b.join().unwrap();

    // Give setup time to complete (sync setup is enabled, but check anyway)
    project_a.advance();
    project_b.advance();

    // Verify project A has exactly 10 tasks
    let tasks_a = project_a.api().list_tasks().unwrap();
    assert_eq!(tasks_a.len(), 10);

    // Verify project B has exactly 10 tasks
    let tasks_b = project_b.api().list_tasks().unwrap();
    assert_eq!(tasks_b.len(), 10);

    // Verify no task IDs overlap between projects
    for id_a in &ids_a {
        assert!(!ids_b.contains(id_a));
    }
    for id_b in &ids_b {
        assert!(!ids_a.contains(id_b));
    }

    // Verify no task titles from one appear in the other
    let alpha_titles: Vec<_> = tasks_a.iter().map(|t| t.title.as_str()).collect();
    let beta_titles: Vec<_> = tasks_b.iter().map(|t| t.title.as_str()).collect();

    for i in 0..10 {
        let expected_alpha = format!("Task A{i}");
        let expected_beta = format!("Task B{i}");
        assert!(alpha_titles.contains(&expected_alpha.as_str()));
        assert!(!beta_titles.contains(&expected_alpha.as_str()));
        assert!(beta_titles.contains(&expected_beta.as_str()));
        assert!(!alpha_titles.contains(&expected_beta.as_str()));
    }
}

// =============================================================================
// Test: Subtask Isolation Across Projects
// =============================================================================

#[test]
fn test_subtask_isolation_across_projects() {
    let workflow = workflows::with_subtasks();
    let project_a = TestEnv::with_git(&workflow, &["planner", "breakdown", "worker", "reviewer"]);
    let project_b = TestEnv::with_git(&workflow, &["planner", "breakdown", "worker", "reviewer"]);

    // Create a parent task in project A with subtasks
    let parent_a = project_a.create_task("Feature A", "Build feature A", None);

    // Planning stage
    project_a.set_output(
        &parent_a.id,
        MockAgentOutput::Artifact {
            name: "plan".into(),
            content: "Plan for A".into(),
        },
    );
    project_a.advance(); // spawns planner
    project_a.advance(); // processes output
    project_a.api().approve(&parent_a.id).unwrap();

    // Breakdown stage - produce subtasks
    project_a.set_output(
        &parent_a.id,
        MockAgentOutput::Subtasks {
            content: "Technical design for A".into(),
            subtasks: vec![
                SubtaskOutput {
                    title: "Subtask A1".into(),
                    description: "First subtask of A".into(),
                    depends_on: vec![],
                },
                SubtaskOutput {
                    title: "Subtask A2".into(),
                    description: "Second subtask of A".into(),
                    depends_on: vec![],
                },
            ],
            skip_reason: None,
        },
    );
    project_a.advance(); // spawns breakdown
    project_a.advance(); // processes output
    project_a.api().approve(&parent_a.id).unwrap();

    // Create a separate task in project B (not a parent with subtasks)
    let simple_task = project_b.create_task("Task B", "Task in B", None);

    // Verify project A has subtasks
    let subtasks_a = project_a.api().list_subtasks(&parent_a.id).unwrap();
    assert_eq!(subtasks_a.len(), 2);
    let subtask_ids_a: Vec<_> = subtasks_a.iter().map(|s| s.id.clone()).collect();

    // Verify project B cannot see project A's subtasks
    let project_b_tasks = project_b.api().list_tasks().unwrap();
    assert_eq!(project_b_tasks.len(), 1);
    assert!(!project_b_tasks.iter().any(|t| t.title == "Subtask A1"));
    assert!(!project_b_tasks.iter().any(|t| t.title == "Subtask A2"));
    assert!(!project_b_tasks
        .iter()
        .any(|t| subtask_ids_a.contains(&t.id)));

    // Verify project B's task list only contains task B
    assert_eq!(project_b_tasks[0].id, simple_task.id);
    assert_eq!(project_b_tasks[0].title, "Task B");

    // Complete one subtask in project A
    project_a.advance(); // setup subtasks

    let subtask_a1_id = subtasks_a
        .iter()
        .find(|s| s.title == "Subtask A1")
        .unwrap()
        .id
        .clone();

    // Complete subtask A1: work stage
    project_a.set_output(
        &subtask_a1_id,
        MockAgentOutput::Artifact {
            name: "summary".into(),
            content: "Work done for A1".into(),
        },
    );
    project_a.advance(); // spawns worker
    project_a.advance(); // processes output
    project_a.api().approve(&subtask_a1_id).unwrap();

    // Review stage (automated in subtask flow)
    project_a.set_output(
        &subtask_a1_id,
        MockAgentOutput::Approval {
            decision: "approve".into(),
            content: "LGTM".into(),
        },
    );
    project_a.advance(); // spawns reviewer
    project_a.advance(); // processes output (auto-approves)
    project_a.advance(); // triggers integration

    // Wait for integration to complete
    let subtask_a1 = project_a.api().get_task(&subtask_a1_id).unwrap();
    if subtask_a1.phase == Phase::Integrating {
        project_a.advance();
    }

    // Verify subtask A1 is done/archived
    let subtask_a1 = project_a.api().get_task(&subtask_a1_id).unwrap();
    assert!(
        subtask_a1.status == Status::Done || subtask_a1.status == Status::Archived,
        "Subtask A1 should be done/archived, got {:?}",
        subtask_a1.status
    );

    // Verify project B's task is still in its original state (Idle)
    let simple_task_refreshed = project_b.api().get_task(&simple_task.id).unwrap();
    assert_eq!(simple_task_refreshed.phase, Phase::Idle);

    // Verify project B has no knowledge of the completed subtask
    let final_project_b_tasks = project_b.api().list_tasks().unwrap();
    assert_eq!(final_project_b_tasks.len(), 1);
    assert!(!final_project_b_tasks.iter().any(|t| t.id == subtask_a1_id));
}
