//! E2E tests for artifact snapshots on iterations and `iteration_id` tagging on log entries.
//!
//! Covers:
//! - Artifact snapshots stored on iterations for artifact, subtask, and approval-reject outputs
//! - Rejection preserving artifact history across iterations
//! - Chat-mode completion storing a snapshot via the handler path
//! - Log entries tagged with `iteration_id` for normal agent runs
//! - Chat-mode log entries having no `iteration_id` (None)

use orkestra_core::{
    adapters::sqlite::DatabaseConnection,
    workflow::{
        config::{GateConfig, StageConfig, WorkflowConfig},
        domain::{IterationTrigger, LogEntry},
        execution::SubtaskOutput,
        ports::WorkflowStore,
        runtime::TaskState,
        SqliteWorkflowStore,
    },
};
use std::sync::Arc;

use crate::helpers::{workflows, MockAgentOutput, TestEnv};

// =============================================================================
// Helpers
// =============================================================================

/// Single-stage workflow with approval, used by most tests here.
fn approval_workflow() -> WorkflowConfig {
    WorkflowConfig::new(vec![StageConfig::new("work", "summary")
        .with_prompt("worker.md")
        .with_gate(GateConfig::Agentic)])
}

/// Seed a fake `claude_session_id` so `send_chat_message` can resume.
fn seed_session_id(ctx: &TestEnv, task_id: &str, stage: &str) {
    ctx.api()
        .set_session_id(task_id, stage, "test-session-id")
        .expect("seed claude_session_id");
}

/// Advance a task to `AwaitingApproval` in the "work" stage.
fn advance_to_awaiting_approval(ctx: &TestEnv, task_id: &str, content: &str) {
    ctx.set_output(task_id, MockAgentOutput::artifact("summary", content));
    ctx.advance(); // spawn agent → completion ready
    ctx.advance(); // process output → AwaitingApproval
}

/// Open a second DB connection to access store methods not on `WorkflowApi`.
fn open_store(ctx: &TestEnv) -> Arc<dyn WorkflowStore> {
    let db_path = ctx.temp_dir().join(".orkestra/.database/orkestra.db");
    let conn = DatabaseConnection::open(&db_path).expect("open db");
    Arc::new(SqliteWorkflowStore::new(conn.shared()))
}

// =============================================================================
// Test 1: artifact snapshot stored on normal iteration
// =============================================================================

#[test]
fn test_artifact_snapshot_stored_on_iteration() {
    let workflow = approval_workflow();
    let ctx = TestEnv::with_git(&workflow, &["worker"]);

    let task = ctx.create_task("Snapshot test", "Test artifact snapshot", None);
    let task_id = task.id.clone();

    advance_to_awaiting_approval(&ctx, &task_id, "The plan content");

    // Verify task is in AwaitingApproval
    let task = ctx.api().get_task(&task_id).unwrap();
    assert!(
        task.is_awaiting_review(),
        "Task should be awaiting review, got: {:?}",
        task.state
    );

    // Task-level artifact has the content
    assert_eq!(task.artifact("summary"), Some("The plan content"));

    // Iteration has artifact_snapshot
    let iterations = ctx.api().get_iterations(&task_id).unwrap();
    let work_iter = iterations.iter().find(|i| i.stage == "work").unwrap();
    let snapshot = work_iter
        .artifact_snapshot
        .as_ref()
        .expect("Iteration should have artifact_snapshot");
    assert_eq!(snapshot.name, "summary");
    assert_eq!(snapshot.content, "The plan content");
}

// =============================================================================
// Test 2: rejected iteration preserves artifact snapshot
// =============================================================================

