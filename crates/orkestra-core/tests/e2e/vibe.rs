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

// =============================================================================
// Exit flow tests
// =============================================================================

fn multi_stage_workflow() -> WorkflowConfig {
    WorkflowConfig::new(vec![
        StageConfig::new("work", "summary").with_prompt("worker.md"),
        StageConfig::new("review", "verdict").with_prompt("worker.md"),
    ])
    .with_integration(IntegrationConfig::new("work"))
}

/// Helper: create task, advance to `AwaitingApproval` at work, enter vibe, have agent propose exit.
fn setup_vibe_awaiting_approval(ctx: &TestEnv, destination: &str) -> String {
    let task = ctx.create_task("Vibe exit test", "Test vibe exit", None);
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
    assert!(matches!(task.state, TaskState::AwaitingApproval { .. }));

    // Enter vibe
    ctx.api().enter_vibe(&task_id).unwrap();

    // Vibe agent proposes exit
    ctx.set_output(
        &task_id,
        MockAgentOutput::ProposedExit {
            destination: destination.to_string(),
            rationale: "Ready to move on".to_string(),
            content: Some("Vibe session summary".to_string()),
        },
    );
    ctx.advance(); // spawn vibe agent + produce ProposedExit

    let task = ctx.api().get_task(&task_id).unwrap();
    assert!(
        matches!(task.state, TaskState::AwaitingApproval { .. }),
        "Expected AwaitingApproval after ProposedExit, got {:?}",
        task.state
    );
    let origin = task
        .vibe_origin
        .as_ref()
        .expect("vibe_origin should be set");
    assert_eq!(
        origin.proposed_destination.as_deref(),
        Some(destination),
        "proposed_destination should be stored"
    );

    task_id
}

/// Full vibe lifecycle: agent proposes exit to a stage, human approves, task routes there.
#[test]
fn test_vibe_exit_to_stage_on_approve() {
    let workflow = disable_auto_merge(multi_stage_workflow());
    let ctx = TestEnv::with_git(&workflow, &["worker", "vibe"]);

    let task_id = setup_vibe_awaiting_approval(&ctx, "review");

    // Approve → task should route to "review"
    ctx.api().approve(&task_id).unwrap();
    ctx.advance(); // finalize → Queued{review} (after commit pipeline)

    let task = ctx.api().get_task(&task_id).unwrap();
    assert!(
        matches!(&task.state, TaskState::Queued { stage } if stage == "review"),
        "Expected Queued{{review}} after vibe exit, got {:?}",
        task.state
    );
    assert!(task.vibe_origin.is_none(), "vibe_origin should be cleared");
}

/// Vibe exit to "done": task completes immediately.
#[test]
fn test_vibe_exit_to_done_on_approve() {
    let workflow = disable_auto_merge(simple_workflow());
    let ctx = TestEnv::with_git(&workflow, &["worker", "vibe"]);

    let task_id = setup_vibe_awaiting_approval(&ctx, "done");

    // Approve → task should be Done
    ctx.api().approve(&task_id).unwrap();
    ctx.advance(); // finalize → Done

    let task = ctx.api().get_task(&task_id).unwrap();
    assert!(
        task.is_done(),
        "Expected Done after vibe exit to 'done', got {:?}",
        task.state
    );
    assert!(
        task.completed_at.is_some(),
        "completed_at should be set when Done"
    );
    assert!(task.vibe_origin.is_none(), "vibe_origin should be cleared");
}

/// Reject from vibe: task re-enters vibe session, `proposed_destination` cleared.
#[test]
fn test_vibe_exit_reject_resumes_vibe() {
    use orkestra_core::workflow::domain::PrCommentData;

    let workflow = disable_auto_merge(simple_workflow());
    let ctx = TestEnv::with_git(&workflow, &["worker", "vibe"]);

    let task_id = setup_vibe_awaiting_approval(&ctx, "done");

    let comment = PrCommentData {
        id: None,
        author: "human".to_string(),
        body: "Not done yet, keep working".to_string(),
        path: None,
        line: None,
    };
    // Reject → back to vibe
    ctx.api()
        .reject_with_comments(&task_id, vec![comment], Some("Not yet".to_string()))
        .unwrap();

    let task = ctx.api().get_task(&task_id).unwrap();
    // After rejection from vibe, task should be queued for vibe again
    assert!(
        matches!(&task.state, TaskState::Queued { stage } if stage == "vibe"),
        "Expected Queued{{vibe}} after rejection, got {:?}",
        task.state
    );
    // vibe_origin preserved but proposed_destination cleared
    let origin = task
        .vibe_origin
        .as_ref()
        .expect("vibe_origin should remain");
    assert!(
        origin.proposed_destination.is_none(),
        "proposed_destination should be cleared after rejection"
    );
}

/// Destination override: human calls `confirm_vibe_exit` to override agent's proposed destination.
#[test]
fn test_vibe_exit_destination_override() {
    let workflow = disable_auto_merge(multi_stage_workflow());
    let ctx = TestEnv::with_git(&workflow, &["worker", "vibe"]);

    // Agent proposes "work", human overrides to "review"
    let task_id = setup_vibe_awaiting_approval(&ctx, "work");

    ctx.api().confirm_vibe_exit(&task_id, "review").unwrap();
    ctx.advance(); // finalize → Queued{review}

    let task = ctx.api().get_task(&task_id).unwrap();
    assert!(
        matches!(&task.state, TaskState::Queued { stage } if stage == "review"),
        "Expected Queued{{review}} after destination override, got {:?}",
        task.state
    );
    assert!(task.vibe_origin.is_none(), "vibe_origin should be cleared");
}

