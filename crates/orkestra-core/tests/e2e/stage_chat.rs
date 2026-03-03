//! E2E tests for stage chat: `send_message`, `return_to_work`, and approve after chat.
//!
//! These tests verify that stage chat correctly sets chat state and logs
//! messages, and that `return_to_work` transitions the task back to Queued with
//! the `ReturnToWork` iteration trigger.

use orkestra_core::{
    adapters::sqlite::DatabaseConnection,
    workflow::{
        config::{StageCapabilities, StageConfig, WorkflowConfig},
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
        .with_capabilities(StageCapabilities::with_approval(None))])
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
    let logs = ctx
        .api()
        .get_task_logs(&task_id, Some("work"), None)
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

    // Verify: DerivedTaskState.is_chatting is true
    let views = ctx.api().list_task_views().unwrap();
    let view = views.iter().find(|v| v.task.id == task_id).unwrap();
    assert!(
        view.derived.is_chatting,
        "DerivedTaskState.is_chatting should be true"
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

    // Verify DerivedTaskState.is_chatting is true
    let views = ctx.api().list_task_views().unwrap();
    let view = views.iter().find(|v| v.task.id == task_id).unwrap();
    assert!(
        view.derived.is_chatting,
        "DerivedTaskState.is_chatting should be true during Interrupted"
    );

    // Verify log entry with resume_type "chat"
    let logs = ctx
        .api()
        .get_task_logs(&task_id, Some("work"), None)
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

    // Advance to AwaitingApproval and enter chat mode
    advance_to_awaiting_approval(&ctx, &task_id);
    seed_session_id(&ctx, &task_id, "work");
    ctx.api()
        .send_chat_message(&task_id, "Quick question.")
        .expect("send_chat_message should succeed");

    // Verify chat_active is true
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
        },
    );
    ctx.advance(); // spawn agent with ReturnToWork resume prompt
    ctx.advance(); // process artifact output → AwaitingApproval

    ctx.assert_resume_prompt_contains("return_to_work", &["structured output", "done chatting"]);
}
