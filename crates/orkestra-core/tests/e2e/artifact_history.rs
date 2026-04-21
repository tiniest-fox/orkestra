//! E2E tests for artifact history via the `workflow_artifacts` table.
//!
//! Covers artifact storage, iteration tagging, and `ArtifactProduced` log entries.
//! These tests verify that the agent dispatch path correctly saves artifact rows
//! and emits log entries when an agent produces an accepted artifact.

use orkestra_core::workflow::{
    config::{GateConfig, IntegrationConfig, StageConfig, WorkflowConfig},
    domain::LogEntry,
    execution::SubtaskOutput,
};

use crate::helpers::{workflows, MockAgentOutput, TestEnv};

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

    let LogEntry::ArtifactProduced {
        name,
        artifact_id,
        artifact,
    } = &produced_entries[0]
    else {
        panic!("Expected ArtifactProduced variant")
    };
    assert_eq!(name, "plan");
    assert!(!artifact_id.is_empty(), "artifact_id should be non-empty");

    // get_task_logs enriches ArtifactProduced entries with the artifact content at query time.
    let artifact = artifact
        .as_ref()
        .expect("artifact field should be Some after get_task_logs enrichment");
    assert_eq!(
        artifact.content, "Design plan",
        "enriched artifact content should match what was stored"
    );
    assert_eq!(artifact.name, "plan");

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

    // Human restarts stage — starts a new iteration.
    ctx.api()
        .restart_stage(&task_id, "Needs more detail")
        .unwrap();

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

// =============================================================================
// Test 5: Failed output produces no artifact rows
// =============================================================================

/// When an agent reports failure, no artifact row is written to `workflow_artifacts`.
#[test]
fn test_failed_output_produces_no_artifact_row() {
    let ctx = TestEnv::with_workflow(planning_only_workflow());
    let task = ctx.create_task("Failing task", "Task that fails", None);
    let task_id = task.id.clone();

    ctx.set_output(
        &task_id,
        MockAgentOutput::Failed {
            error: "Agent crashed unexpectedly.".to_string(),
        },
    );
    ctx.advance(); // spawn agent
    ctx.advance(); // process output → Failed state, no artifact row

    let artifacts = ctx.api().list_workflow_artifacts(&task_id).unwrap();
    assert!(
        artifacts.is_empty(),
        "Failed output should produce no artifact rows, got: {artifacts:?}"
    );
}

// =============================================================================
// Test 6: Subtask artifact is stored with the subtask's task_id
// =============================================================================

/// When a subtask agent produces an artifact, the `workflow_artifacts` row uses
/// the subtask's own `task_id` — not the parent's.
#[test]
fn test_subtask_artifact_stored_with_subtask_task_id() {
    let ctx = TestEnv::with_workflow(planning_only_workflow());

    // Create and complete the parent task first.
    let parent = ctx.create_task("Parent task", "Parent description", None);
    let parent_id = parent.id.clone();

    ctx.set_output(
        &parent_id,
        MockAgentOutput::artifact("plan", "Parent plan."),
    );
    ctx.advance(); // spawn parent agent
    ctx.advance(); // process output → Done

    // Create the subtask (parent is now Done — valid state for subtask creation).
    let subtask = ctx
        .api()
        .create_subtask(&parent_id, "Subtask", "Subtask description")
        .expect("Should create subtask");
    let subtask_id = subtask.id.clone();

    ctx.advance(); // set up subtask (AwaitingSetup → Idle)

    // Drive subtask agent to produce an artifact.
    ctx.set_output(
        &subtask_id,
        MockAgentOutput::artifact("plan", "Subtask plan."),
    );
    ctx.advance(); // spawn subtask agent
    ctx.advance(); // process output → Done, persist artifact

    // Subtask artifact must reference the subtask, not the parent.
    let subtask_artifacts = ctx.api().list_workflow_artifacts(&subtask_id).unwrap();
    assert_eq!(
        subtask_artifacts.len(),
        1,
        "Subtask should have exactly one artifact row"
    );
    assert_eq!(
        subtask_artifacts[0].task_id, subtask_id,
        "Artifact task_id should match the subtask's ID, not the parent's"
    );

    // Parent's artifact list must not contain the subtask's artifact.
    let parent_artifacts = ctx.api().list_workflow_artifacts(&parent_id).unwrap();
    assert_eq!(
        parent_artifacts.len(),
        1,
        "Parent should have exactly one artifact row (its own)"
    );
    assert_eq!(parent_artifacts[0].task_id, parent_id);
}

