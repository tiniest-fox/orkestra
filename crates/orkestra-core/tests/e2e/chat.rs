//! E2E tests for chat task infrastructure.
//!
//! Tests chat task creation, spawn filtering, promotion to workflow flow,
//! and the atomic create-and-send command.

use std::sync::Arc;

use orkestra_core::adapters::sqlite::DatabaseConnection;
use orkestra_core::workflow::config::{IntegrationConfig, StageConfig, WorkflowConfig};
use orkestra_core::workflow::domain::{LogEntry, TaskCreationMode};
use orkestra_core::workflow::execution::{
    claudecode_aliases, claudecode_capabilities, ProviderRegistry,
};
use orkestra_core::workflow::ports::{
    MockProcessSpawner, ProcessSpawner, WorkflowError, WorkflowStore,
};
use orkestra_core::workflow::runtime::TaskState;
use orkestra_core::workflow::{AssistantService, SqliteWorkflowStore, WorkflowApi};
use tempfile::TempDir;

use crate::helpers::TestEnv;

// =============================================================================
// Helpers
// =============================================================================

fn one_stage_workflow() -> WorkflowConfig {
    WorkflowConfig::new(vec![StageConfig::new("work", "summary")])
        .with_integration(IntegrationConfig::new("work"))
}

fn chat_provider_registry() -> Arc<ProviderRegistry> {
    let mut registry = ProviderRegistry::new("claudecode");
    registry.register(
        "claudecode",
        Arc::new(MockProcessSpawner::new()) as Arc<dyn ProcessSpawner>,
        claudecode_capabilities(),
        claudecode_aliases(),
    );
    Arc::new(registry)
}

/// Create a `WorkflowApi` with `project_root` and `provider_registry` configured,
/// plus a shared store for assertions. Both the API and the store use the same
/// underlying `SQLite` connection.
fn create_chat_api() -> (WorkflowApi, Arc<dyn WorkflowStore>, TempDir) {
    let temp_dir = TempDir::new().expect("temp dir");
    let db_path = temp_dir.path().join("test.db");
    let conn = DatabaseConnection::open(&db_path).expect("open db");

    let store: Arc<dyn WorkflowStore> = Arc::new(SqliteWorkflowStore::new(conn.shared()));

    let api = WorkflowApi::new(
        one_stage_workflow(),
        Arc::new(SqliteWorkflowStore::new(conn.shared())),
    )
    .with_provider_registry(chat_provider_registry())
    .with_project_root(temp_dir.path().to_path_buf());

    (api, store, temp_dir)
}

// =============================================================================
// Chat task creation
// =============================================================================

#[test]
fn test_create_chat_task_has_correct_initial_state() {
    let env = TestEnv::with_workflow(one_stage_workflow());

    let task = env.api().create_chat_task("Chat about X").unwrap();

    assert!(task.is_chat, "chat task must have is_chat=true");
    assert_eq!(task.title, "Chat about X");
    assert!(task.flow.is_empty(), "chat task must have no flow assigned");
    assert!(
        matches!(task.state, TaskState::Queued { ref stage } if stage == "chat"),
        "chat task must start in Queued{{chat}}, got: {:?}",
        task.state
    );
    assert!(
        task.parent_id.is_none(),
        "chat task must be a top-level task"
    );
}

#[test]
fn test_create_chat_task_is_retrievable() {
    let env = TestEnv::with_workflow(one_stage_workflow());

    let task = env.api().create_chat_task("My chat").unwrap();
    let fetched = env.api().get_task(&task.id).unwrap();

    assert_eq!(fetched.id, task.id);
    assert!(fetched.is_chat);
}

// =============================================================================
// Spawn filtering
// =============================================================================

#[test]
fn test_chat_task_not_spawned_by_orchestrator() {
    let env = TestEnv::with_workflow(one_stage_workflow());

    let chat = env.api().create_chat_task("Chat task").unwrap();

    // Multiple advances — orchestrator must never pick up the chat task.
    env.advance();
    env.advance();
    env.advance();

    // Chat task stays in its initial Queued{chat} state (no agent spawned).
    let fetched = env.api().get_task(&chat.id).unwrap();
    assert!(
        matches!(fetched.state, TaskState::Queued { ref stage } if stage == "chat"),
        "chat task must not be picked up by orchestrator, got: {:?}",
        fetched.state
    );

    // No agent calls were made.
    assert_eq!(
        env.call_count(),
        0,
        "orchestrator must not spawn agents for chat tasks"
    );
}

