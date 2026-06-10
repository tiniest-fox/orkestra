//! E2E tests for worktree prewarming.
//!
//! Tests that prewarm lifecycle works end-to-end: spawn, adopt, cancel, fallback,
//! chat integration, promote-with-worktree, and startup cleanup.

use std::sync::Arc;

use orkestra_core::adapters::sqlite::DatabaseConnection;
use orkestra_core::testutil::create_temp_git_repo;
use orkestra_core::workflow::config::{IntegrationConfig, StageConfig, WorkflowConfig};
use orkestra_core::workflow::ports::{GitService, WorkflowStore};
use orkestra_core::workflow::runtime::TaskState;
use orkestra_core::workflow::{Git2GitService, SqliteWorkflowStore, WorkflowApi};
use orkestra_store::{WorktreeRecord, WorktreeStatus};

use crate::helpers::{enable_auto_merge, MockAgentOutput, TestEnv};

// =============================================================================
// Helpers
// =============================================================================

fn two_stage_workflow() -> WorkflowConfig {
    WorkflowConfig::new(vec![
        StageConfig::new("planning", "plan"),
        StageConfig::new("work", "summary"),
    ])
    .with_integration(IntegrationConfig::new("work"))
}

/// Create a `WorkflowApi` with a real git service, sync setup, and a shared store.
fn create_api_with_store() -> (WorkflowApi, Arc<dyn WorkflowStore>, tempfile::TempDir) {
    let temp_dir = create_temp_git_repo().expect("git repo");

    let orkestra_dir = temp_dir.path().join(".orkestra");
    std::fs::create_dir_all(orkestra_dir.join(".database")).unwrap();

    let db_path = orkestra_dir.join(".database/orkestra.db");
    let conn = DatabaseConnection::open(&db_path).expect("open db");

    let store: Arc<dyn WorkflowStore> = Arc::new(SqliteWorkflowStore::new(conn.shared()));

    let git_service: Arc<dyn GitService> =
        Arc::new(Git2GitService::new(temp_dir.path()).expect("git service"));

    let api = WorkflowApi::with_git(
        two_stage_workflow(),
        Arc::new(SqliteWorkflowStore::new(conn.shared())),
        git_service,
    );
    api.set_sync_setup(true);

    (api, store, temp_dir)
}

// =============================================================================
// Adopt happy path
// =============================================================================

#[test]
fn test_prewarm_adopt_happy_path() {
    let (api, _store, _tmp) = create_api_with_store();

    // Prewarm a worktree for a specific ID (sync mode: immediately Ready).
    let task_id = "test-prewarm-happy";
    api.prewarm_worktree(task_id, None)
        .expect("prewarm should succeed");

    // Create task using the prewarmed ID — should adopt the ready worktree.
    let task = api
        .create_task_with_prewarm(
            task_id,
            "Prewarm test",
            "Description",
            None,
            orkestra_core::workflow::domain::TaskCreationMode::Normal,
            None,
            false,
        )
        .expect("create should succeed");

    // Task should have a worktree path already set.
    assert!(
        task.worktree_path.is_some(),
        "Task should have adopted the prewarmed worktree"
    );

    // Task should start in Queued (not AwaitingSetup) because worktree was ready.
    assert!(
        matches!(task.state, TaskState::Queued { .. }),
        "Task should start in Queued when worktree is prewarmed, got: {:?}",
        task.state
    );
}

// =============================================================================
// Fallback when no prewarm record
// =============================================================================

#[test]
fn test_prewarm_fallback_no_record() {
    let (api, _store, _tmp) = create_api_with_store();

    // Create task with a task_id that has no prewarm record.
    let task = api
        .create_task_with_prewarm(
            "no-prewarm-id",
            "No prewarm",
            "Description",
            None,
            orkestra_core::workflow::domain::TaskCreationMode::Normal,
            None,
            false,
        )
        .expect("create should succeed");

    // Should fall back to AwaitingSetup.
    assert!(
        matches!(task.state, TaskState::AwaitingSetup { .. }),
        "Task should start in AwaitingSetup when no prewarm record exists, got: {:?}",
        task.state
    );

    // No worktree path yet.
    assert!(
        task.worktree_path.is_none(),
        "Task should not have a worktree path without prewarm"
    );
}

