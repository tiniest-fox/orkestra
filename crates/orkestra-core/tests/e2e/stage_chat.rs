//! E2E tests for stage chat: `send_message`, `return_to_work`, and approve after chat.
//!
//! These tests verify that stage chat correctly sets chat state and logs
//! messages, that `return_to_work` transitions the task back to Queued with
//! the `ReturnToWork` iteration trigger, and that the system detects structured
//! output in chat text and completes the stage autonomously.

use orkestra_core::{
    adapters::sqlite::DatabaseConnection,
    workflow::{
        config::{GateConfig, StageConfig, WorkflowConfig},
        domain::{IterationTrigger, LogEntry, StageSession},
        ports::WorkflowStore,
        runtime::TaskState,
        SqliteWorkflowStore,
    },
};
use std::sync::Arc;

use crate::helpers::{MockAgentOutput, TestEnv};

// =============================================================================
// Test helpers
// =============================================================================

/// Single-stage workflow with approval: task enters `AwaitingApproval` after 2 advances.
fn chat_test_workflow() -> WorkflowConfig {
    WorkflowConfig::new(vec![StageConfig::new("work", "summary")
        .with_prompt("worker.md")
        .with_gate(GateConfig::Agentic)])
}

/// Save a `StageSession` directly to the database (bypassing `WorkflowApi`'s private store).
///
/// Used in tests that simulate Interrupted state via `agent_started()` + `interrupt()`.
/// Those calls transition task state but do NOT create a `StageSession` (which is only
/// created by `on_spawn_starting` during an actual orchestrator spawn). Tests that call
/// `send_chat_message()` or `return_to_work()` after `interrupt()` need a session to exist.
fn save_session_for_test(ctx: &TestEnv, task_id: &str, stage: &str, session_id: &str) {
    let db_path = ctx.temp_dir().join(".orkestra/.database/orkestra.db");
    let conn = DatabaseConnection::open(&db_path).expect("open db");
    let store: Arc<dyn WorkflowStore> = Arc::new(SqliteWorkflowStore::new(conn.shared()));
    let now = chrono::Utc::now().to_rfc3339();
    let mut session = StageSession::new(session_id, task_id, stage, &now);
    // Mark session as having produced activity so `on_spawn_starting` computes `is_resume=true`.
    // Without this, `is_resume=false` → fresh spawn prompt instead of the ReturnToWork resume
    // prompt. `claude_session_id` mirrors what a real provider would record after a spawn.
    session.claude_session_id = Some(session_id.to_string());
    session.has_activity = true;
    store.save_stage_session(&session).expect("save session");
}

/// Directly set `chat_active = true` and a fake `agent_pid` on an existing stage session.
///
/// Bypasses `send_chat_message` to avoid the race condition where the mock `cat` process
/// exits immediately and the background reader clears `chat_active` via
/// `clear_agent_pid_for_session` before the test can assert the pre-recovery state.
fn seed_active_chat(ctx: &TestEnv, task_id: &str, stage: &str, fake_pid: u32) {
    let db_path = ctx.temp_dir().join(".orkestra/.database/orkestra.db");
    let conn = DatabaseConnection::open(&db_path).expect("open db");
    let store: Arc<dyn WorkflowStore> = Arc::new(SqliteWorkflowStore::new(conn.shared()));
    let now = chrono::Utc::now().to_rfc3339();
    let mut session = store
        .get_stage_session(task_id, stage)
        .expect("store op succeeds")
        .expect("session should exist before seeding active chat");
    session.enter_chat(&now);
    session.agent_spawned(fake_pid, &now);
    store
        .save_stage_session(&session)
        .expect("save session with active chat");
}

/// Seed a fake `claude_session_id` on the stage session so `send_chat_message` can resume.
///
/// Mock agents don't emit `SessionId` events, so `claude_session_id` is always `None`
/// after `advance_to_awaiting_approval`. Chat requires a session ID for `--resume`,
/// so tests must inject one before calling `send_chat_message`.
fn seed_session_id(ctx: &TestEnv, task_id: &str, stage: &str) {
    ctx.api()
        .set_session_id(task_id, stage, "test-session-id")
        .expect("seed claude_session_id");
}

/// Advance a task to `AwaitingApproval` in the "work" stage.
///
/// Sets a mock "summary" artifact, then advances twice:
/// - First advance: spawns the "work" agent (completion ready immediately)
/// - Second advance: processes the artifact output → `AwaitingApproval`
fn advance_to_awaiting_approval(ctx: &TestEnv, task_id: &str) {
    ctx.set_output(
        task_id,
        MockAgentOutput::Artifact {
            name: "summary".to_string(),
            content: "Work is done.".to_string(),
            activity_log: None,
            resources: vec![],
        },
    );
    ctx.advance(); // spawn agent → completion ready
    ctx.advance(); // process output → AwaitingApproval
}