#[test]
fn test_normal_task_is_not_affected_by_chat_task_filter() {
    let env = TestEnv::with_workflow(one_stage_workflow());

    // Create one chat task (stays filtered) and one normal task (should advance).
    // create_task advances once internally for setup, so after this call the normal task
    // has completed setup and is a spawn candidate.
    let chat = env.api().create_chat_task("Chat task").unwrap();
    let normal = env.create_task("Normal task", "desc", None);

    // One more advance: orchestrator spawns an agent for the normal task.
    env.advance();

    // The normal task must have left Queued/AwaitingSetup — orchestrator picked it up.
    let fetched_normal = env.api().get_task(&normal.id).unwrap();
    assert!(
        !matches!(
            fetched_normal.state,
            TaskState::Queued { .. } | TaskState::AwaitingSetup { .. }
        ),
        "normal task must advance past Queued/AwaitingSetup, got: {:?}",
        fetched_normal.state
    );

    // At least one agent call was made for the normal task.
    assert!(
        env.call_count() >= 1,
        "orchestrator must spawn an agent for the normal task"
    );

    // Chat task stays filtered — still in Queued{chat}.
    let fetched_chat = env.api().get_task(&chat.id).unwrap();
    assert!(
        matches!(
            fetched_chat.state,
            TaskState::Queued { ref stage } if stage == "chat"
        ),
        "chat task must remain Queued{{chat}}, got: {:?}",
        fetched_chat.state
    );
}

// =============================================================================
// Promote to flow
// =============================================================================

#[test]
fn test_promote_to_flow_converts_chat_task() {
    let env = TestEnv::with_workflow(one_stage_workflow());

    let chat = env.api().create_chat_task("Ready to promote").unwrap();
    assert!(chat.is_chat);

    let promoted = env.api().promote_to_flow(&chat.id, None).unwrap();

    assert!(!promoted.is_chat, "promoted task must have is_chat=false");
    assert!(!promoted.flow.is_empty(), "promoted task must have a flow");
    assert!(
        matches!(promoted.state, TaskState::AwaitingSetup { .. }),
        "promoted task must enter AwaitingSetup, got: {:?}",
        promoted.state
    );
}

#[test]
fn test_promote_to_flow_rejected_for_non_chat_task() {
    let env = TestEnv::with_workflow(one_stage_workflow());

    // create_task creates a normal (non-chat) task via sync setup.
    let normal_task = env
        .api()
        .create_task_with_options("Normal", "desc", None, TaskCreationMode::Normal, None)
        .unwrap();

    let result = env.api().promote_to_flow(&normal_task.id, None);

    assert!(
        matches!(result, Err(WorkflowError::InvalidTransition(_))),
        "promoting a non-chat task must return InvalidTransition, got: {result:?}"
    );
}

#[test]
fn test_promote_to_flow_task_enters_orchestrator_pipeline() {
    let env = TestEnv::with_workflow(one_stage_workflow());

    let chat = env.api().create_chat_task("Will be promoted").unwrap();
    env.api().promote_to_flow(&chat.id, None).unwrap();

    // Advance to trigger setup (sync setup enabled).
    env.advance();

    let task = env.api().get_task(&chat.id).unwrap();
    assert!(
        !matches!(
            task.state,
            TaskState::AwaitingSetup { .. } | TaskState::SettingUp { .. }
        ),
        "promoted task should have completed setup after one tick, got: {:?}",
        task.state
    );
}

// =============================================================================
// create_and_send_chat_message
// =============================================================================

#[test]
fn test_create_and_send_creates_task_with_message_title() {
    let (api, store, _temp_dir) = create_chat_api();

    let (task, session) = api
        .create_chat_and_send_message("Fix the login page auth error")
        .unwrap();

    // Task must exist in the store and be a chat task.
    let fetched = store.get_task(&task.id).unwrap().expect("task in store");
    assert!(fetched.is_chat, "task must be a chat task");
    assert!(
        fetched.title.contains("login") || fetched.title.contains("Login"),
        "task title must be derived from the message content, got: {:?}",
        fetched.title
    );

    // Session must be task-scoped.
    assert_eq!(
        session.task_id.as_deref(),
        Some(task.id.as_str()),
        "session must reference the created task"
    );

    // User message must be in the session logs.
    let logs = store.get_assistant_log_entries(&session.id).unwrap();
    let has_user_msg = logs.iter().any(|e| {
        matches!(e, LogEntry::UserMessage { content, .. } if content == "Fix the login page auth error")
    });
    assert!(has_user_msg, "user message must be stored in session logs");
}

#[test]
fn test_create_and_send_rejects_empty_message() {
    let (api, _store, _temp_dir) = create_chat_api();

    let result = api.create_chat_and_send_message("");
    assert!(result.is_err(), "empty message must be rejected");

    let result_ws = api.create_chat_and_send_message("   ");
    assert!(
        result_ws.is_err(),
        "whitespace-only message must be rejected"
    );
}

#[test]
fn test_subsequent_messages_reuse_task_session() {
    let (api, store, temp_dir) = create_chat_api();

    let (task, session1) = api
        .create_chat_and_send_message("First message to the chat")
        .unwrap();

    // Send a follow-up message to the same task via AssistantService (same underlying store).
    let service = AssistantService::new(
        Arc::clone(&store),
        chat_provider_registry(),
        temp_dir.path().to_path_buf(),
    );
    let session2 = service
        .send_task_message(&task.id, "Follow-up question")
        .unwrap();

    assert_eq!(
        session1.id, session2.id,
        "follow-up message must reuse the existing session"
    );
}