#[test]
fn test_rejected_iteration_preserves_artifact_snapshot() {
    let workflow = approval_workflow();
    let ctx = TestEnv::with_git(&workflow, &["worker"]);

    let task = ctx.create_task("Rejection test", "Test snapshot across rejections", None);
    let task_id = task.id.clone();

    // First attempt
    advance_to_awaiting_approval(&ctx, &task_id, "First attempt");

    let task = ctx.api().get_task(&task_id).unwrap();
    assert!(task.is_awaiting_review(), "Should be awaiting review");

    // Human rejects
    ctx.api()
        .reject(&task_id, "Try again")
        .expect("Should reject");

    // Second attempt
    advance_to_awaiting_approval(&ctx, &task_id, "Second attempt");

    // Both iterations should have their respective snapshots
    let iterations = ctx.api().get_iterations(&task_id).unwrap();
    let work_iters: Vec<_> = iterations.iter().filter(|i| i.stage == "work").collect();
    assert_eq!(work_iters.len(), 2, "Should have 2 work iterations");

    // Sort by iteration_number to ensure order
    let mut work_iters = work_iters;
    work_iters.sort_by_key(|i| i.iteration_number);

    let snap1 = work_iters[0]
        .artifact_snapshot
        .as_ref()
        .expect("Iteration 1 should have snapshot");
    assert_eq!(snap1.content, "First attempt");

    let snap2 = work_iters[1]
        .artifact_snapshot
        .as_ref()
        .expect("Iteration 2 should have snapshot");
    assert_eq!(snap2.content, "Second attempt");

    // Task-level artifact has latest content
    let task = ctx.api().get_task(&task_id).unwrap();
    assert_eq!(task.artifact("summary"), Some("Second attempt"));
}

// =============================================================================
// Test 3: subtask artifact snapshot contains human-readable markdown
// =============================================================================

#[test]
fn test_subtask_artifact_snapshot() {
    let workflow = workflows::with_subtasks();
    let ctx = TestEnv::with_git(&workflow, &["planner", "breakdown", "worker", "reviewer"]);

    let task = ctx.create_task("Subtask snapshot test", "Test subtask snapshot", None);
    let task_id = task.id.clone();

    // Advance through planning stage
    ctx.set_output(&task_id, MockAgentOutput::artifact("plan", "The plan"));
    ctx.advance(); // spawn planner
    ctx.advance(); // process plan output → AwaitingApproval
    ctx.api().approve(&task_id).expect("approve plan");
    ctx.advance(); // commit pipeline → advance to breakdown

    // Breakdown stage: produce 2 subtasks
    let subtask_outputs = vec![
        SubtaskOutput {
            title: "First subtask".to_string(),
            description: "Do the first thing".to_string(),
            detailed_instructions: "Details for first".to_string(),
            depends_on: vec![],
        },
        SubtaskOutput {
            title: "Second subtask".to_string(),
            description: "Do the second thing".to_string(),
            detailed_instructions: "Details for second".to_string(),
            depends_on: vec![0],
        },
    ];
    ctx.set_output(
        &task_id,
        MockAgentOutput::Subtasks {
            content: "Technical design overview".to_string(),
            subtasks: subtask_outputs,
            activity_log: None,
            resources: vec![],
        },
    );
    ctx.advance(); // spawn breakdown agent
    ctx.advance(); // process subtask output → AwaitingApproval

    let task = ctx.api().get_task(&task_id).unwrap();
    assert!(
        task.is_awaiting_review(),
        "Should be awaiting review after breakdown, got: {:?}",
        task.state
    );

    // Get breakdown iteration
    let iterations = ctx.api().get_iterations(&task_id).unwrap();
    let breakdown_iter = iterations
        .iter()
        .find(|i| i.stage == "breakdown")
        .expect("Should have breakdown iteration");

    let snapshot = breakdown_iter
        .artifact_snapshot
        .as_ref()
        .expect("Breakdown iteration should have artifact_snapshot");

    // Snapshot should contain human-readable markdown
    assert!(
        snapshot.content.contains("Technical design overview"),
        "Snapshot should contain the design overview"
    );
    assert!(
        snapshot.content.contains("## Proposed Subtasks"),
        "Snapshot should contain subtask markdown heading"
    );
    assert!(
        snapshot.content.contains("First subtask"),
        "Snapshot should contain subtask titles"
    );

    // Snapshot should NOT contain the raw JSON (that's the _structured artifact)
    assert!(
        !snapshot.content.starts_with('['),
        "Snapshot should not be JSON array"
    );
    assert!(
        !snapshot.content.contains("\"detailed_instructions\""),
        "Snapshot should not contain JSON field names"
    );
}