// =============================================================================
// Test: send_message enters chat mode
// =============================================================================

#[test]
fn test_send_message_enters_chat_mode_during_awaiting_approval() {
    let workflow = chat_test_workflow();
    let ctx = TestEnv::with_git(&workflow, &["worker"]);

    // Create task and advance to AwaitingApproval
    let task = ctx.create_task("Chat test", "Test chat during review", None);
    let task_id = task.id.clone();

    advance_to_awaiting_approval(&ctx, &task_id);

    // Verify we're in AwaitingApproval
    let task = ctx.api().get_task(&task_id).unwrap();
    assert!(
        task.is_awaiting_review(),
        "Task should be awaiting review, got: {:?}",
        task.state
    );
    assert_eq!(task.current_stage(), Some("work"));

    // Verify session exists before chatting
    let session = ctx
        .api()
        .get_stage_session(&task_id, "work")
        .unwrap()
        .expect("Session should exist");
    assert!(
        !session.chat_active,
        "chat_active should be false initially"
    );

    // Inject a session ID so send_chat_message can resume (mock agents don't emit SessionId events)
    seed_session_id(&ctx, &task_id, "work");

    // Send a chat message via the public WorkflowApi
    ctx.api()
        .send_chat_message(&task_id, "How is the review going?")
        .expect("send_chat_message should succeed");

    // Verify: chat_active is now true
    let session = ctx
        .api()
        .get_stage_session(&task_id, "work")
        .unwrap()
        .expect("Session should still exist");
    assert!(
        session.chat_active,
        "chat_active should be true after first message"
    );

    // Verify: UserMessage log entry stored with resume_type "chat"
    let (logs, _cursor) = ctx
        .api()
        .get_task_logs(&task_id, Some("work"), None, None)
        .unwrap();
    let has_user_message = logs.iter().any(|e| {
        matches!(
            e,
            LogEntry::UserMessage { resume_type, content }
                if resume_type == "chat" && content == "How is the review going?"
        )
    });
    assert!(
        has_user_message,
        "UserMessage with resume_type='chat' should be in logs. Got: {logs:?}"
    );
}

// =============================================================================
// Test: return_to_work creates iteration with ReturnToWork trigger
// =============================================================================

#[test]
fn test_return_to_work_transitions_to_queued_with_trigger() {
    let workflow = chat_test_workflow();
    let ctx = TestEnv::with_git(&workflow, &["worker"]);

    let task = ctx.create_task("Return to work test", "Test return_to_work", None);
    let task_id = task.id.clone();

    advance_to_awaiting_approval(&ctx, &task_id);

    // Inject a session ID so send_chat_message can resume (mock agents don't emit SessionId events)
    seed_session_id(&ctx, &task_id, "work");

    // Enter chat mode by sending a message via the public WorkflowApi
    ctx.api()
        .send_chat_message(&task_id, "Let me ask you something.")
        .expect("send_chat_message should succeed");

    // Verify chat_active is true
    let session = ctx
        .api()
        .get_stage_session(&task_id, "work")
        .unwrap()
        .expect("Session should exist");
    let session_id = session.id.clone();
    assert!(session.chat_active);

    // Return to work
    let task = ctx
        .api()
        .return_to_work(&task_id, None)
        .expect("return_to_work should succeed");

    // Verify: task is now Queued
    assert!(
        matches!(task.state, TaskState::Queued { .. }),
        "Task should be Queued after return_to_work, got: {:?}",
        task.state
    );
    assert_eq!(
        task.current_stage(),
        Some("work"),
        "Stage should still be work"
    );

    // Verify: chat_active is cleared on session
    let session = ctx
        .api()
        .get_stage_session(&task_id, "work")
        .unwrap()
        .expect("Session should still exist");
    assert!(
        !session.chat_active,
        "chat_active should be false after return_to_work"
    );
    assert_eq!(
        session.id, session_id,
        "Session ID should be unchanged (not superseded)"
    );

    // Verify: new iteration created with ReturnToWork trigger
    let iterations = ctx.api().get_iterations(&task_id).unwrap();
    let return_iteration = iterations.iter().find(|i| {
        i.stage == "work"
            && matches!(
                i.incoming_context,
                Some(IterationTrigger::ReturnToWork { .. })
            )
    });
    assert!(
        return_iteration.is_some(),
        "Should have a ReturnToWork iteration in work stage. Iterations: {iterations:?}"
    );
}

// =============================================================================
// Test: orchestrator resumes after return_to_work
// =============================================================================

