//! E2E tests for chat task infrastructure.
//!
//! Tests chat task creation, spawn filtering, and promotion to workflow flow.

use orkestra_core::workflow::config::{IntegrationConfig, StageConfig, WorkflowConfig};
use orkestra_core::workflow::domain::TaskCreationMode;
use orkestra_core::workflow::ports::WorkflowError;
use orkestra_core::workflow::runtime::TaskState;

use crate::helpers::TestEnv;

// =============================================================================
// Helpers
// =============================================================================

fn one_stage_workflow() -> WorkflowConfig {
    WorkflowConfig::new(vec![StageConfig::new("work", "summary")])
        .with_integration(IntegrationConfig::new("work"))
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
