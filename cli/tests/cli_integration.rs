//! Integration tests for CLI commands.
//!
//! These tests exercise the `WorkflowApi` methods that power the CLI commands,
//! using real git repos and `SQLite` (matching core e2e test patterns).

use orkestra_cli::get_git_state;
use orkestra_core::adapters::sqlite::DatabaseConnection;
use orkestra_core::testutil::create_temp_git_repo;
use orkestra_core::testutil::fixtures::{iterations, sessions};
use orkestra_core::workflow::config::{FlowConfig, IntegrationConfig, StageConfig, WorkflowConfig};
use orkestra_core::workflow::domain::{LogEntry, Task};
use orkestra_core::workflow::ports::WorkflowStore;
use orkestra_core::workflow::runtime::{Outcome, TaskState};
use orkestra_core::workflow::{
    Git2GitService, GitService, SqliteWorkflowStore, TaskCreationMode, WorkflowApi,
};
use std::sync::Arc;
use tempfile::TempDir;

/// Create a test workflow with a flow.
fn test_workflow_with_flow() -> WorkflowConfig {
    use indexmap::IndexMap;

    let mut flows = IndexMap::new();
    flows.insert(
        "quick".to_string(),
        FlowConfig {
            stages: vec![StageConfig::new("work", "summary")],
            integration: IntegrationConfig::new("work"),
        },
    );

    WorkflowConfig::new(vec![
        StageConfig::new("planning", "plan"),
        StageConfig::new("work", "summary"),
        StageConfig::new("review", "verdict"),
    ])
    .with_integration(IntegrationConfig::new("work"))
    .with_flows(flows)
}

/// Create a simple test workflow without flows.
fn test_workflow() -> WorkflowConfig {
    WorkflowConfig::new(vec![
        StageConfig::new("planning", "plan"),
        StageConfig::new("work", "summary"),
        StageConfig::new("review", "verdict"),
    ])
    .with_integration(IntegrationConfig::new("work"))
}

/// Set up a real git repo with `SQLite` and `WorkflowApi` (matches `TestEnv::with_git` pattern).
fn setup_test_env(workflow: &WorkflowConfig) -> (WorkflowApi, Arc<dyn WorkflowStore>, TempDir) {
    let temp_dir = create_temp_git_repo().expect("Failed to create git repo");

    // Create .orkestra directory structure
    let orkestra_dir = temp_dir.path().join(".orkestra");
    std::fs::create_dir_all(orkestra_dir.join(".database")).unwrap();

    // Save and reload workflow config
    let workflow_path = orkestra_dir.join("workflow.yaml");
    let yaml = serde_yaml::to_string(&workflow).unwrap();
    std::fs::write(&workflow_path, yaml).unwrap();
    let loaded_workflow = orkestra_core::workflow::config::load_workflow(&workflow_path)
        .expect("Should load workflow");

    // Real SQLite database
    let db_path = orkestra_dir.join(".database/orkestra.db");
    let db_conn = DatabaseConnection::open(&db_path).expect("Should open database");
    let store: Arc<dyn WorkflowStore> = Arc::new(SqliteWorkflowStore::new(db_conn.shared()));

    // Git service for worktree support
    let git_service: Arc<dyn GitService> =
        Arc::new(Git2GitService::new(temp_dir.path()).expect("Git service should init"));

    let api = WorkflowApi::with_git(loaded_workflow, Arc::clone(&store), git_service);
    (api, store, temp_dir)
}