// =============================================================================
// Fallback when prewarm record is Pending (not Ready)
// =============================================================================

#[test]
fn test_prewarm_pending_fallback() {
    let (api, store, _tmp) = create_api_with_store();

    let task_id = "pending-prewarm-id";

    // Manually save a Pending record (simulates prewarm started but not yet done).
    let record = WorktreeRecord {
        task_id: task_id.to_string(),
        status: WorktreeStatus::Pending,
        base_branch: None,
        worktree_path: None,
        branch_name: None,
        base_commit: None,
        created_at: chrono::Utc::now().to_rfc3339(),
    };
    store
        .save_worktree_record(&record)
        .expect("should save pending record");

    // Create task using the same ID.
    let task = api
        .create_task_with_prewarm(
            task_id,
            "Pending prewarm",
            "Description",
            None,
            orkestra_core::workflow::domain::TaskCreationMode::Normal,
            None,
            false,
        )
        .expect("create should succeed");

    // Pending record is not adopted — should fall back to AwaitingSetup.
    assert!(
        matches!(task.state, TaskState::AwaitingSetup { .. }),
        "Task should start in AwaitingSetup when prewarm is still Pending, got: {:?}",
        task.state
    );
}

// =============================================================================
// Cancel prewarm
// =============================================================================

#[test]
fn test_cancel_prewarm_removes_record() {
    let (api, store, _tmp) = create_api_with_store();

    let task_id = "cancel-prewarm-id";

    // Start a prewarm (sync mode → immediately Ready).
    api.prewarm_worktree(task_id, None)
        .expect("prewarm should succeed");

    // Record should exist.
    let record = store
        .get_worktree_record(task_id)
        .expect("store query should succeed");
    assert!(
        record.is_some(),
        "Worktree record should exist after prewarm"
    );

    // Cancel it.
    api.cancel_prewarm(task_id).expect("cancel should succeed");

    // Record should be gone.
    let record = store
        .get_worktree_record(task_id)
        .expect("store query should succeed");
    assert!(
        record.is_none(),
        "Worktree record should be deleted after cancel"
    );
}

#[test]
fn test_cancel_prewarm_causes_task_to_fallback() {
    let (api, _store, _tmp) = create_api_with_store();

    let task_id = "cancel-then-create-id";

    // Prewarm then cancel.
    api.prewarm_worktree(task_id, None)
        .expect("prewarm should succeed");
    api.cancel_prewarm(task_id).expect("cancel should succeed");

    // Create task with same ID — no record exists, falls back to AwaitingSetup.
    let task = api
        .create_task_with_prewarm(
            task_id,
            "After cancel",
            "Description",
            None,
            orkestra_core::workflow::domain::TaskCreationMode::Normal,
            None,
            false,
        )
        .expect("create should succeed");

    assert!(
        matches!(task.state, TaskState::AwaitingSetup { .. }),
        "Task should start in AwaitingSetup after cancel, got: {:?}",
        task.state
    );
}

// =============================================================================
// Chat task with prewarm
// =============================================================================

#[test]
fn test_chat_task_adopts_prewarmed_worktree() {
    let (api, _store, _tmp) = create_api_with_store();

    let task_id = "chat-prewarm-id";

    // Prewarm a worktree.
    api.prewarm_worktree(task_id, None)
        .expect("prewarm should succeed");

    // Create chat task using the prewarmed ID.
    let task = api
        .create_chat_task_with_prewarm(task_id, "Chat with prewarm", None)
        .expect("create chat should succeed");

    // Chat task should have the worktree path.
    assert!(
        task.worktree_path.is_some(),
        "Chat task should have adopted the prewarmed worktree"
    );

    // Chat tasks always stay Queued{chat} regardless of worktree adoption.
    assert!(
        matches!(task.state, TaskState::Queued { ref stage } if stage == "chat"),
        "Chat task should be Queued{{chat}}, got: {:?}",
        task.state
    );
}

// =============================================================================
// Promote chat task with worktree — skips AwaitingSetup
// =============================================================================

