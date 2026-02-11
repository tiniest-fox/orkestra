//! E2E tests for multi-project isolation.
//!
//! Tests that multiple projects can run simultaneously without interfering
//! with each other's state, database, or orchestrator.

use super::helpers::{MockAgentOutput, TestEnv};
use orkestra_core::testutil::fixtures::test_default_workflow;
use orkestra_core::workflow::runtime::Phase;
use std::sync::{Arc, Mutex};
use std::thread;
use std::time::Duration;

#[test]
fn test_parallel_project_isolation() {
    // Create two separate project environments with default workflow
    let env1 = Arc::new(Mutex::new(TestEnv::with_git(
        &test_default_workflow(),
        &["planner", "breakdown", "worker", "reviewer"],
    )));
    let env2 = Arc::new(Mutex::new(TestEnv::with_git(
        &test_default_workflow(),
        &["planner", "breakdown", "worker", "reviewer"],
    )));

    // Create tasks in both projects
    let task1_id = {
        let env = env1.lock().unwrap();
        let task = env.create_task("Project 1 task", "Task in first project", None);
        task.id
    };

    let task2_id = {
        let env = env2.lock().unwrap();
        let task = env.create_task("Project 2 task", "Task in second project", None);
        task.id
    };

    // Verify tasks have different IDs
    assert_ne!(task1_id, task2_id, "Task IDs should be unique");

    // Queue agent output for project 1
    {
        let env = env1.lock().unwrap();
        env.set_output(
            &task1_id,
            MockAgentOutput::Artifact {
                name: "plan".to_string(),
                content: "Implementation plan for project 1".to_string(),
                activity_log: None,
            },
        );
    }

    // Queue agent output for project 2
    {
        let env = env2.lock().unwrap();
        env.set_output(
            &task2_id,
            MockAgentOutput::Artifact {
                name: "plan".to_string(),
                content: "Implementation plan for project 2".to_string(),
                activity_log: None,
            },
        );
    }

    // Run orchestrator in parallel
    let env1_clone = Arc::clone(&env1);
    let env2_clone = Arc::clone(&env2);

    let handle1 = thread::spawn(move || {
        let mut env = env1_clone.lock().unwrap();
        for _ in 0..10 {
            env.advance();
            drop(env);
            thread::sleep(Duration::from_millis(50));
            env = env1_clone.lock().unwrap();
        }
    });

    let handle2 = thread::spawn(move || {
        let mut env = env2_clone.lock().unwrap();
        for _ in 0..10 {
            env.advance();
            drop(env);
            thread::sleep(Duration::from_millis(50));
            env = env2_clone.lock().unwrap();
        }
    });

    handle1.join().expect("Thread 1 should complete");
    handle2.join().expect("Thread 2 should complete");

    // Verify both tasks completed their planning stage independently
    {
        let env = env1.lock().unwrap();
        let task = env.api().get_task(&task1_id).expect("Should get task 1");
        assert!(
            task.artifacts.contains("plan"),
            "Project 1 task should have plan artifact"
        );
    }

    {
        let env = env2.lock().unwrap();
        let task = env.api().get_task(&task2_id).expect("Should get task 2");
        assert!(
            task.artifacts.contains("plan"),
            "Project 2 task should have plan artifact"
        );
    }

    // Verify project 1 doesn't see project 2's task
    {
        let env = env1.lock().unwrap();
        let tasks = env.api().list_tasks().expect("Should list tasks");
        assert_eq!(tasks.len(), 1, "Project 1 should only see 1 task");
        assert_eq!(tasks[0].id, task1_id, "Project 1 should only see its task");
    }

    // Verify project 2 doesn't see project 1's task
    {
        let env = env2.lock().unwrap();
        let tasks = env.api().list_tasks().expect("Should list tasks");
        assert_eq!(tasks.len(), 1, "Project 2 should only see 1 task");
        assert_eq!(tasks[0].id, task2_id, "Project 2 should only see its task");
    }
}

#[test]
fn test_database_isolation() {
    // Create two projects
    let env1 = TestEnv::with_git(
        &test_default_workflow(),
        &["planner", "breakdown", "worker", "reviewer"],
    );
    let env2 = TestEnv::with_git(
        &test_default_workflow(),
        &["planner", "breakdown", "worker", "reviewer"],
    );

    // Create tasks with similar descriptions
    let task1 = env1.create_task("Test Task", "Description", None);
    let task2 = env2.create_task("Test Task", "Description", None);

    // Even with identical inputs, IDs should be different (unique generation)
    assert_ne!(
        task1.id, task2.id,
        "Tasks in different projects should have unique IDs"
    );

    // Delete task1
    env1.api()
        .delete_task(&task1.id)
        .expect("Should delete task 1");

    // Verify task2 still exists
    let task2_after = env2.api().get_task(&task2.id).expect("Should get task 2");
    assert_eq!(task2_after.id, task2.id, "Task 2 should still exist");
    assert_eq!(
        task2_after.description, "Description",
        "Task 2 should be unchanged"
    );

    // Verify task1 no longer exists in env1
    let tasks_in_env1 = env1.api().list_tasks().expect("Should list tasks");
    assert!(
        tasks_in_env1.is_empty(),
        "Project 1 should have no tasks after deletion"
    );

    // Verify env2 still has its task
    let tasks_in_env2 = env2.api().list_tasks().expect("Should list tasks");
    assert_eq!(tasks_in_env2.len(), 1, "Project 2 should still have 1 task");
}