#[test]
fn test_orchestrator_picks_up_after_return_to_work() {
    let workflow = chat_test_workflow();
    let ctx = TestEnv::with_git(&workflow, &["worker"]);

    let task = ctx.create_task("Resume after chat", "Test agent resumes", None);
    let task_id = task.id.clone();

    advance_to_awaiting_approval(&ctx, &task_id);

    // Return to work without entering chat (simpler path)
    let _task = ctx
        .api()
        .return_to_work(&task_id, None)
        .expect("return_to_work should succeed");

    // Orchestrator should pick up the Queued task and spawn the agent again
    ctx.set_output(
        &task_id,
        MockAgentOutput::Artifact {
            name: "summary".to_string(),
            content: "Done after return to work.".to_string(),
            activity_log: None,
            resources: vec![],
        },
    );
    ctx.advance(); // spawn work agent (with ReturnToWork resume prompt)
    ctx.advance(); // process artifact output

    // Verify a ReturnToWork resume prompt was used
    ctx.assert_resume_prompt_contains("return_to_work", &["structured output", "done chatting"]);
}

// =============================================================================
// Test: approve succeeds even when chat_active is true
// =============================================================================

#[test]
fn test_approve_succeeds_when_chatting() {
    let workflow = chat_test_workflow();
    let ctx = TestEnv::with_git(&workflow, &["worker"]);

    let task = ctx.create_task("Approve while chatting", "Test approve + chat", None);
    let task_id = task.id.clone();

    advance_to_awaiting_approval(&ctx, &task_id);

    // Inject a session ID so send_chat_message can resume (mock agents don't emit SessionId events)
    seed_session_id(&ctx, &task_id, "work");

    // Enter chat mode via the public WorkflowApi
    ctx.api()
        .send_chat_message(&task_id, "Quick question before approving.")
        .expect("send_chat_message should succeed");

    let session = ctx
        .api()
        .get_stage_session(&task_id, "work")
        .unwrap()
        .unwrap();
    assert!(session.chat_active, "Should be chatting");

    // Approve — should succeed even with chat_active
    let task = ctx
        .api()
        .approve(&task_id)
        .expect("approve should succeed even when chatting");

    // Task should no longer be awaiting review
    assert!(
        !task.is_awaiting_review(),
        "Task should no longer be awaiting review after approval"
    );
}

// =============================================================================
// Test: send_message works during Interrupted phase
// =============================================================================

#[test]
fn test_send_message_during_interrupted() {
    let workflow = chat_test_workflow();
    let ctx = TestEnv::with_git(&workflow, &["worker"]);

    let task = ctx.create_task(
        "Interrupted chat test",
        "Test chat during interrupted",
        None,
    );
    let task_id = task.id.clone();

    // Simulate agent starting, then being interrupted.
    // Save a session first because agent_started() transitions task state to AgentWorking
    // but does NOT create a StageSession (on_spawn_starting never ran during a real spawn).
    // send_chat_message() requires an existing session, so we create one to mirror what the
    // orchestrator would do.
    save_session_for_test(&ctx, &task_id, "work", "interrupted-chat-session");
    ctx.api().agent_started(&task_id).unwrap();
    let task = ctx.api().interrupt(&task_id).unwrap();
    assert!(
        matches!(task.state, TaskState::Interrupted { .. }),
        "Task should be Interrupted, got: {:?}",
        task.state
    );

    // Send a chat message while interrupted via the public WorkflowApi
    ctx.api()
        .send_chat_message(&task_id, "Why did you stop?")
        .expect("send_chat_message should succeed during Interrupted phase");

    // Verify chat_active is true
    let session = ctx
        .api()
        .get_stage_session(&task_id, "work")
        .unwrap()
        .expect("Session should exist");
    assert!(
        session.chat_active,
        "chat_active should be true after message during Interrupted"
    );

    // Note: is_chatting is derived from chat_active; derivation is unit-tested in task_view.rs.
    // We can't assert is_chatting=true here via list_task_views() because the mock cat process
    // exits immediately and the background reader thread clears chat_active before the view
    // query can observe it. The chat_active=true assertion above is the authoritative check.

    // Verify log entry with resume_type "chat"
    let (logs, _cursor) = ctx
        .api()
        .get_task_logs(&task_id, Some("work"), None, None)
        .unwrap();
    let has_user_message = logs.iter().any(|e| {
        matches!(
            e,
            LogEntry::UserMessage { resume_type, content }
                if resume_type == "chat" && content == "Why did you stop?"
        )
    });
    assert!(
        has_user_message,
        "UserMessage with resume_type='chat' should be in logs. Got: {logs:?}"
    );
}

// =============================================================================
// Test: startup recovery clears stale chat_active
// =============================================================================

