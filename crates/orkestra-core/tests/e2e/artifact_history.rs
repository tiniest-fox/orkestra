//! E2E tests for artifact history via the `workflow_artifacts` table.
//!
//! Covers artifact storage, iteration tagging, and `ArtifactProduced` log entries.
//! These tests verify that the agent dispatch path correctly saves artifact rows
//! and emits log entries when an agent produces an accepted artifact.

use orkestra_core::workflow::{
    config::{GateConfig, IntegrationConfig, StageConfig, WorkflowConfig},
    domain::LogEntry,
};

use crate::helpers::{MockAgentOutput, TestEnv};

// =============================================================================
// Helpers
// =============================================================================

/// Single-stage workflow: planning only, no approval gate.
///
/// After the agent produces its output, the task immediately transitions to Done.
/// Simplest setup for verifying artifact storage.
fn planning_only_workflow() -> WorkflowConfig {
    WorkflowConfig::new(vec![StageConfig::new("planning", "plan")])
}

/// Two-stage workflow with agentic gate on planning.
///
/// After the agent produces output, the task waits at `AwaitingApproval`
/// so tests can reject and trigger a retry iteration.
fn planning_with_gate() -> WorkflowConfig {
    WorkflowConfig::new(vec![
        StageConfig::new("planning", "plan").with_gate(GateConfig::Agentic),
        StageConfig::new("work", "summary"),
    ])
    .with_integration(IntegrationConfig::new("work"))
}

// =============================================================================
// Test 1: Artifact row created on agent output
// =============================================================================

/// Artifact output from an agent creates a row in `workflow_artifacts`.
#[test]
fn test_artifact_row_created_on_agent_output() {
    let ctx = TestEnv::with_workflow(planning_only_workflow());
    let task = ctx.create_task("Implement login", "Add login page", None);
    let task_id = task.id.clone();

    ctx.set_output(
        &task_id,
        MockAgentOutput::artifact("plan", "# Plan\n\nDo the thing."),
    );
    ctx.advance(); // spawn agent
    ctx.advance(); // process output → persist artifact

    let artifacts = ctx.api().list_workflow_artifacts(&task_id).unwrap();
    assert_eq!(artifacts.len(), 1, "Should have exactly one artifact row");

    let artifact = &artifacts[0];
    assert_eq!(artifact.task_id, task_id);
    assert_eq!(artifact.stage, "planning");
    assert_eq!(artifact.name, "plan");
    assert_eq!(artifact.content, "# Plan\n\nDo the thing.");
}

// =============================================================================
// Test 2: Artifact row is tagged with iteration ID
// =============================================================================

/// The `iteration_id` on the artifact row matches the active iteration when the
/// artifact was produced.
#[test]
fn test_artifact_tagged_with_iteration_id() {
    let ctx = TestEnv::with_workflow(planning_only_workflow());
    let task = ctx.create_task("Build feature", "Build it", None);
    let task_id = task.id.clone();

    // Capture the iteration that will be active during planning.
    let iterations_before = ctx.api().get_iterations(&task_id).unwrap();
    assert_eq!(iterations_before.len(), 1);
    let planning_iteration_id = iterations_before[0].id.clone();

    ctx.set_output(&task_id, MockAgentOutput::artifact("plan", "Plan content"));
    ctx.advance(); // spawn agent
    ctx.advance(); // process output → persist artifact

    let artifacts = ctx.api().list_workflow_artifacts(&task_id).unwrap();
    assert_eq!(artifacts.len(), 1);

    assert_eq!(
        artifacts[0].iteration_id,
        Some(planning_iteration_id),
        "Artifact should be tagged with the active iteration ID"
    );
}

// =============================================================================
// Test 3: ArtifactProduced log entry emitted
// =============================================================================

/// Accepting an artifact emits an `ArtifactProduced` log entry in the stage session.
#[test]
fn test_artifact_produced_log_entry_emitted() {
    let ctx = TestEnv::with_workflow(planning_only_workflow());
    let task = ctx.create_task("Design system", "Design it", None);
    let task_id = task.id.clone();

    ctx.set_output(&task_id, MockAgentOutput::artifact("plan", "Design plan"));
    ctx.advance(); // spawn agent
    ctx.advance(); // process output → persist artifact, emit log entry

    let (entries, _cursor) = ctx
        .api()
        .get_task_logs(&task_id, Some("planning"), None, None)
        .unwrap();

    let produced_entries: Vec<_> = entries
        .iter()
        .filter(|e| matches!(e, LogEntry::ArtifactProduced { .. }))
        .collect();

    assert_eq!(
        produced_entries.len(),
        1,
        "Should have exactly one ArtifactProduced log entry"
    );

    let LogEntry::ArtifactProduced { name, artifact_id } = &produced_entries[0] else {
        panic!("Expected ArtifactProduced variant")
    };
    assert_eq!(name, "plan");
    assert!(!artifact_id.is_empty(), "artifact_id should be non-empty");

    // The artifact_id should correspond to the stored artifact row.
    let artifacts = ctx.api().list_workflow_artifacts(&task_id).unwrap();
    assert_eq!(
        artifacts[0].id, *artifact_id,
        "Log artifact_id should match stored row ID"
    );
}

// =============================================================================
// Test 4: Rejection creates a new artifact row per iteration
// =============================================================================

/// Each accepted artifact output creates a new `workflow_artifacts` row, so the
/// history across rejection cycles is preserved.
#[test]
fn test_rejection_creates_new_artifact_row() {
    let ctx = TestEnv::with_workflow(planning_with_gate());
    let task = ctx.create_task("Write docs", "Write documentation", None);
    let task_id = task.id.clone();

    // First iteration: agent produces plan v1 → task awaits approval.
    ctx.set_output(&task_id, MockAgentOutput::artifact("plan", "Plan v1"));
    ctx.advance(); // spawn agent
    ctx.advance(); // process output → AwaitingApproval, persist artifact row 1

    let artifacts_after_first = ctx.api().list_workflow_artifacts(&task_id).unwrap();
    assert_eq!(
        artifacts_after_first.len(),
        1,
        "One artifact row after first iteration"
    );
    assert_eq!(artifacts_after_first[0].content, "Plan v1");

    // Human rejects — starts a new iteration.
    ctx.api().reject(&task_id, "Needs more detail").unwrap();

    // Second iteration: agent produces plan v2 → another artifact row.
    ctx.set_output(
        &task_id,
        MockAgentOutput::artifact("plan", "Plan v2 — detailed"),
    );
    ctx.advance(); // spawn agent (retry)
    ctx.advance(); // process output → AwaitingApproval, persist artifact row 2

    let artifacts_after_second = ctx.api().list_workflow_artifacts(&task_id).unwrap();
    assert_eq!(
        artifacts_after_second.len(),
        2,
        "Two artifact rows after rejection and retry"
    );

    // Both rows belong to the same task and stage.
    assert!(artifacts_after_second.iter().all(|a| a.task_id == task_id));
    assert!(artifacts_after_second.iter().all(|a| a.stage == "planning"));

    // The two rows have different iteration IDs.
    let iter_id_1 = artifacts_after_second[0].iteration_id.as_deref();
    let iter_id_2 = artifacts_after_second[1].iteration_id.as_deref();
    assert_ne!(
        iter_id_1, iter_id_2,
        "Each artifact row should be tagged with its own iteration ID"
    );

    // The newest row has the updated content.
    assert_eq!(artifacts_after_second[1].content, "Plan v2 — detailed");
}