#[test]
fn test_promote_chat_with_worktree_skips_awaiting_setup() {
    let ctx = TestEnv::with_git(&two_stage_workflow(), &["planning", "work"]);

    let task_id = "promote-prewarm-id";

    // Prewarm a worktree, then create a chat task that adopts it.
    ctx.api()
        .prewarm_worktree(task_id, None)
        .expect("prewarm should succeed");

    let task = ctx
        .api()
        .create_chat_task_with_prewarm(task_id, "Chat for promote", None)
        .expect("create chat should succeed");

    assert!(
        task.worktree_path.is_some(),
        "Chat task should have worktree_path after prewarm adoption"
    );

    // Promote to flow.
    let promoted = ctx
        .api()
        .promote_to_flow(task_id, None, None, None, None)
        .expect("promote should succeed");

    // Should skip AwaitingSetup and go directly to Queued.
    assert!(
        matches!(promoted.state, TaskState::Queued { .. }),
        "Promoted task with worktree should be Queued, not AwaitingSetup, got: {:?}",
        promoted.state
    );
}

// =============================================================================
// Startup recovery clears orphaned worktree records
// =============================================================================

#[test]
fn test_startup_recovery_cleans_worktree_records() {
    let ctx = TestEnv::with_git(&two_stage_workflow(), &["planning", "work"]);

    let task_id = "recovery-prewarm-id";

    // Save a prewarm record (simulating leftover from previous session).
    ctx.api()
        .prewarm_worktree(task_id, None)
        .expect("prewarm should succeed");

    // Run startup recovery — should delete all worktree records.
    ctx.run_startup_recovery();

    // After recovery, creating a task with that ID should fall back to AwaitingSetup.
    let task = ctx
        .api()
        .create_task_with_prewarm(
            task_id,
            "After recovery",
            "Description",
            None,
            orkestra_core::workflow::domain::TaskCreationMode::Normal,
            None,
            false,
        )
        .expect("create should succeed");

    assert!(
        matches!(task.state, TaskState::AwaitingSetup { .. }),
        "Task should fall back to AwaitingSetup when recovery cleared prewarm record, got: {:?}",
        task.state
    );
}

// =============================================================================
// Prewarmed task completes integration (branch_name populated correctly)
// =============================================================================

#[test]
fn test_prewarm_adopt_task_merges_at_integration() {
    let workflow = enable_auto_merge(two_stage_workflow());
    let ctx = TestEnv::with_git(&workflow, &["planning", "work"]);

    let task_id = "prewarm-integration-id";

    // Prewarm then create task.
    ctx.api()
        .prewarm_worktree(task_id, None)
        .expect("prewarm should succeed");
    let task = ctx
        .api()
        .create_task_with_prewarm(
            task_id,
            "Prewarm integration",
            "Description",
            None,
            orkestra_core::workflow::domain::TaskCreationMode::Normal,
            None,
            false,
        )
        .expect("create should succeed");

    // Adopted worktree must have branch_name set so integration doesn't short-circuit.
    assert!(
        task.branch_name.is_some(),
        "Adopted task must have branch_name for integration to merge"
    );
    assert!(
        !task.base_commit.is_empty(),
        "Adopted task must have base_commit for integration"
    );

    // Drive through planning stage.
    ctx.set_output(
        task_id,
        MockAgentOutput::Artifact {
            name: "plan".to_string(),
            content: "Plan content".to_string(),
            activity_log: None,
            resources: vec![],
        },
    );
    ctx.advance(); // setup → queued (already done) → spawn planning
    ctx.advance(); // process plan → AwaitingApproval
    ctx.api().approve(task_id).expect("approve planning");
    ctx.advance(); // advance to work stage

    // Drive through work stage.
    ctx.set_output(
        task_id,
        MockAgentOutput::Artifact {
            name: "summary".to_string(),
            content: "Work done".to_string(),
            activity_log: None,
            resources: vec![],
        },
    );
    ctx.advance(); // spawn work
    ctx.advance(); // process summary → AwaitingApproval
    ctx.api().approve(task_id).expect("approve work");
    ctx.advance(); // commit pipeline → Done → auto_merge triggers integration

    // With auto_merge and sync background, integration runs inline.
    // Task must be Archived — confirming branch_name was set and merge happened.
    let final_task = ctx.api().get_task(task_id).unwrap();
    assert_eq!(
        final_task.state,
        TaskState::Archived,
        "Prewarmed task must be Archived after integration (branch_name set correctly)"
    );
}