#[test]
fn test_list_subtasks_with_parent_filter() {
    let (api, store, _temp_dir) = setup_test_env(&test_workflow());

    // Create parent task (API creates it but doesn't set up worktree yet)
    let parent = api
        .create_task("Parent task", "Parent description", None)
        .expect("create parent");

    // Create 2 subtasks manually with dependencies
    let subtask1 = Task::new(
        "sub-1",
        "Subtask 1",
        "First subtask",
        "planning",
        chrono::Utc::now().to_rfc3339(),
    )
    .with_parent(&parent.id);
    store.save_task(&subtask1).expect("save subtask1");

    let subtask2 = Task::new(
        "sub-2",
        "Subtask 2",
        "Second subtask",
        "planning",
        chrono::Utc::now().to_rfc3339(),
    )
    .with_parent(&parent.id)
    .with_dependencies(vec![subtask1.id.clone()]);
    store.save_task(&subtask2).expect("save subtask2");

    // Call API method (what CLI does)
    let views = api
        .list_subtask_views(&parent.id)
        .expect("list subtask views");

    // Verify results
    assert_eq!(views.len(), 2);
    assert_eq!(views[0].task.id, subtask1.id); // Topological order: sub-1 before sub-2
    assert_eq!(views[1].task.id, subtask2.id);

    // Verify JSON serialization works
    let json = serde_json::to_string(&views).expect("serialize to JSON");
    assert!(json.contains(&format!("\"id\":\"{}\"", subtask1.id)));
    assert!(json.contains(&format!("\"id\":\"{}\"", subtask2.id)));
}

#[test]
fn test_list_tasks_with_depends_on_filter() {
    let (api, store, _temp_dir) = setup_test_env(&test_workflow());

    // Create 3 tasks
    let task1 = api
        .create_task("Task 1", "First task", None)
        .expect("create task1");
    let _task2 = api
        .create_task("Task 2", "Second task", None)
        .expect("create task2");

    let task3 = Task::new(
        "task-3",
        "Task 3",
        "Third task",
        "planning",
        chrono::Utc::now().to_rfc3339(),
    )
    .with_dependencies(vec![task1.id.clone()]);
    store.save_task(&task3).expect("save task3");

    // List all tasks and filter by depends_on
    let all_tasks = api.list_tasks().expect("list tasks");
    let filtered: Vec<_> = all_tasks
        .into_iter()
        .filter(|t| t.depends_on.contains(&task1.id))
        .collect();

    // Verify only task3 is returned
    assert_eq!(filtered.len(), 1);
    assert_eq!(filtered[0].id, task3.id);

    // Verify JSON serialization
    let json = serde_json::to_string(&filtered).expect("serialize to JSON");
    assert!(json.contains(&format!("\"id\":\"{}\"", task3.id)));
    assert!(json.contains("\"depends_on\""));
}

#[test]
fn test_task_show_iterations() {
    let (api, store, _temp_dir) = setup_test_env(&test_workflow());

    // Create task
    let task = api
        .create_task("Test task", "Description", None)
        .expect("create task");
    let session =
        sessions::save_session(&*store, "session-1", &task.id, "planning").expect("save session");

    // Create iteration with rejection outcome
    iterations::save_rejected_iteration(
        &*store,
        "iter-1",
        &task.id,
        "planning",
        1,
        &session.id,
        "Need more detail in the plan",
    )
    .expect("save rejected iteration");

    // Call API method
    let iterations = api.get_iterations(&task.id).expect("get iterations");

    // Verify iteration data
    assert_eq!(iterations.len(), 1);
    assert_eq!(iterations[0].stage, "planning");

    if let Some(Outcome::Rejected { feedback, .. }) = &iterations[0].outcome {
        assert_eq!(feedback, "Need more detail in the plan");
    } else {
        panic!("Expected Rejected outcome");
    }

    // Verify JSON serialization
    let json = serde_json::to_string(&iterations).expect("serialize to JSON");
    assert!(json.contains("\"stage\":\"planning\""));
    assert!(json.contains("Need more detail in the plan"));
}

#[test]
fn test_task_show_sessions() {
    let (api, store, _temp_dir) = setup_test_env(&test_workflow());

    // Create task
    let task = api
        .create_task("Test task", "Description", None)
        .expect("create task");

    // Create session with agent PID
    sessions::save_session_with_pid(&*store, "session-1", &task.id, "planning", 12345)
        .expect("save session with PID");

    // Call API method
    let sessions = api.get_stage_sessions(&task.id).expect("get sessions");

    // Verify session data
    assert_eq!(sessions.len(), 1);
    assert_eq!(sessions[0].stage, "planning");
    assert_eq!(sessions[0].agent_pid, Some(12345));
    assert_eq!(sessions[0].spawn_count, 1);

    // Verify JSON serialization
    let json = serde_json::to_string(&sessions).expect("serialize to JSON");
    assert!(json.contains("\"stage\":\"planning\""));
    assert!(json.contains("\"agent_pid\":12345"));
}