/// Invalid destination from agent: `ProposedExit` with unknown stage returns error.
#[test]
fn test_vibe_exit_invalid_destination_returns_error() {
    let workflow = disable_auto_merge(simple_workflow());
    let ctx = TestEnv::with_git(&workflow, &["worker", "vibe"]);

    let task = ctx.create_task("Invalid dest test", "Test", None);
    let task_id = task.id.clone();

    // Advance to AwaitingApproval
    ctx.set_output(
        &task_id,
        MockAgentOutput::Artifact {
            name: "summary".to_string(),
            content: "done".to_string(),
            activity_log: None,
            resources: vec![],
        },
    );
    ctx.advance();
    ctx.advance();
    ctx.api().enter_vibe(&task_id).unwrap();

    // Agent proposes invalid destination
    ctx.set_output(
        &task_id,
        MockAgentOutput::ProposedExit {
            destination: "nonexistent_stage".to_string(),
            rationale: "going somewhere invalid".to_string(),
            content: None,
        },
    );
    ctx.advance(); // spawn vibe + process output — should fail

    let task = ctx.api().get_task(&task_id).unwrap();
    // Task should be in Failed state because the destination was invalid
    assert!(
        task.is_failed(),
        "Expected Failed after invalid destination, got {:?}",
        task.state
    );
}

/// `DerivedTaskState` reflects vibe fields correctly.
#[test]
fn test_derived_state_vibe_fields() {
    let workflow = disable_auto_merge(multi_stage_workflow());
    let ctx = TestEnv::with_git(&workflow, &["worker", "vibe"]);

    let task_id = setup_vibe_awaiting_approval(&ctx, "review");

    let views = ctx.api().list_task_views().unwrap();
    let view = views.iter().find(|v| v.task.id == task_id).unwrap();
    assert!(view.derived.is_vibing, "is_vibing should be true");
    assert_eq!(
        view.derived.vibe_proposed_destination.as_deref(),
        Some("review"),
        "vibe_proposed_destination should match"
    );
    assert!(
        view.derived
            .vibe_valid_destinations
            .contains(&"work".to_string()),
        "vibe_valid_destinations should include 'work'"
    );
    assert!(
        view.derived
            .vibe_valid_destinations
            .contains(&"review".to_string()),
        "vibe_valid_destinations should include 'review'"
    );
    assert!(
        view.derived
            .vibe_valid_destinations
            .contains(&"done".to_string()),
        "vibe_valid_destinations should include 'done'"
    );
}

/// Vibe re-entry: entering vibe twice creates a fresh session with no memory of the first.
///
/// Verifies the plan acceptance criterion: "Each vibe entry starts a fresh session".
#[test]
fn test_vibe_reentry_starts_fresh_session() {
    let workflow = disable_auto_merge(simple_workflow());
    let ctx = TestEnv::with_git(&workflow, &["worker", "vibe"]);

    let task = ctx.create_task("Reentry test", "Test fresh session on re-entry", None);
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

    // === First vibe session ===
    ctx.api().enter_vibe(&task_id).unwrap();

    ctx.set_output(
        &task_id,
        MockAgentOutput::ProposedExit {
            destination: "done".to_string(),
            rationale: "First session complete".to_string(),
            content: Some("First vibe summary".to_string()),
        },
    );
    ctx.advance(); // spawn vibe agent → AwaitingApproval{vibe}

    let first_iterations = ctx.api().get_iterations(&task_id).unwrap();
    let first_vibe_iter_count = first_iterations
        .iter()
        .filter(|i| i.stage == "vibe")
        .count();
    assert_eq!(
        first_vibe_iter_count, 1,
        "Should have exactly one vibe iteration"
    );

    // Reject the proposed exit — sends task back to vibe
    use orkestra_core::workflow::domain::PrCommentData;
    let comment = PrCommentData {
        id: None,
        author: "human".to_string(),
        body: "Keep going".to_string(),
        path: None,
        line: None,
    };
    ctx.api()
        .reject_with_comments(&task_id, vec![comment], None)
        .unwrap();

    let task = ctx.api().get_task(&task_id).unwrap();
    assert!(
        matches!(&task.state, TaskState::Queued { stage } if stage == "vibe"),
        "Expected Queued{{vibe}} after rejection, got {:?}",
        task.state
    );
    let origin = task
        .vibe_origin
        .as_ref()
        .expect("vibe_origin should remain");
    assert!(
        origin.proposed_destination.is_none(),
        "proposed_destination should be cleared after rejection"
    );

    // Vibe agent proposes exit again and human approves → Done
    ctx.set_output(
        &task_id,
        MockAgentOutput::ProposedExit {
            destination: "done".to_string(),
            rationale: "Now actually done".to_string(),
            content: None,
        },
    );
    ctx.advance(); // second vibe iteration → AwaitingApproval{vibe}

    // The second vibe iteration is a new iteration (different ID)
    let all_iterations = ctx.api().get_iterations(&task_id).unwrap();
    let vibe_iter_count = all_iterations.iter().filter(|i| i.stage == "vibe").count();
    assert_eq!(
        vibe_iter_count, 2,
        "Second vibe entry should create a new iteration (fresh session)"
    );

    // Approve the second session's exit
    ctx.api().approve(&task_id).unwrap();
    ctx.advance(); // finalize → Done

    let task = ctx.api().get_task(&task_id).unwrap();
    assert!(
        task.is_done(),
        "Task should be Done after second vibe exit, got {:?}",
        task.state
    );
    assert!(task.vibe_origin.is_none(), "vibe_origin should be cleared");
}
