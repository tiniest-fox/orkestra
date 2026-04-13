//! End-to-end tests for differential sync infrastructure.
//!
//! Verifies that `updated_at` is bumped correctly when a task's own iteration
//! data changes, enabling downstream differential sync to detect which tasks
//! have been modified.

use orkestra_core::workflow::config::{GateConfig, IntegrationConfig, StageConfig, WorkflowConfig};

use crate::helpers::{MockAgentOutput, TestEnv};

// =============================================================================
// Helpers
// =============================================================================

/// Simple single-stage workflow (work with agentic gate, no approval needed).
fn simple_workflow() -> WorkflowConfig {
    WorkflowConfig::new(vec![StageConfig::new("work", "summary")
        .with_prompt("worker.md")
        .with_gate(GateConfig::Agentic)])
    .with_integration(IntegrationConfig::new("work"))
}

/// Parse an RFC3339 timestamp string to a comparable value (seconds + nanos since epoch).
fn parse_ts(s: &str) -> chrono::DateTime<chrono::FixedOffset> {
    chrono::DateTime::parse_from_rfc3339(s)
        .unwrap_or_else(|e| panic!("Failed to parse timestamp '{s}': {e}"))
}

// =============================================================================
// Test: iteration end bumps updated_at
// =============================================================================

/// When an iteration ends (agent completes output processing), the task's
/// `updated_at` timestamp must increase to signal that dependent data changed.
#[test]
fn iteration_end_bumps_updated_at() {
    let ctx = TestEnv::with_git(&simple_workflow(), &["worker"]);
    let task = ctx.create_task("Test task", "Description", None);
    let task_id = task.id.clone();

    // Record the timestamp after task creation (which sets updated_at via save_task)
    let t_initial = parse_ts(&task.updated_at);

    // Brief sleep so any subsequent timestamp is guaranteed to be strictly greater.
    std::thread::sleep(std::time::Duration::from_millis(5));

    // Queue work output so the mock agent completes synchronously.
    ctx.set_output(
        &task_id,
        MockAgentOutput::Artifact {
            name: "summary".into(),
            content: "Work done".into(),
            activity_log: None,
            resources: vec![],
        },
    );

    ctx.advance(); // spawns work agent (completion ready); no new iteration created
    ctx.advance(); // processes work output → ends iteration → touch_task bumps updated_at

    let task_after = ctx.api().get_task(&task_id).unwrap();
    let t_after_end = parse_ts(&task_after.updated_at);

    assert!(
        t_after_end > t_initial,
        "updated_at should increase after iteration end: initial={t_initial}, after={t_after_end}"
    );
}

// =============================================================================
// Test: iteration creation bumps updated_at
// =============================================================================

/// When a new iteration is created for a task (e.g., on rejection), the task's
/// `updated_at` timestamp must increase.
#[test]
fn iteration_creation_bumps_updated_at() {
    let ctx = TestEnv::with_git(&simple_workflow(), &["worker"]);
    let task = ctx.create_task("Test task", "Description", None);
    let task_id = task.id.clone();

    // Drive through one full agent run to get to AwaitingApproval
    ctx.set_output(
        &task_id,
        MockAgentOutput::Artifact {
            name: "summary".into(),
            content: "Work done".into(),
            activity_log: None,
            resources: vec![],
        },
    );
    ctx.advance(); // spawns work agent
    ctx.advance(); // processes output → ends iter-work-1 → AwaitingApproval

    // Record timestamp after the first iteration ended
    let t_before_reject = parse_ts(&ctx.api().get_task(&task_id).unwrap().updated_at);

    std::thread::sleep(std::time::Duration::from_millis(5));

    // Reject the task — this creates a new iteration for "work" stage
    ctx.api().reject(&task_id, "Try again").unwrap();
    ctx.advance(); // applies rejection, creates iter-work-2 → touch_task bumps updated_at

    let task_after = ctx.api().get_task(&task_id).unwrap();
    let t_after_create = parse_ts(&task_after.updated_at);

    assert!(
        t_after_create > t_before_reject,
        "updated_at should increase after new iteration created: before={t_before_reject}, after={t_after_create}"
    );
}