// =============================================================================
// Test 7: Breakdown stage artifact is stored in workflow_artifacts
// =============================================================================

/// Subtask breakdown output from an agent creates a row in `workflow_artifacts`.
/// The `_structured` companion artifact is intentionally NOT stored in the table —
/// only the human-readable breakdown artifact is persisted.
#[test]
fn test_breakdown_artifact_stored_in_workflow_artifacts() {
    let ctx = TestEnv::with_workflow(workflows::with_subtasks());
    let task = ctx.create_task("Build feature", "Feature description", None);
    let task_id = task.id.clone();

    // Drive through planning stage.
    ctx.set_output(&task_id, MockAgentOutput::artifact("plan", "The plan."));
    ctx.advance(); // spawn planning agent
    ctx.advance(); // process output → AwaitingApproval
    ctx.api().approve(&task_id).unwrap();
    ctx.advance(); // commit pipeline → advance to breakdown

    // Drive breakdown stage: produce multiple subtasks.
    ctx.set_output(
        &task_id,
        MockAgentOutput::Subtasks {
            content: "Technical design".into(),
            subtasks: vec![
                SubtaskOutput {
                    title: "Subtask A".into(),
                    description: "Do A".into(),
                    detailed_instructions: "Instructions A".into(),
                    depends_on: vec![],
                },
                SubtaskOutput {
                    title: "Subtask B".into(),
                    description: "Do B".into(),
                    detailed_instructions: "Instructions B".into(),
                    depends_on: vec![0],
                },
            ],
            activity_log: None,
            resources: vec![],
        },
    );
    ctx.advance(); // spawn breakdown agent
    ctx.advance(); // process output → AwaitingApproval, persist breakdown artifact

    let all_artifacts = ctx.api().list_workflow_artifacts(&task_id).unwrap();

    // The breakdown artifact row should exist.
    let breakdown_artifacts: Vec<_> = all_artifacts
        .iter()
        .filter(|a| a.stage == "breakdown")
        .collect();
    assert_eq!(
        breakdown_artifacts.len(),
        1,
        "Should have exactly one breakdown artifact row"
    );
    assert_eq!(breakdown_artifacts[0].name, "breakdown");
    assert_eq!(breakdown_artifacts[0].task_id, task_id);

    // The `_structured` companion artifact must NOT appear in workflow_artifacts —
    // it holds raw JSON for internal use and is excluded intentionally.
    let structured_artifacts: Vec<_> = all_artifacts
        .iter()
        .filter(|a| a.name.ends_with("_structured"))
        .collect();
    assert!(
        structured_artifacts.is_empty(),
        "Structured companion artifacts should not be stored in workflow_artifacts, got: {structured_artifacts:?}"
    );

    // An ArtifactProduced log entry should have been emitted for the breakdown stage.
    let (entries, _cursor) = ctx
        .api()
        .get_task_logs(&task_id, Some("breakdown"), None, None)
        .unwrap();
    let produced_entries: Vec<_> = entries
        .iter()
        .filter(|e| matches!(e, LogEntry::ArtifactProduced { .. }))
        .collect();
    assert_eq!(
        produced_entries.len(),
        1,
        "Should have exactly one ArtifactProduced log entry for breakdown"
    );
    let LogEntry::ArtifactProduced { name, .. } = &produced_entries[0] else {
        panic!("Expected ArtifactProduced variant");
    };
    assert_eq!(name, "breakdown");
}