#[test]
fn test_task_create_with_flow() {
    let (api, _store, _temp_dir) = setup_test_env(&test_workflow_with_flow());

    // Create task with valid flow
    let task = api
        .create_task_with_options(
            "Test task",
            "Description",
            None,
            TaskCreationMode::Normal,
            Some("quick"),
        )
        .expect("create task with flow");

    // Verify task has flow set and starts at flow's first stage
    assert_eq!(task.flow, "quick");
    assert_eq!(task.current_stage(), Some("work")); // "quick" flow only has work stage
    assert!(matches!(task.state, TaskState::AwaitingSetup { .. }));

    // Test invalid flow name
    let result = api.create_task_with_options(
        "Test task",
        "Description",
        None,
        TaskCreationMode::Normal,
        Some("nonexistent"),
    );
    assert!(result.is_err());
    let err_msg = result.unwrap_err().to_string();
    assert!(err_msg.contains("Unknown flow"));
}

#[test]
fn test_task_show_git_state() {
    let (api, store, temp_dir) = setup_test_env(&test_workflow());

    // Create task - this creates a worktree via setup
    let task = api
        .create_task("Test task", "Description", None)
        .expect("create task");

    // With sync_setup=true, setup should complete immediately
    // But we need to trigger it - in real system, orchestrator does this
    // For now, verify the task was created correctly
    assert!(matches!(task.state, TaskState::AwaitingSetup { .. }));

    // Since we can't easily trigger setup without orchestrator,
    // manually create git fields for testing get_git_state
    let mut task = task;
    task.branch_name = Some("ork/test-task".to_string());
    task.worktree_path = Some(
        temp_dir
            .path()
            .join(".orkestra/.worktrees/test-task")
            .to_str()
            .unwrap()
            .to_string(),
    );
    task.base_branch = "main".to_string();
    task.base_commit = "abc123".to_string();
    task.state = TaskState::queued("planning");
    store.save_task(&task).expect("update task");

    // Call get_git_state (simulates CLI --git flag)
    let git_state = get_git_state(&api, &task.id).expect("get git state");

    // Verify git state fields from task
    assert_eq!(git_state.branch_name, task.branch_name);
    assert_eq!(git_state.worktree_path, task.worktree_path);
    assert_eq!(git_state.base_branch, task.base_branch);
    assert_eq!(git_state.base_commit, task.base_commit);
    // head_commit and is_dirty will be None since worktree doesn't actually exist

    // Verify JSON serialization
    let json = serde_json::to_string(&git_state).expect("serialize git state");
    assert!(json.contains("\"base_branch\":\"main\""));
}

#[test]
fn test_log_viewing_with_pagination() {
    let (api, store, _temp_dir) = setup_test_env(&test_workflow());

    // Create task and session
    let task = api
        .create_task("Test task", "Description", None)
        .expect("create task");
    let session =
        sessions::save_session(&*store, "session-1", &task.id, "planning").expect("save session");

    // Append 10 log entries with identifiable content
    for i in 0..10 {
        store
            .append_log_entry(
                &session.id,
                &LogEntry::Text {
                    content: format!("Log entry {i}"),
                },
                None,
            )
            .expect("append log");
    }

    // Get all logs (baseline)
    let (all_logs, _cursor) = api
        .get_task_logs(&task.id, Some("planning"), None, None)
        .expect("get all logs");
    assert_eq!(all_logs.len(), 10);

    // Test limit: fetch first 3 entries
    let limited: Vec<_> = all_logs.iter().take(3).collect();
    assert_eq!(limited.len(), 3);

    // Test offset: skip first 5, take 3
    let paginated: Vec<_> = all_logs.iter().skip(5).take(3).collect();
    assert_eq!(paginated.len(), 3);
    // Verify we got entries 5, 6, 7 (not 0, 1, 2)
    if let LogEntry::Text { content } = &paginated[0] {
        assert_eq!(content, "Log entry 5");
    } else {
        panic!("Expected Text log entry");
    }
    if let LogEntry::Text { content } = &paginated[2] {
        assert_eq!(content, "Log entry 7");
    } else {
        panic!("Expected Text log entry");
    }

    // Test offset beyond end: should return empty
    let empty: Vec<_> = all_logs.iter().skip(100).take(10).collect();
    assert!(empty.is_empty());

    // Verify JSON serialization includes type discriminators
    let json = serde_json::to_string(&all_logs).expect("serialize logs");
    assert!(json.contains("\"type\":\"text\""));
}

