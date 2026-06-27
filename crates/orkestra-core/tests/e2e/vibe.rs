//! E2e tests for vibe mode entry.
//!
//! Covers `enter_vibe` from `AwaitingApproval` and Done, agent spawn,
//! and rejection of invalid transitions.

use orkestra_core::workflow::{
    config::{IntegrationConfig, StageConfig, WorkflowConfig},
    ports::WorkflowError,
    runtime::TaskState,
};

use crate::helpers::{disable_auto_merge, MockAgentOutput, TestEnv};

// =============================================================================
// Helpers
// =============================================================================

fn simple_workflow() -> WorkflowConfig {
    WorkflowConfig::new(vec![
        StageConfig::new("work", "summary").with_prompt("worker.md")
    ])
    .with_integration(IntegrationConfig::new("work"))
}

// =============================================================================
// Tests
// =============================================================================

/// Enter vibe from `AwaitingApproval`: task transitions to Queued{vibe} with
/// correct `vibe_origin`, then the orchestrator spawns the vibe agent.
#[test]
fn test_enter_vibe_from_awaiting_approval() {
    let workflow = disable_auto_merge(simple_workflow());
    let ctx = TestEnv::with_git(&workflow, &["worker", "vibe"]);

    let task = ctx.create_task("Vibe test", "Test vibe entry", None);
    let task_id = task.id.clone();

    // Advance to AwaitingApproval at work stage
    ctx.set_output(
        &task_id,
        MockAgentOutput::Artifact {
            name: "summary".to_string(),
            content: "Work done".to_string(),
            activity_log: None,
            resources: vec![],
        },
    );
    ctx.advance(); // spawn worker
    ctx.advance(); // process output → AwaitingApproval

    let task = ctx.api().get_task(&task_id).unwrap();
    assert!(
        matches!(task.state, TaskState::AwaitingApproval { .. }),
        "Expected AwaitingApproval, got {:?}",
        task.state
    );

    // Enter vibe mode
    let task = ctx.api().enter_vibe(&task_id).unwrap();

    // Task should be queued for vibe stage
    assert!(
        matches!(task.state, TaskState::Queued { ref stage } if stage == "vibe"),
        "Expected Queued{{vibe}}, got {:?}",
        task.state
    );

    // vibe_origin should record where we came from
    let origin = task
        .vibe_origin
        .as_ref()
        .expect("vibe_origin should be set");
    assert_eq!(origin.flow, "default");
    assert_eq!(
        origin.stage.as_deref(),
        Some("work"),
        "Origin stage should be 'work'"
    );
    assert!(origin.proposed_destination.is_none());

    // Iteration should exist for vibe stage
    let iterations = ctx.api().get_iterations(&task_id).unwrap();
    let vibe_iter = iterations.iter().find(|i| i.stage == "vibe");
    assert!(vibe_iter.is_some(), "Iteration should exist for vibe stage");

    // Orchestrator tick spawns the vibe agent
    ctx.set_output(
        &task_id,
        MockAgentOutput::Artifact {
            name: "vibe".to_string(),
            content: "Done vibing".to_string(),
            activity_log: None,
            resources: vec![],
        },
    );
    ctx.advance(); // spawn vibe agent + process output (mock runs synchronously, no intermediate AgentWorking state)

    let task = ctx.api().get_task(&task_id).unwrap();
    assert!(
        matches!(task.state, TaskState::AwaitingApproval { ref stage } if stage == "vibe"),
        "Expected AwaitingApproval{{vibe}} after vibe agent ran, got {:?}",
        task.state
    );
}

