//! End-to-end tests for differential task sync.
//!
//! Verifies that `list_task_views_differential` returns only changed/new tasks
//! and correctly identifies deleted task IDs. Covers both top-level tasks and
//! subtask-specific logic (inclusion, exclusion, parent cascade).

use std::collections::HashMap;

use orkestra_core::workflow::config::{GateConfig, StageConfig, WorkflowConfig};

use crate::helpers::{MockAgentOutput, TestEnv};

// =============================================================================
// Helpers
// =============================================================================

fn simple_workflow() -> WorkflowConfig {
    WorkflowConfig::new(vec![StageConfig::new("work", "summary")
        .with_prompt("worker.md")
        .with_gate(GateConfig::Agentic)])
}

/// Build a timestamp map from a slice of (id, `updated_at`) tuples.
fn ts_map(entries: &[(&str, &str)]) -> HashMap<String, String> {
    entries
        .iter()
        .map(|(id, ts)| (id.to_string(), ts.to_string()))
        .collect()
}

// =============================================================================
// Test: empty since map returns all tasks
// =============================================================================

/// An empty timestamp map is backwards-compatible: returns all active tasks.
#[test]
fn empty_since_returns_all_tasks() {
    let ctx = TestEnv::with_git(&simple_workflow(), &["worker"]);

    let _t1 = ctx.create_task("Task 1", "desc", None);
    let _t2 = ctx.create_task("Task 2", "desc", None);
    let _t3 = ctx.create_task("Task 3", "desc", None);

    let result = ctx
        .api()
        .list_task_views_differential(&HashMap::new())
        .unwrap();

    assert_eq!(result.tasks.len(), 3, "Should return all 3 tasks");
    assert!(result.deleted_ids.is_empty(), "No deletions expected");
}

// =============================================================================
// Test: unchanged tasks are excluded
// =============================================================================

/// Tasks whose `updated_at` matches the client's known timestamp are excluded.
#[test]
fn unchanged_tasks_excluded() {
    let ctx = TestEnv::with_git(&simple_workflow(), &["worker"]);

    let t1 = ctx.create_task("Task 1", "desc", None);
    let t2 = ctx.create_task("Task 2", "desc", None);

    // Re-read both tasks immediately to get their exact current DB timestamps.
    // Orchestrator advances inside create_task may spawn agents and bump updated_at
    // beyond what the returned Task structs reflect.
    let t1_ts = ctx.api().get_task(&t1.id).unwrap().updated_at;
    let t2_ts = ctx.api().get_task(&t2.id).unwrap().updated_at;
    let since = ts_map(&[(&t1.id, &t1_ts), (&t2.id, &t2_ts)]);

    let result = ctx.api().list_task_views_differential(&since).unwrap();

    assert!(
        result.tasks.is_empty(),
        "No tasks should be returned when all timestamps match"
    );
    assert!(result.deleted_ids.is_empty());
}

// =============================================================================
// Test: changed task is included
// =============================================================================

/// When a task's `updated_at` has changed, it is included in the differential response.
#[test]
fn changed_task_included() {
    let ctx = TestEnv::with_git(&simple_workflow(), &["worker"]);

    // Create t1 and capture its timestamp immediately from the return value.
    // create_task's advance runs setup + find_spawn_candidates, but find_spawn_candidates
    // only picks up tasks that were Idle in the *previous* tick — so the agent is NOT
    // spawned yet. This returned updated_at is the "pre-spawn" snapshot.
    let t1 = ctx.create_task("Task 1", "desc", None);
    let old_t1_ts = t1.updated_at.clone();

    // Configure t1's output so the next advances can drive it to completion.
    ctx.set_output(
        &t1.id,
        MockAgentOutput::Artifact {
            name: "summary".into(),
            content: "Work done".into(),
            activity_log: None,
            resources: vec![],
        },
    );

    // Brief sleep so the next timestamp is strictly greater.
    std::thread::sleep(std::time::Duration::from_millis(5));

    ctx.advance(); // spawns work agent (completion ready)
    ctx.advance(); // processes work output → ends iteration → bumps t1.updated_at

    let updated_t1 = ctx.api().get_task(&t1.id).unwrap();
    assert!(
        updated_t1.updated_at != old_t1_ts,
        "Task 1 updated_at should have changed"
    );

    // since: old t1 timestamp (appears changed)
    let since = ts_map(&[(&t1.id, &old_t1_ts)]);

    let result = ctx.api().list_task_views_differential(&since).unwrap();

    assert_eq!(
        result.tasks.len(),
        1,
        "Only the changed task should be returned"
    );
    assert_eq!(result.tasks[0].task.id, t1.id);
    assert!(result.deleted_ids.is_empty());
}

// =============================================================================
// Test: new tasks not in since map are included
// =============================================================================