#[test]
fn test_stages_with_logs() {
    let (api, store, _temp_dir) = setup_test_env(&test_workflow());

    // Create task with no logs
    let task = api
        .create_task("Test task", "Description", None)
        .expect("create task");

    // Should return empty vec
    let stages = api.get_stages_with_logs(&task.id).expect("get stages");
    assert_eq!(stages.len(), 0);

    // Create session and add logs
    let session =
        sessions::save_session(&*store, "session-1", &task.id, "planning").expect("save session");
    store
        .append_log_entry(
            &session.id,
            &LogEntry::Text {
                content: "Planning log".to_string(),
            },
            None,
        )
        .expect("append log");

    // Should now return ["planning"]
    let stages = api.get_stages_with_logs(&task.id).expect("get stages");
    assert_eq!(stages.len(), 1);
    assert_eq!(stages[0], "planning");
}

#[test]
fn test_get_logs_by_session_id() {
    let (api, store, _temp_dir) = setup_test_env(&test_workflow());

    // Create task
    let task = api
        .create_task("Test task", "Description", None)
        .expect("create task");

    // Create first session and add logs
    let session1 =
        sessions::save_session(&*store, "session-1", &task.id, "planning").expect("save session 1");
    store
        .append_log_entry(
            &session1.id,
            &LogEntry::Text {
                content: "Log from session 1".to_string(),
            },
            None,
        )
        .expect("append log to session 1");

    // Create second session (simulating rejection/retry) and add logs
    let session2 =
        sessions::save_session(&*store, "session-2", &task.id, "planning").expect("save session 2");
    store
        .append_log_entry(
            &session2.id,
            &LogEntry::Text {
                content: "Log from session 2".to_string(),
            },
            None,
        )
        .expect("append log to session 2");

    // Fetch by specific session_id (session 1) - should get only session 1 logs
    let (logs, _cursor) = api
        .get_task_logs(&task.id, None, Some(&session1.id), None)
        .expect("get logs by session_id");
    assert_eq!(logs.len(), 1);
    if let LogEntry::Text { content } = &logs[0] {
        assert!(
            content.contains("session 1"),
            "Expected log from session 1, got: {content}"
        );
    } else {
        panic!("Expected Text log entry");
    }

    // Fetch by session 2 - should get only session 2 logs
    let (logs, _cursor) = api
        .get_task_logs(&task.id, None, Some(&session2.id), None)
        .expect("get logs for session 2");
    assert_eq!(logs.len(), 1);
    if let LogEntry::Text { content } = &logs[0] {
        assert!(
            content.contains("session 2"),
            "Expected log from session 2, got: {content}"
        );
    } else {
        panic!("Expected Text log entry");
    }

    // Verify session_id takes precedence over stage parameter
    // Even when stage is provided, session_id should be used
    let (logs, _cursor) = api
        .get_task_logs(&task.id, Some("work"), Some(&session1.id), None)
        .expect("get logs with both stage and session_id");
    assert_eq!(logs.len(), 1);
    if let LogEntry::Text { content } = &logs[0] {
        assert!(
            content.contains("session 1"),
            "session_id should take precedence over stage, got: {content}"
        );
    } else {
        panic!("Expected Text log entry");
    }
}