/// Enter vibe from Done: clears `completed_at`, `vibe_origin.stage` is None.
#[test]
fn test_enter_vibe_from_done() {
    let workflow = disable_auto_merge(simple_workflow());
    let ctx = TestEnv::with_git(&workflow, &["worker", "vibe"]);

    let task = ctx.create_task("Vibe done test", "Test vibe from done", None);
    let task_id = task.id.clone();

    // Advance to Done (approve the work stage output)
    ctx.set_output(
        &task_id,
        MockAgentOutput::Artifact {
            name: "summary".to_string(),
            content: "Work done".to_string(),
            activity_log: None,
            resources: vec![],
        },
    );
    ctx.advance(); // spawn worker
    ctx.advance(); // process output → AwaitingApproval
    ctx.api().approve(&task_id).unwrap();
    ctx.advance(); // commit pipeline → Done

    let task = ctx.api().get_task(&task_id).unwrap();
    assert!(task.is_done(), "Task should be Done, got {:?}", task.state);
    assert!(
        task.completed_at.is_some(),
        "completed_at should be set when Done"
    );

    // Enter vibe mode
    let task = ctx.api().enter_vibe(&task_id).unwrap();

    assert!(
        matches!(task.state, TaskState::Queued { ref stage } if stage == "vibe"),
        "Expected Queued{{vibe}}, got {:?}",
        task.state
    );

    // vibe_origin.stage should be None (entered from Done, not a stage)
    let origin = task
        .vibe_origin
        .as_ref()
        .expect("vibe_origin should be set");
    assert_eq!(origin.flow, "default");
    assert!(
        origin.stage.is_none(),
        "Origin stage should be None when entering from Done"
    );

    // completed_at should be cleared
    assert!(
        task.completed_at.is_none(),
        "completed_at should be cleared when entering vibe from Done"
    );
}

/// Entry rejected when `worktree_path` is None.
#[test]
fn test_enter_vibe_rejected_when_no_worktree() {
    use orkestra_core::workflow::{InMemoryWorkflowStore, WorkflowApi, WorkflowStore};
    use std::sync::Arc;

    let workflow = simple_workflow();
    let store = Arc::new(InMemoryWorkflowStore::new());
    let store_ref: Arc<dyn WorkflowStore> = Arc::clone(&store) as Arc<dyn WorkflowStore>;
    let api = WorkflowApi::new(workflow, Arc::clone(&store) as Arc<dyn WorkflowStore>);

    // Create a task and manually set it to Done without a worktree_path
    let mut task = api.create_task("No worktree", "Test", None).unwrap();
    task.state = TaskState::Done;
    task.worktree_path = None; // Simulate cleaned-up worktree
    store_ref.save_task(&task).unwrap();

    let result = api.enter_vibe(&task.id);
    assert!(
        matches!(result, Err(WorkflowError::InvalidState(_))),
        "Expected InvalidState when worktree missing, got {result:?}"
    );
}

/// Entry rejected from invalid state (not `AwaitingApproval` or Done).
#[test]
fn test_enter_vibe_rejected_from_invalid_state() {
    use orkestra_core::workflow::{InMemoryWorkflowStore, WorkflowApi, WorkflowStore};
    use std::sync::Arc;

    let workflow = simple_workflow();
    let store = Arc::new(InMemoryWorkflowStore::new());
    let store_ref: Arc<dyn WorkflowStore> = Arc::clone(&store) as Arc<dyn WorkflowStore>;
    let api = WorkflowApi::new(workflow, Arc::clone(&store) as Arc<dyn WorkflowStore>);

    // Task starts in AwaitingSetup — not a valid vibe entry point
    let task = api.create_task("Invalid state", "Test", None).unwrap();
    assert!(matches!(task.state, TaskState::AwaitingSetup { .. }));

    let result = api.enter_vibe(&task.id);
    assert!(
        matches!(result, Err(WorkflowError::InvalidTransition(_))),
        "Expected InvalidTransition from AwaitingSetup state, got {result:?}"
    );

    // Also reject from AgentWorking
    let mut task = api.create_task("Agent working test", "Test", None).unwrap();
    task.state = TaskState::agent_working("work");
    store_ref.save_task(&task).unwrap();

    let result = api.enter_vibe(&task.id);
    assert!(
        matches!(result, Err(WorkflowError::InvalidTransition(_))),
        "Expected InvalidTransition from AgentWorking state, got {result:?}"
    );
}