#[test]
fn test_phase_state_isolation() {
    // Create two projects
    let env1 = TestEnv::with_git(
        &test_default_workflow(),
        &["planner", "breakdown", "worker", "reviewer"],
    );
    let env2 = TestEnv::with_git(
        &test_default_workflow(),
        &["planner", "breakdown", "worker", "reviewer"],
    );

    // Create tasks
    let task1_id = env1.create_task("Phase test 1", "Task 1", None).id;
    let task2_id = env2.create_task("Phase test 2", "Task 2", None).id;

    // Verify initial phases are both Idle
    let task1 = env1.api().get_task(&task1_id).expect("Should get task 1");
    let task2 = env2.api().get_task(&task2_id).expect("Should get task 2");

    assert_eq!(task1.phase, Phase::Idle, "Task 1 should start as Idle");
    assert_eq!(task2.phase, Phase::Idle, "Task 2 should start as Idle");

    // Queue agent output for task1 only
    env1.set_output(
        &task1_id,
        MockAgentOutput::Artifact {
            name: "plan".to_string(),
            content: "Plan for task 1".to_string(),
            activity_log: None,
        },
    );

    // Run orchestrator for env1 only
    for _ in 0..5 {
        env1.advance();
        thread::sleep(Duration::from_millis(10));
    }

    // Task1 should have progressed, task2 should remain in Idle
    let task1_after = env1.api().get_task(&task1_id).expect("Should get task 1");
    let task2_after = env2.api().get_task(&task2_id).expect("Should get task 2");

    assert!(
        task1_after.phase == Phase::AwaitingReview || task1_after.artifacts.contains("plan"),
        "Task 1 should have progressed"
    );
    assert_eq!(
        task2_after.phase,
        Phase::Idle,
        "Task 2 should remain unchanged"
    );
}

#[test]
fn test_concurrent_task_creation() {
    // Create two projects
    let env1 = Arc::new(Mutex::new(TestEnv::with_git(
        &test_default_workflow(),
        &["planner", "breakdown", "worker", "reviewer"],
    )));
    let env2 = Arc::new(Mutex::new(TestEnv::with_git(
        &test_default_workflow(),
        &["planner", "breakdown", "worker", "reviewer"],
    )));

    // Create multiple tasks concurrently in each project
    let env1_clone = Arc::clone(&env1);
    let env2_clone = Arc::clone(&env2);

    let handle1 = thread::spawn(move || {
        let env = env1_clone.lock().unwrap();
        let mut task_ids = Vec::new();
        for i in 0..5 {
            let task = env.create_task(&format!("Task {i} in project 1"), "Description", None);
            task_ids.push(task.id);
        }
        task_ids
    });

    let handle2 = thread::spawn(move || {
        let env = env2_clone.lock().unwrap();
        let mut task_ids = Vec::new();
        for i in 0..5 {
            let task = env.create_task(&format!("Task {i} in project 2"), "Description", None);
            task_ids.push(task.id);
        }
        task_ids
    });

    let task_ids_1 = handle1.join().expect("Thread 1 should complete");
    let task_ids_2 = handle2.join().expect("Thread 2 should complete");

    // Verify all IDs are unique
    let mut all_ids: Vec<_> = task_ids_1.iter().chain(task_ids_2.iter()).collect();
    all_ids.sort();
    all_ids.dedup();
    assert_eq!(
        all_ids.len(),
        10,
        "All 10 task IDs should be unique across projects"
    );

    // Verify each project sees only its own tasks
    {
        let env = env1.lock().unwrap();
        let tasks = env.api().list_tasks().expect("Should list tasks");
        assert_eq!(tasks.len(), 5, "Project 1 should have 5 tasks");
        for task in &tasks {
            assert!(
                task_ids_1.contains(&task.id),
                "All tasks in project 1 should be from project 1"
            );
        }
    }

    {
        let env = env2.lock().unwrap();
        let tasks = env.api().list_tasks().expect("Should list tasks");
        assert_eq!(tasks.len(), 5, "Project 2 should have 5 tasks");
        for task in &tasks {
            assert!(
                task_ids_2.contains(&task.id),
                "All tasks in project 2 should be from project 2"
            );
        }
    }
}