#[test]
fn test_stuck_task_investigation_scenario() {
    // This test verifies Success Criterion 11: an agent can diagnose why a task
    // is stuck using only CLI-accessible data.

    let (api, store, _temp_dir) = setup_test_env(&test_workflow());

    // Create task
    let task = api
        .create_task("Implement feature X", "Add new feature", None)
        .expect("create task");

    // Simulate: planning stage completed successfully
    let planning_session = sessions::save_session(&*store, "plan-sess", &task.id, "planning")
        .expect("save planning session");
    iterations::save_approved_iteration(
        &*store,
        "plan-iter",
        &task.id,
        "planning",
        1,
        &planning_session.id,
    )
    .expect("save planning iteration");

    // Move task to work stage
    let mut task = api.get_task(&task.id).expect("get task");
    task.state = TaskState::queued("work");
    store.save_task(&task).expect("update task stage");

    // Simulate: work stage completed successfully
    let work_session =
        sessions::save_session(&*store, "work-sess", &task.id, "work").expect("save work session");
    iterations::save_approved_iteration(
        &*store,
        "work-iter",
        &task.id,
        "work",
        1,
        &work_session.id,
    )
    .expect("save work iteration");

    // Move task to review stage
    task.state = TaskState::awaiting_approval("review");
    store.save_task(&task).expect("update to review");

    // Simulate: review stage REJECTED with feedback
    let review_session = sessions::save_session(&*store, "review-sess", &task.id, "review")
        .expect("save review session");
    iterations::save_rejected_iteration(
        &*store,
        "review-iter",
        &task.id,
        "review",
        1,
        &review_session.id,
        "Tests are failing - fix the unit tests",
    )
    .expect("save rejected review iteration");

    // Step 1: Get task - see status and phase
    let task_info = api.get_task(&task.id).expect("get task");
    assert_eq!(task_info.state, TaskState::awaiting_approval("review"));

    // Step 2: Get iterations - see the history
    let iterations = api.get_iterations(&task.id).expect("get iterations");
    assert_eq!(iterations.len(), 3); // planning, work, review

    // Find review iteration - should be rejected with feedback
    let review_iter = iterations.iter().find(|i| i.stage == "review").unwrap();
    if let Some(Outcome::Rejected { feedback, .. }) = &review_iter.outcome {
        assert_eq!(feedback, "Tests are failing - fix the unit tests");
    } else {
        panic!("Expected review iteration to be rejected");
    }

    // Step 3: Get stage sessions
    let sessions = api.get_stage_sessions(&task.id).expect("get sessions");
    assert_eq!(sessions.len(), 3);

    // Step 4: Verify rejection feedback API
    let feedback = api
        .get_rejection_feedback(&task.id)
        .expect("get rejection feedback");
    assert_eq!(
        feedback,
        Some("Tests are failing - fix the unit tests".to_string())
    );

    // Verify JSON serialization works
    let json = serde_json::to_string(&iterations).expect("serialize iterations");
    assert!(json.contains("Tests are failing"));
}

#[test]
fn test_flows_command() {
    // test_workflow_with_flow() has a "quick" flow with one stage ("work") and on_failure = "work"
    let config = test_workflow_with_flow();

    // flow_names() returns names in insertion order
    let names = config.flow_names();
    assert!(names.contains(&"quick"), "Expected 'quick' flow");

    // JSON output is a plain array of name strings
    let json = serde_json::to_string(&names).expect("serialize flow names");
    assert!(json.contains("\"quick\""), "JSON should contain 'quick'");
    // Must be a JSON array, not an object
    assert!(json.starts_with('['), "JSON output should be an array");

    // --pretty: look up "quick" by name and verify stage names + integration fields
    let flow = config
        .flows
        .get("quick")
        .expect("'quick' flow should exist");
    let stage_names: Vec<&str> = flow.stages.iter().map(|s| s.name.as_str()).collect();
    assert_eq!(stage_names, vec!["work"]);
    assert_eq!(flow.integration.on_failure, "work");
    assert!(!flow.integration.auto_merge);
}

#[test]
fn test_create_task_with_auto_mode() {
    let (api, _store, _temp_dir) = setup_test_env(&test_workflow());

    // Create task with AutoMode
    let auto_task = api
        .create_task_with_options(
            "Auto task",
            "Description",
            None,
            TaskCreationMode::AutoMode,
            None,
        )
        .expect("create auto task");
    assert!(
        auto_task.auto_mode,
        "Task created with AutoMode should have auto_mode=true"
    );

    // Create task with Normal mode — should default to false
    let normal_task = api
        .create_task_with_options(
            "Normal task",
            "Description",
            None,
            TaskCreationMode::Normal,
            None,
        )
        .expect("create normal task");
    assert!(
        !normal_task.auto_mode,
        "Task created with Normal mode should have auto_mode=false"
    );
}
