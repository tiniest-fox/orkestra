//! E2E tests for artifact storage in `workflow_artifacts` table and `ArtifactProduced` log entries.
//!
//! Covers:
//! - Artifacts stored in `workflow_artifacts` table for artifact, subtask, and approval outputs
//! - Rejection path does NOT write to `workflow_artifacts` table
//! - `ArtifactProduced` log entries emitted after artifact-producing handlers
//! - No `ArtifactProduced` for failed output
//! - Iteration ID tagged on `ArtifactProduced` log entries
//! - Chat-mode completion stores artifact via `dispatch_output`
//! - Log entries tagged with `iteration_id` for normal agent runs
//! - Chat-mode log entries having no `iteration_id` (None)

use orkestra_core::{
    adapters::sqlite::DatabaseConnection,
    workflow::{
        config::{StageCapabilities, StageConfig, WorkflowConfig},
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
        .with_capabilities(StageCapabilities::with_approval(None))])
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
// Test 1: artifact stored in workflow_artifacts table on normal iteration
// =============================================================================

#[test]
fn test_artifact_stored_in_artifacts_table() {
    let workflow = approval_workflow();
    let ctx = TestEnv::with_git(&workflow, &["worker"]);

    let task = ctx.create_task("Artifact table test", "Test artifact in table", None);
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

    // Artifact stored in workflow_artifacts table
    let store = open_store(&ctx);
    let stored = store
        .get_artifact(&task_id, "summary")
        .expect("get_artifact should succeed");
    assert!(stored.is_some(), "Expected artifact in workflow_artifacts");
    let stored = stored.unwrap();
    assert_eq!(stored.content, "The plan content");
    assert_eq!(stored.stage, "work");
    assert!(stored.html.is_some(), "Expected pre-rendered HTML");
}

// =============================================================================
// Test 2: ArtifactProduced log entry appears after agent completion
// =============================================================================

#[test]
fn test_artifact_produced_log_entry_on_completion() {
    let workflow = approval_workflow();
    let ctx = TestEnv::with_git(&workflow, &["worker"]);

    let task = ctx.create_task("Log entry test", "Test artifact log entry", None);
    let task_id = task.id.clone();

    advance_to_awaiting_approval(&ctx, &task_id, "Plan content");

    let store = open_store(&ctx);
    let session = store
        .get_stage_session(&task_id, "work")
        .expect("get_stage_session")
        .expect("session should exist");
    let entries = store.get_log_entries(&session.id).expect("get_log_entries");

    let artifact_entry = entries
        .iter()
        .find(|e| matches!(e, LogEntry::ArtifactProduced { .. }));
    assert!(
        artifact_entry.is_some(),
        "Expected ArtifactProduced log entry. Entries: {entries:?}"
    );

    if let LogEntry::ArtifactProduced { artifact } = artifact_entry.unwrap() {
        assert_eq!(artifact.content, "Plan content");
        assert!(artifact.html.is_some());
        assert_eq!(artifact.stage, "work");
        assert_eq!(artifact.name, "summary");
    }
}

// =============================================================================
// Test 3: ArtifactProduced log entry has iteration_id tagged
// =============================================================================

#[test]
fn test_artifact_produced_has_iteration_id() {
    let workflow = approval_workflow();
    let ctx = TestEnv::with_git(&workflow, &["worker"]);

    let task = ctx.create_task(
        "Iteration id test",
        "Test iteration_id on artifact entry",
        None,
    );
    let task_id = task.id.clone();

    advance_to_awaiting_approval(&ctx, &task_id, "Content");

    let store = open_store(&ctx);
    let session = store
        .get_stage_session(&task_id, "work")
        .expect("get_stage_session")
        .expect("session should exist");

    let annotated = store
        .get_annotated_log_entries(&session.id)
        .expect("get_annotated_log_entries");

    let artifact_entry = annotated
        .iter()
        .find(|e| matches!(e.entry, LogEntry::ArtifactProduced { .. }));
    assert!(
        artifact_entry.is_some(),
        "Expected ArtifactProduced log entry"
    );

    let artifact_entry = artifact_entry.unwrap();
    assert!(
        artifact_entry.iteration_id.is_some(),
        "ArtifactProduced entry should have an iteration_id"
    );
}

// =============================================================================
// Test 4: No ArtifactProduced for failed output
// =============================================================================

#[test]
fn test_no_artifact_produced_for_failed_output() {
    let workflow = approval_workflow();
    let ctx = TestEnv::with_git(&workflow, &["worker"]);

    let task = ctx.create_task("Failed output test", "Test no artifact on failure", None);
    let task_id = task.id.clone();

    ctx.set_output(
        &task_id,
        MockAgentOutput::Failed {
            error: "Agent encountered an error".to_string(),
        },
    );
    ctx.advance(); // spawn agent
    ctx.advance(); // process failed output

    let store = open_store(&ctx);
    let session = store
        .get_stage_session(&task_id, "work")
        .expect("get_stage_session");

    if let Some(session) = session {
        let entries = store.get_log_entries(&session.id).expect("get_log_entries");
        let artifact_entry = entries
            .iter()
            .find(|e| matches!(e, LogEntry::ArtifactProduced { .. }));
        assert!(
            artifact_entry.is_none(),
            "Expected no ArtifactProduced log entry for failed output"
        );
    }

    // Also verify no artifact in table
    let artifacts = store
        .get_artifacts(&task_id)
        .expect("get_artifacts should succeed");
    assert!(
        artifacts.is_empty(),
        "Expected no artifacts in table for failed output"
    );
}

// =============================================================================
// Test 5: rejection path does NOT emit ArtifactProduced
// =============================================================================