#[test]
fn test_recover_stale_chat_at_startup() {
    let workflow = chat_test_workflow();
    let ctx = TestEnv::with_git(&workflow, &["worker"]);

    let task = ctx.create_task(
        "Stale chat recovery",
        "Test stale chat cleared on startup",
        None,
    );
    let task_id = task.id.clone();

    // Advance to AwaitingApproval, then directly seed chat_active=true with a fake agent_pid.
    // Using send_chat_message here would race: the mock `cat` process exits immediately and
    // the background reader clears chat_active via clear_agent_pid_for_session before we can
    // assert the pre-recovery state.
    advance_to_awaiting_approval(&ctx, &task_id);
    seed_active_chat(&ctx, &task_id, "work", 99999);

    // Verify chat_active is true (no background thread race — we seeded it directly)
    let session = ctx
        .api()
        .get_stage_session(&task_id, "work")
        .unwrap()
        .expect("Session should exist");
    assert!(
        session.chat_active,
        "chat_active should be true before recovery"
    );

    // Simulate app restart via startup recovery
    ctx.run_startup_recovery();

    // Verify chat_active is cleared
    let session = ctx
        .api()
        .get_stage_session(&task_id, "work")
        .unwrap()
        .expect("Session should still exist after recovery");
    assert!(
        !session.chat_active,
        "chat_active should be false after startup recovery"
    );
    assert_eq!(
        session.agent_pid, None,
        "agent_pid should be None after startup recovery"
    );
}

// =============================================================================
// Test: return_to_work from Interrupted phase
// =============================================================================

#[test]
fn test_return_to_work_from_interrupted() {
    let workflow = chat_test_workflow();
    let ctx = TestEnv::with_git(&workflow, &["worker"]);

    let task = ctx.create_task(
        "Return to work from interrupted",
        "Test return_to_work from Interrupted state",
        None,
    );
    let task_id = task.id.clone();

    // Simulate agent starting, then being interrupted.
    // Save a session first because agent_started() sets task state but does not create a
    // StageSession (on_spawn_starting never ran during a real spawn).
    save_session_for_test(&ctx, &task_id, "work", "interrupted-return-session");
    ctx.api().agent_started(&task_id).unwrap();
    ctx.api().interrupt(&task_id).unwrap();

    // Enter chat mode while interrupted via the public WorkflowApi
    ctx.api()
        .send_chat_message(&task_id, "Let me clarify the requirements.")
        .expect("send_chat_message should succeed");
    let session = ctx
        .api()
        .get_stage_session(&task_id, "work")
        .unwrap()
        .expect("Session should exist");
    assert!(session.chat_active, "Should be in chat mode");

    // Return to work
    let task = ctx
        .api()
        .return_to_work(&task_id, None)
        .expect("return_to_work should succeed from Interrupted");

    // Verify task is Queued
    assert!(
        matches!(task.state, TaskState::Queued { .. }),
        "Task should be Queued after return_to_work from Interrupted, got: {:?}",
        task.state
    );

    // Verify chat_active is cleared
    let session = ctx
        .api()
        .get_stage_session(&task_id, "work")
        .unwrap()
        .expect("Session should still exist");
    assert!(
        !session.chat_active,
        "chat_active should be false after return_to_work"
    );

    // Verify ReturnToWork iteration was created
    let iterations = ctx.api().get_iterations(&task_id).unwrap();
    let return_iteration = iterations.iter().find(|i| {
        i.stage == "work"
            && matches!(
                i.incoming_context,
                Some(IterationTrigger::ReturnToWork { .. })
            )
    });
    assert!(
        return_iteration.is_some(),
        "Should have a ReturnToWork iteration. Iterations: {iterations:?}"
    );

    // Advance orchestrator — agent resumes with return_to_work prompt
    ctx.set_output(
        &task_id,
        MockAgentOutput::Artifact {
            name: "summary".to_string(),
            content: "Completed after returning from chat.".to_string(),
            activity_log: None,
            resources: vec![],
        },
    );
    ctx.advance(); // spawn agent with ReturnToWork resume prompt
    ctx.advance(); // process artifact output → AwaitingApproval

    ctx.assert_resume_prompt_contains("return_to_work", &["structured output", "done chatting"]);
}

// =============================================================================
// Test: return_to_work resumes session even without has_activity
// =============================================================================