// =============================================================================
// Test 4: approval rejection artifact snapshot
// =============================================================================

#[test]
fn test_approval_rejection_artifact_snapshot() {
    // Two-stage workflow: planning → work.
    // The work agent can reject back to planning (previous stage).
    let workflow = WorkflowConfig::new(vec![
        StageConfig::new("planning", "plan")
            .with_prompt("planner.md")
            .with_gate(GateConfig::Agentic),
        StageConfig::new("work", "summary")
            .with_prompt("worker.md")
            .with_gate(GateConfig::Agentic),
    ]);
    let ctx = TestEnv::with_git(&workflow, &["planner", "worker"]);

    let task = ctx.create_task(
        "Rejection snapshot",
        "Test approval rejection snapshot",
        None,
    );
    let task_id = task.id.clone();

    // Advance through planning stage
    ctx.set_output(
        &task_id,
        MockAgentOutput::Artifact {
            name: "plan".to_string(),
            content: "Plan for implementation".to_string(),
            activity_log: None,
            resources: vec![],
        },
    );
    ctx.advance(); // spawn planner
    ctx.advance(); // process plan → AwaitingApproval
    ctx.api().approve(&task_id).expect("approve planning");
    ctx.advance(); // commit pipeline → advance to work

    // Work agent produces a reject decision
    ctx.set_output(
        &task_id,
        MockAgentOutput::Approval {
            decision: "reject".to_string(),
            content: "Needs more work on edge cases".to_string(),
            activity_log: None,
            resources: vec![],
        },
    );
    ctx.advance(); // spawn work agent
    ctx.advance(); // process rejection output

    let task = ctx.api().get_task(&task_id).unwrap();
    assert!(
        matches!(task.state, TaskState::AwaitingRejectionConfirmation { .. }),
        "Task should be awaiting rejection confirmation, got: {:?}",
        task.state
    );

    // The work iteration should have a snapshot with the rejection content
    let iterations = ctx.api().get_iterations(&task_id).unwrap();
    let work_iter = iterations
        .iter()
        .find(|i| i.stage == "work")
        .expect("Should have work iteration");

    let snapshot = work_iter
        .artifact_snapshot
        .as_ref()
        .expect("Work iteration should have artifact_snapshot");
    assert_eq!(snapshot.content, "Needs more work on edge cases");
}

// =============================================================================
// Test 5: chat-mode completion stores artifact snapshot
// =============================================================================

#[test]
fn test_chat_completion_artifact_snapshot() {
    let workflow = approval_workflow();
    let ctx = TestEnv::with_git(&workflow, &["worker"]);

    let task = ctx.create_task("Chat completion snapshot", "Test chat snapshot", None);
    let task_id = task.id.clone();

    // Advance to AwaitingApproval via normal path
    advance_to_awaiting_approval(&ctx, &task_id, "Work is done.");

    let task = ctx.api().get_task(&task_id).unwrap();
    assert!(task.is_awaiting_review(), "Should be awaiting review");

    // Seed session ID for chat
    seed_session_id(&ctx, &task_id, "work");

    // Detect chat completion with a valid approval JSON
    let approval_json =
        r#"{"type":"approval","decision":"approve","content":"Chat completion content."}"#;
    let detected = ctx
        .api()
        .detect_chat_completion(&task_id, "work", "default", approval_json)
        .expect("detect_chat_completion should not error");

    assert!(detected, "Valid approval JSON should be detected");

    // A ChatCompletion iteration should exist and have a snapshot
    let iterations = ctx.api().get_iterations(&task_id).unwrap();
    let chat_iter = iterations.iter().find(|i| {
        i.stage == "work" && matches!(i.incoming_context, Some(IterationTrigger::ChatCompletion))
    });
    assert!(
        chat_iter.is_some(),
        "Should have a ChatCompletion iteration. Iterations: {iterations:?}"
    );

    let chat_iter = chat_iter.unwrap();
    let snapshot = chat_iter
        .artifact_snapshot
        .as_ref()
        .expect("ChatCompletion iteration should have artifact_snapshot");
    assert_eq!(snapshot.content, "Chat completion content.");
}