#[test]
fn test_no_artifact_produced_for_rejection_output() {
    // Needs an explicit rejection_stage so handle_approval can resolve the target.
    let workflow = WorkflowConfig::new(vec![StageConfig::new("work", "summary")
        .with_prompt("worker.md")
        .with_capabilities(StageCapabilities::with_approval(Some("work".into())))]);
    let ctx = TestEnv::with_git(&workflow, &["worker"]);

    let task = ctx.create_task(
        "Rejection no artifact",
        "Test no artifact on rejection",
        None,
    );
    let task_id = task.id.clone();

    ctx.set_output(
        &task_id,
        MockAgentOutput::Approval {
            decision: "reject".to_string(),
            content: "Needs more work on edge cases".to_string(),
            activity_log: None,
            resources: vec![],
        },
    );
    ctx.advance(); // spawn agent
    ctx.advance(); // process rejection output

    let task = ctx.api().get_task(&task_id).unwrap();
    assert!(
        matches!(task.state, TaskState::AwaitingRejectionConfirmation { .. }),
        "Task should be awaiting rejection confirmation, got: {:?}",
        task.state
    );

    let store = open_store(&ctx);
    let session = store
        .get_stage_session(&task_id, "work")
        .expect("get_stage_session")
        .expect("session should exist");
    let entries = store.get_log_entries(&session.id).expect("get_log_entries");

    let artifact_entry = entries
        .iter()
        .find(|e| matches!(e, LogEntry::ArtifactProduced { .. }));
    assert!(
        artifact_entry.is_none(),
        "Expected no ArtifactProduced log entry for rejection output"
    );

    // Rejection content should NOT be in workflow_artifacts table
    let artifacts = store
        .get_artifacts(&task_id)
        .expect("get_artifacts should succeed");
    assert!(
        artifacts.is_empty(),
        "Expected no artifacts in table for rejection output"
    );
}

// =============================================================================
// Test 6: subtask artifact stored in workflow_artifacts table
// =============================================================================

#[test]
fn test_subtask_artifact_stored_in_artifacts_table() {
    let workflow = workflows::with_subtasks();
    let ctx = TestEnv::with_git(&workflow, &["planner", "breakdown", "worker", "reviewer"]);

    let task = ctx.create_task(
        "Subtask artifact test",
        "Test subtask artifact in table",
        None,
    );
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

    let task_state = ctx.api().get_task(&task_id).unwrap();
    assert!(
        task_state.is_awaiting_review(),
        "Should be awaiting review after breakdown, got: {:?}",
        task_state.state
    );

    let store = open_store(&ctx);

    // The breakdown artifact (primary human-readable, not _structured) should be in table
    let stored = store
        .get_artifact(&task_id, "breakdown")
        .expect("get_artifact should succeed");
    assert!(
        stored.is_some(),
        "Expected breakdown artifact in workflow_artifacts"
    );
    let stored = stored.unwrap();
    assert!(
        stored.content.contains("Technical design overview"),
        "Artifact should contain the design overview"
    );
    assert!(
        stored.content.contains("## Proposed Subtasks"),
        "Artifact should contain subtask markdown heading"
    );
    assert!(stored.html.is_some(), "Expected pre-rendered HTML");

    // The _structured artifact should NOT be in the table (we only emit primary)
    let structured = store
        .get_artifact(&task_id, "breakdown_structured")
        .expect("get_artifact");
    assert!(
        structured.is_none(),
        "Expected no breakdown_structured artifact in table"
    );

    // Verify ArtifactProduced log entry exists for the breakdown session
    let session = store
        .get_stage_session(&task_id, "breakdown")
        .expect("get_stage_session")
        .expect("breakdown session should exist");
    let entries = store.get_log_entries(&session.id).expect("get_log_entries");
    let artifact_entry = entries
        .iter()
        .find(|e| matches!(e, LogEntry::ArtifactProduced { .. }));
    assert!(
        artifact_entry.is_some(),
        "Expected ArtifactProduced log entry in breakdown session"
    );
}

// =============================================================================
// Test 7: chat-mode completion stores artifact in workflow_artifacts table
// =============================================================================

#[test]
fn test_chat_completion_artifact_stored_in_table() {
    let workflow = approval_workflow();
    let ctx = TestEnv::with_git(&workflow, &["worker"]);

    let task = ctx.create_task("Chat completion artifact", "Test chat snapshot", None);
    let task_id = task.id.clone();

    // Advance to AwaitingApproval via normal path
    advance_to_awaiting_approval(&ctx, &task_id, "Work is done.");

    let task_state = ctx.api().get_task(&task_id).unwrap();
    assert!(task_state.is_awaiting_review(), "Should be awaiting review");

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

    // Artifact in workflow_artifacts table should reflect the chat completion content
    let store = open_store(&ctx);
    let stored = store
        .get_artifact(&task_id, "summary")
        .expect("get_artifact should succeed");
    assert!(
        stored.is_some(),
        "Expected artifact in workflow_artifacts after chat completion"
    );
    let stored = stored.unwrap();
    assert_eq!(stored.content, "Chat completion content.");

    // A ChatCompletion iteration should exist
    let iterations = ctx.api().get_iterations(&task_id).unwrap();
    let chat_iter = iterations.iter().find(|i| {
        i.stage == "work" && matches!(i.incoming_context, Some(IterationTrigger::ChatCompletion))
    });
    assert!(
        chat_iter.is_some(),
        "Should have a ChatCompletion iteration. Iterations: {iterations:?}"
    );
}

// =============================================================================
// Test 8: log entries tagged with iteration_id
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
// Test 9: chat log entries have no iteration_id
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