#[test]
fn test_return_to_work_resumes_without_has_activity() {
    // Reproduces the bug: agent was interrupted before producing structured output
    // (has_activity=false), user chatted, then clicked Return to Work. Before the
    // fix, this would spawn fresh with the initial prompt instead of resuming.
    let workflow = chat_test_workflow();
    let ctx = TestEnv::with_git(&workflow, &["worker"]);

    let task = ctx.create_task(
        "Resume without activity",
        "Test return_to_work resumes when has_activity is false",
        None,
    );
    let task_id = task.id.clone();

    // Create session WITHOUT has_activity — simulates an agent that was interrupted
    // before producing structured output. The agent streamed log lines (visible in UI)
    // but never completed, so persist_activity_flag was never called.
    let db_path = ctx.temp_dir().join(".orkestra/.database/orkestra.db");
    let conn =
        orkestra_core::adapters::sqlite::DatabaseConnection::open(&db_path).expect("open db");
    let store: std::sync::Arc<dyn orkestra_core::workflow::ports::WorkflowStore> =
        std::sync::Arc::new(orkestra_core::workflow::SqliteWorkflowStore::new(
            conn.shared(),
        ));
    let now = chrono::Utc::now().to_rfc3339();
    let mut session = StageSession::new("no-activity-session", &task_id, "work", &now);
    session.claude_session_id = Some("no-activity-session".to_string());
    session.has_activity = false; // Key: agent was interrupted before completion
    store.save_stage_session(&session).expect("save session");

    ctx.api().agent_started(&task_id).unwrap();
    ctx.api().interrupt(&task_id).unwrap();

    // Chat while interrupted
    ctx.api()
        .send_chat_message(&task_id, "This is totally wrong, just submit a rejection")
        .expect("send_chat_message should succeed");

    // Return to work
    ctx.api()
        .return_to_work(&task_id, None)
        .expect("return_to_work should succeed");

    // Advance orchestrator — should resume with return_to_work prompt, NOT fresh initial prompt
    ctx.set_output(
        &task_id,
        MockAgentOutput::Artifact {
            name: "summary".to_string(),
            content: "Done after returning from chat.".to_string(),
            activity_log: None,
            resources: vec![],
        },
    );
    ctx.advance(); // spawn agent
    ctx.advance(); // process output

    // Verify the resume prompt was used (not the initial prompt)
    ctx.assert_resume_prompt_contains("return_to_work", &["structured output", "done chatting"]);
}

// =============================================================================
// Tests: chat structured output detection
// =============================================================================

/// Valid approval JSON for the `chat_test_workflow` schema (which uses `with_approval`).
///
/// The schema has type enum: `["approval", "failed", "blocked"]`.
const VALID_APPROVAL_JSON: &str =
    r#"{"type":"approval","decision":"approve","content":"The implementation looks great."}"#;

const VALID_FAILED_JSON: &str = r#"{"type":"failed","error":"Something went wrong."}"#;

const VALID_APPROVAL_WITH_ACTIVITY_LOG_JSON: &str = r#"{"type":"approval","decision":"approve","content":"Looks good.","activity_log":"- Reviewed implementation\n- Found no issues"}"#;

// =============================================================================
// Test: valid JSON in chat output transitions task to AwaitingApproval
// =============================================================================

#[test]
fn test_chat_structured_output_completes_stage() {
    let workflow = chat_test_workflow();
    let ctx = TestEnv::with_git(&workflow, &["worker"]);

    let task = ctx.create_task(
        "Chat completion test",
        "Test structured output detection",
        None,
    );
    let task_id = task.id.clone();

    advance_to_awaiting_approval(&ctx, &task_id);

    // Verify we're in AwaitingApproval
    let task = ctx.api().get_task(&task_id).unwrap();
    assert!(task.is_awaiting_review(), "Task should be awaiting review");

    // Simulate the detection path: valid JSON in accumulated chat text
    let detected = ctx
        .api()
        .detect_chat_completion(&task_id, "work", "default", VALID_APPROVAL_JSON)
        .expect("detection should not error");

    assert!(detected, "Valid approval JSON should be detected");

    // Task should be AwaitingApproval — approval via chat stores the verdict but still
    // requires a human confirmation step (same as when the agent produces Approval { approve }).
    let task = ctx.api().get_task(&task_id).unwrap();
    assert!(
        matches!(task.state, TaskState::AwaitingApproval { .. }),
        "Task should be AwaitingApproval after approval via chat, got: {:?}",
        task.state
    );

    // A ChatCompletion iteration should exist
    let iterations = ctx.api().get_iterations(&task_id).unwrap();
    let chat_iter = iterations.iter().find(|i| {
        i.stage == "work" && matches!(i.incoming_context, Some(IterationTrigger::ChatCompletion))
    });
    assert!(
        chat_iter.is_some(),
        "Should have a ChatCompletion iteration. Iterations: {iterations:?}"
    );

    // Session chat_active should be false (exit_chat was called)
    let session = ctx
        .api()
        .get_stage_session(&task_id, "work")
        .unwrap()
        .expect("Session should exist");
    assert!(
        !session.chat_active,
        "chat_active should be false after completion"
    );
}

// =============================================================================
// Test: invalid JSON is silently ignored
// =============================================================================