// =============================================================================
// Test 6: log entries tagged with iteration_id
// =============================================================================

#[test]
fn test_log_entries_tagged_with_iteration_id() {
    let workflow = approval_workflow();
    let ctx = TestEnv::with_git(&workflow, &["worker"]);

    let task = ctx.create_task("Log iteration tag test", "Test log iteration_id", None);
    let task_id = task.id.clone();

    advance_to_awaiting_approval(&ctx, &task_id, "Done.");

    // Get the stage session for the work stage
    let session = ctx
        .api()
        .get_stage_session(&task_id, "work")
        .unwrap()
        .expect("Stage session should exist");
    let session_id = session.id.clone();

    // Get the iteration for the work stage
    let iterations = ctx.api().get_iterations(&task_id).unwrap();
    let work_iter = iterations
        .iter()
        .find(|i| i.stage == "work")
        .expect("Should have work iteration");
    let iteration_id = work_iter.id.clone();

    // Open DB directly to access get_annotated_log_entries
    let store = open_store(&ctx);
    let annotated = store
        .get_annotated_log_entries(&session_id)
        .expect("get_annotated_log_entries should succeed");

    assert!(
        !annotated.is_empty(),
        "Should have log entries for the session"
    );

    // All entries should have the iteration_id set
    for entry in &annotated {
        assert_eq!(
            entry.iteration_id.as_deref(),
            Some(iteration_id.as_str()),
            "Log entry should be tagged with iteration_id {iteration_id}. Entry: {:?}",
            entry.entry
        );
    }
}

// =============================================================================
// Test 7: chat log entries have no iteration_id
// =============================================================================

#[test]
fn test_chat_log_entries_have_no_iteration_id() {
    let workflow = approval_workflow();
    let ctx = TestEnv::with_git(&workflow, &["worker"]);

    let task = ctx.create_task(
        "Chat log no iteration",
        "Test chat log no iteration_id",
        None,
    );
    let task_id = task.id.clone();

    advance_to_awaiting_approval(&ctx, &task_id, "Work is done.");

    // Seed session ID before chatting
    seed_session_id(&ctx, &task_id, "work");

    // Get the session before sending a chat message
    let session = ctx
        .api()
        .get_stage_session(&task_id, "work")
        .unwrap()
        .expect("Stage session should exist");
    let session_id = session.id.clone();

    // Get annotated log entries written during the agent spawn (should have iteration_id)
    let store = open_store(&ctx);
    let entries_before_chat = store
        .get_annotated_log_entries(&session_id)
        .expect("get_annotated_log_entries should succeed");

    // Send a chat message — writes log entry with iteration_id=None
    ctx.api()
        .send_chat_message(&task_id, "How is the work going?")
        .expect("send_chat_message should succeed");

    // Get annotated log entries again
    let entries_after_chat = store
        .get_annotated_log_entries(&session_id)
        .expect("get_annotated_log_entries should succeed");

    // There should be more entries now (the chat message was logged)
    assert!(
        entries_after_chat.len() > entries_before_chat.len(),
        "Should have more entries after chat message"
    );

    // Find the UserMessage entry (chat message)
    let chat_entry = entries_after_chat.iter().find(|e| {
        matches!(
            &e.entry,
            LogEntry::UserMessage { resume_type, .. } if resume_type == "chat"
        )
    });
    assert!(
        chat_entry.is_some(),
        "Should have a UserMessage entry for the chat. Entries: {entries_after_chat:?}"
    );

    let chat_entry = chat_entry.unwrap();
    assert!(
        chat_entry.iteration_id.is_none(),
        "Chat UserMessage log entry should have no iteration_id, got: {:?}",
        chat_entry.iteration_id
    );
}