/// Tasks not present in the timestamp map are treated as new and always included.
#[test]
fn new_tasks_included() {
    let ctx = TestEnv::with_git(&simple_workflow(), &["worker"]);

    let t1 = ctx.create_task("Task 1", "desc", None);
    let t2 = ctx.create_task("Task 2", "desc", None);

    // Re-read t1's current timestamp — only t1 goes in the since map.
    // t2 is intentionally absent to simulate it being "new" to the client.
    let t1_ts = ctx.api().get_task(&t1.id).unwrap().updated_at;
    let since = ts_map(&[(&t1.id, &t1_ts)]);

    let result = ctx.api().list_task_views_differential(&since).unwrap();

    assert_eq!(
        result.tasks.len(),
        1,
        "Only the new task should be returned"
    );
    assert_eq!(result.tasks[0].task.id, t2.id);
    assert!(result.deleted_ids.is_empty());
}

// =============================================================================
// Test: deleted tasks appear in deleted_ids
// =============================================================================

/// Task IDs in the timestamp map that are no longer active appear in `deleted_ids`.
#[test]
fn deleted_task_in_deleted_ids() {
    let ctx = TestEnv::with_git(&simple_workflow(), &["worker"]);

    let t1 = ctx.create_task("Task 1", "desc", None);
    let t2 = ctx.create_task("Task 2", "desc", None);

    // Re-read both to get their current DB timestamps.
    let t1_ts = ctx.api().get_task(&t1.id).unwrap().updated_at;
    let t2_ts = ctx.api().get_task(&t2.id).unwrap().updated_at;
    let since = ts_map(&[(&t1.id, &t1_ts), (&t2.id, &t2_ts)]);

    // Delete t1.
    ctx.api().delete_task_with_cleanup(&t1.id).unwrap();

    let result = ctx.api().list_task_views_differential(&since).unwrap();

    assert!(
        result.tasks.is_empty(),
        "t2 is unchanged, so no tasks in response"
    );
    assert_eq!(result.deleted_ids.len(), 1);
    assert_eq!(result.deleted_ids[0], t1.id);
}

// =============================================================================
// Tests: Subtask differential sync
// =============================================================================

/// An unchanged subtask is excluded from the differential response.
///
/// Exercises the subtask-specific filtering path in `list_active_differential`,
/// which independently checks each subtask's `updated_at` against the since map.
#[test]
fn unchanged_subtask_excluded() {
    let ctx = TestEnv::with_git(&simple_workflow(), &["worker"]);

    let parent = ctx.create_task("Parent", "desc", None);
    let sub = ctx.create_subtask(&parent.id, "Subtask", "desc");

    // Re-read both to get current DB timestamps.
    let parent_ts = ctx.api().get_task(&parent.id).unwrap().updated_at;
    let sub_ts = ctx.api().get_task(&sub.id).unwrap().updated_at;
    let since = ts_map(&[(&parent.id, &parent_ts), (&sub.id, &sub_ts)]);

    let result = ctx.api().list_task_views_differential(&since).unwrap();

    assert!(
        result.tasks.is_empty(),
        "No tasks should be returned when both parent and subtask timestamps match"
    );
    assert!(result.deleted_ids.is_empty());
}

/// When a subtask's `updated_at` changes (any state change), the parent must
/// appear in the differential response even if the parent's own `updated_at`
/// hasn't changed. This ensures `subtask_progress` stays fresh on the frontend
/// without requiring every child update path to cascade to the parent.
#[test]
fn parent_included_when_subtask_changes() {
    let ctx = TestEnv::with_git(&simple_workflow(), &["worker"]);

    let parent = ctx.create_task("Parent", "desc", None);
    let sub = ctx.create_subtask(&parent.id, "Subtask", "desc");

    // Capture current timestamps for both.
    let parent_ts = ctx.api().get_task(&parent.id).unwrap().updated_at;
    let sub_ts = ctx.api().get_task(&sub.id).unwrap().updated_at;
    let since = ts_map(&[(&parent.id, &parent_ts), (&sub.id, &sub_ts)]);

    // Brief sleep so the touch timestamp is strictly greater.
    std::thread::sleep(std::time::Duration::from_millis(5));

    // Bump ONLY the subtask's updated_at (simulates any child state change
    // that doesn't cascade to parent — e.g., agent_started, commit_succeeded).
    ctx.api().touch_task(&sub.id).unwrap();

    // Parent's own updated_at should NOT have changed.
    let parent_ts_after = ctx.api().get_task(&parent.id).unwrap().updated_at;
    assert_eq!(
        parent_ts_after, parent_ts,
        "Parent updated_at must not change (this test verifies the composite key, not cascade)"
    );

    let result = ctx.api().list_task_views_differential(&since).unwrap();

    let returned_ids: std::collections::HashSet<&str> =
        result.tasks.iter().map(|v| v.task.id.as_str()).collect();
    assert!(
        returned_ids.contains(parent.id.as_str()),
        "Parent must appear in differential response when subtask changes (composite key)"
    );
    assert!(
        returned_ids.contains(sub.id.as_str()),
        "Changed subtask must appear in differential response"
    );
}