#[test]
fn test_chat_invalid_json_silently_ignored() {
    let workflow = chat_test_workflow();
    let ctx = TestEnv::with_git(&workflow, &["worker"]);

    let task = ctx.create_task(
        "Invalid JSON test",
        "Test that invalid JSON is ignored",
        None,
    );
    let task_id = task.id.clone();

    advance_to_awaiting_approval(&ctx, &task_id);

    let detected = ctx
        .api()
        .detect_chat_completion(&task_id, "work", "default", "this is not json at all")
        .expect("detection should not error");

    assert!(
        !detected,
        "Plain text should not be detected as structured output"
    );

    // State should be unchanged
    let task = ctx.api().get_task(&task_id).unwrap();
    assert!(
        task.is_awaiting_review(),
        "Task state should be unchanged after non-JSON chat"
    );
}

// =============================================================================
// Test: JSON with wrong schema is silently ignored
// =============================================================================

#[test]
fn test_chat_wrong_schema_json_silently_ignored() {
    let workflow = chat_test_workflow();
    let ctx = TestEnv::with_git(&workflow, &["worker"]);

    let task = ctx.create_task(
        "Wrong schema test",
        "Test that wrong schema JSON is ignored",
        None,
    );
    let task_id = task.id.clone();

    advance_to_awaiting_approval(&ctx, &task_id);

    // JSON that is valid JSON but doesn't match the stage schema (wrong type value)
    let detected = ctx
        .api()
        .detect_chat_completion(
            &task_id,
            "work",
            "default",
            r#"{"type":"unknown_type","content":"something"}"#,
        )
        .expect("detection should not error");

    assert!(!detected, "JSON with wrong type should not be detected");
}

// =============================================================================
// Test: detection works during Interrupted phase
// =============================================================================

#[test]
fn test_chat_structured_output_during_interrupted() {
    let workflow = chat_test_workflow();
    let ctx = TestEnv::with_git(&workflow, &["worker"]);

    let task = ctx.create_task(
        "Interrupted detection test",
        "Test structured output detection during interrupted state",
        None,
    );
    let task_id = task.id.clone();

    // Simulate interrupted state
    save_session_for_test(&ctx, &task_id, "work", "interrupted-detect-session");
    ctx.api().agent_started(&task_id).unwrap();
    let task = ctx.api().interrupt(&task_id).unwrap();
    assert!(
        matches!(task.state, TaskState::Interrupted { .. }),
        "Task should be Interrupted"
    );

    // Detection should work from Interrupted state (can_chat() returns true)
    let detected = ctx
        .api()
        .detect_chat_completion(&task_id, "work", "default", VALID_APPROVAL_JSON)
        .expect("detection should not error");

    assert!(
        detected,
        "Should detect structured output during Interrupted state"
    );

    // A ChatCompletion iteration should have been created
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
// Test: detection skipped if human already approved (race condition guard)
// =============================================================================

#[test]
fn test_chat_detection_skipped_if_already_approved() {
    let workflow = chat_test_workflow();
    let ctx = TestEnv::with_git(&workflow, &["worker"]);

    let task = ctx.create_task(
        "Race condition test",
        "Test that detection is skipped if task is no longer in chat state",
        None,
    );
    let task_id = task.id.clone();

    advance_to_awaiting_approval(&ctx, &task_id);

    // Human approves before detection runs
    ctx.api().approve(&task_id).expect("approve should succeed");

    // The task is no longer in a chat-capable state (can_chat() = false)
    let task = ctx.api().get_task(&task_id).unwrap();
    assert!(
        !task.can_chat(),
        "Task should not be in chat state after approval, got: {:?}",
        task.state
    );

    // Detection should return Ok(false) silently
    let detected = ctx
        .api()
        .detect_chat_completion(&task_id, "work", "default", VALID_APPROVAL_JSON)
        .expect("detection should not error");

    assert!(
        !detected,
        "Detection should be skipped if task is no longer in chat state"
    );
}

// =============================================================================
// Test: agent outputs failed JSON → task transitions to Failed
// =============================================================================

#[test]
fn test_chat_structured_output_failed() {
    let workflow = chat_test_workflow();
    let ctx = TestEnv::with_git(&workflow, &["worker"]);

    let task = ctx.create_task(
        "Failed detection test",
        "Test failed output detection",
        None,
    );
    let task_id = task.id.clone();

    advance_to_awaiting_approval(&ctx, &task_id);

    let detected = ctx
        .api()
        .detect_chat_completion(&task_id, "work", "default", VALID_FAILED_JSON)
        .expect("detection should not error");

    assert!(detected, "Failed JSON should be detected and processed");

    let task = ctx.api().get_task(&task_id).unwrap();
    assert!(
        matches!(task.state, TaskState::Failed { .. }),
        "Task should be Failed after failed output, got: {:?}",
        task.state
    );
}

// =============================================================================
// Test: markdown-fenced JSON is detected
// =============================================================================

#[test]
fn test_chat_markdown_fenced_json_detected() {
    let workflow = chat_test_workflow();
    let ctx = TestEnv::with_git(&workflow, &["worker"]);

    let task = ctx.create_task(
        "Markdown fence test",
        "Test that JSON in markdown fences is detected",
        None,
    );
    let task_id = task.id.clone();

    advance_to_awaiting_approval(&ctx, &task_id);

    // Wrap the JSON in a markdown code fence
    let fenced = format!("```json\n{VALID_APPROVAL_JSON}\n```");

    let detected = ctx
        .api()
        .detect_chat_completion(&task_id, "work", "default", &fenced)
        .expect("detection should not error");

    assert!(detected, "Markdown-fenced JSON should be detected");
}

// =============================================================================
// Test: JSON in prose + fence is detected (mixed text)
// =============================================================================

#[test]
fn test_chat_prose_with_fenced_json_detected() {
    let workflow = chat_test_workflow();
    let ctx = TestEnv::with_git(&workflow, &["worker"]);

    let task = ctx.create_task(
        "Prose and JSON test",
        "Test that JSON embedded in prose is detected",
        None,
    );
    let task_id = task.id.clone();

    advance_to_awaiting_approval(&ctx, &task_id);

    // Mix prose before the fenced JSON
    let mixed = format!(
        "I've reviewed the implementation and it looks good. Here is my structured output:\n\n```json\n{VALID_APPROVAL_JSON}\n```"
    );

    let detected = ctx
        .api()
        .detect_chat_completion(&task_id, "work", "default", &mixed)
        .expect("detection should not error");

    assert!(detected, "JSON embedded in prose should be detected");
}

// =============================================================================
// Test: activity_log in structured output lands on the ChatCompletion iteration
// =============================================================================

#[test]
fn test_chat_structured_output_activity_log_on_correct_iteration() {
    let workflow = chat_test_workflow();
    let ctx = TestEnv::with_git(&workflow, &["worker"]);

    let task = ctx.create_task(
        "Activity log iteration test",
        "Test activity log lands on ChatCompletion iteration",
        None,
    );
    let task_id = task.id.clone();

    advance_to_awaiting_approval(&ctx, &task_id);

    // Detect structured output that includes an activity_log
    let detected = ctx
        .api()
        .detect_chat_completion(
            &task_id,
            "work",
            "default",
            VALID_APPROVAL_WITH_ACTIVITY_LOG_JSON,
        )
        .expect("detection should not error");

    assert!(
        detected,
        "Valid approval JSON with activity_log should be detected"
    );

    // Find the ChatCompletion iteration and verify it has the activity log
    let iterations = ctx.api().get_iterations(&task_id).unwrap();
    let chat_iter = iterations.iter().find(|i| {
        i.stage == "work" && matches!(i.incoming_context, Some(IterationTrigger::ChatCompletion))
    });
    let chat_iter = chat_iter.expect("Should have a ChatCompletion iteration");
    assert_eq!(
        chat_iter.activity_log.as_deref(),
        Some("- Reviewed implementation\n- Found no issues"),
        "Activity log should be on the ChatCompletion iteration, not the previous one"
    );
}

// =============================================================================
// Test: chat detection creates workflow_artifacts row and ArtifactProduced log entry
// =============================================================================

/// Artifact-producing output detected in chat must create a `workflow_artifacts` row
/// and emit an `ArtifactProduced` log entry — the same as the normal agent path.
///
/// Uses a gateless workflow. With `has_approval: true` (agentic gate), the schema drops
/// the artifact type name from its type enum and substitutes "approval", so
/// `{"type":"summary",...}` would be rejected. A gateless stage keeps the artifact
/// type in the enum, letting us exercise the `StageOutput::Artifact` path.
#[test]
fn test_chat_artifact_output_creates_artifact_row_and_log_entry() {
    // Single gateless stage: "summary" stays in the schema type enum.
    let workflow = WorkflowConfig::new(vec![StageConfig::new("work", "summary")
        .with_prompt("worker.md")]);
    let ctx = TestEnv::with_git(&workflow, &["worker"]);

    let task = ctx.create_task(
        "Artifact via chat",
        "Test artifact row + log entry on chat detection",
        None,
    );
    let task_id = task.id.clone();

    // Advance to AwaitingApproval (auto_mode=false keeps the task paused even without a gate).
    ctx.set_output(
        &task_id,
        MockAgentOutput::Artifact {
            name: "summary".to_string(),
            content: "Initial run output.".to_string(),
            activity_log: None,
            resources: vec![],
        },
    );
    ctx.advance(); // spawn agent
    ctx.advance(); // process output → AwaitingApproval

    let task_state = ctx.api().get_task(&task_id).unwrap();
    assert!(
        task_state.is_awaiting_review(),
        "Task should be awaiting review, got: {:?}",
        task_state.state
    );

    let artifacts_before = ctx.api().list_workflow_artifacts(&task_id).unwrap();
    let count_before = artifacts_before.len();

    // Detect a second "summary" artifact through chat.
    let summary_json = r#"{"type":"summary","content":"Implementation is complete."}"#;
    let detected = ctx
        .api()
        .detect_chat_completion(&task_id, "work", "default", summary_json)
        .expect("detection should not error");

    assert!(detected, "Summary artifact JSON should be detected");

    // A new workflow_artifacts row must exist with the chat-produced content.
    let artifacts_after = ctx.api().list_workflow_artifacts(&task_id).unwrap();
    assert_eq!(
        artifacts_after.len(),
        count_before + 1,
        "Should gain exactly one new artifact row from chat detection"
    );

    let chat_artifact = artifacts_after
        .iter()
        .find(|a| a.content == "Implementation is complete.")
        .expect("Should find artifact row with chat-produced content");
    assert_eq!(chat_artifact.task_id, task_id);
    assert_eq!(chat_artifact.stage, "work");
    assert_eq!(chat_artifact.name, "summary");

    // An ArtifactProduced log entry must be emitted on the stage session.
    let (logs, _) = ctx
        .api()
        .get_task_logs(&task_id, Some("work"), None, None)
        .unwrap();
    let has_artifact_produced = logs.iter().any(|e| {
        matches!(e, LogEntry::ArtifactProduced { name, .. } if name == "summary")
    });
    assert!(
        has_artifact_produced,
        "Should have ArtifactProduced log entry for 'summary'. Got: {logs:?}"
    );
}

// =============================================================================
// Test: send_chat_message bumps task updated_at
// =============================================================================

/// Sending a chat message (entering chat mode) must bump the task's `updated_at`
/// so differential sync detects the state change and delivers `is_chatting: true`.
#[test]
fn send_message_bumps_task_updated_at() {
    let ctx = TestEnv::with_git(&chat_test_workflow(), &["worker"]);
    let task = ctx.create_task("Test task", "Description", None);
    let task_id = task.id.clone();

    // Advance to AwaitingApproval
    advance_to_awaiting_approval(&ctx, &task_id);

    // Seed a session ID so send_chat_message can resume
    seed_session_id(&ctx, &task_id, "work");

    // Record updated_at before chat
    let before = ctx.api().get_task(&task_id).unwrap().updated_at;

    // Brief sleep to ensure timestamps differ
    std::thread::sleep(std::time::Duration::from_millis(5));

    // Send a chat message — this should bump updated_at (enters chat mode on first message)
    ctx.api()
        .send_chat_message(&task_id, "Hello agent")
        .unwrap();

    let after = ctx.api().get_task(&task_id).unwrap().updated_at;
    assert_ne!(
        after, before,
        "send_chat_message must bump task updated_at when entering chat mode"
    );
}

// =============================================================================
// Test: chat_active is cleared when agent exits without structured output
// =============================================================================

/// When a chat agent exits without producing valid structured output,
/// `chat_active` must be cleared — not left stale — so approve and
/// return-to-work buttons re-enable on the frontend.
#[test]
fn chat_exit_clears_chat_active_on_exit_without_structured_output() {
    let ctx = TestEnv::with_git(&chat_test_workflow(), &["worker"]);
    let task = ctx.create_task("Chat exit test", "Description", None);
    let task_id = task.id.clone();

    advance_to_awaiting_approval(&ctx, &task_id);
    seed_session_id(&ctx, &task_id, "work");

    // Send a message — spawns a `cat` mock process (via MockProcessSpawner) that
    // echoes the message and exits immediately. chat_active goes true here.
    ctx.api()
        .send_chat_message(&task_id, "Hello agent")
        .unwrap();

    // `send_chat_message` sets chat_active = true and saves the session, then spawns a
    // background reader thread. The mock process (cat) exits immediately when stdin
    // closes, so the background thread may call clear_agent_pid_for_session (which also
    // clears chat_active) before we can observe the true state. We skip asserting the
    // transient true state — verifying it eventually becomes false is sufficient.

    // The mock process (cat) exits immediately after stdin closes.
    // The background reader thread calls clear_agent_pid_for_session which clears
    // chat_active. Poll until it clears (up to ~500ms).
    let cleared = (0..50).any(|_| {
        std::thread::sleep(std::time::Duration::from_millis(10));
        ctx.api()
            .get_stage_session(&task_id, "work")
            .unwrap()
            .is_some_and(|s| !s.chat_active)
    });

    assert!(
        cleared,
        "chat_active should be false after chat agent exits without structured output"
    );
}
