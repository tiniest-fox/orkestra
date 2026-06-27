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
        .promote_to_flow(task_id, None, None, None, None, None)
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
// Deferred adoption after Pending prewarm
// =============================================================================

#[test]
fn test_deferred_adoption_after_pending_prewarm() {
    let ctx = TestEnv::with_git(&two_stage_workflow(), &["planning", "work"]);

    let task_id = "deferred-adopt-pending";

    // Save a Pending record manually — simulates prewarm started but not yet done.
    let pending_record = WorktreeRecord {
        task_id: task_id.to_string(),
        status: WorktreeStatus::Pending,
        base_branch: None,
        worktree_path: None,
        branch_name: None,
        base_commit: None,
        created_at: chrono::Utc::now().to_rfc3339(),
    };
    ctx.api()
        .test_store()
        .save_worktree_record(&pending_record)
        .expect("save pending record");

    // Create chat task — adoption is skipped because record is Pending.
    let task = ctx
        .api()
        .create_chat_task_with_prewarm(task_id, "Deferred adopt chat", None)
        .expect("create chat should succeed");

    assert!(
        task.worktree_path.is_none(),
        "worktree_path should be None when prewarm record is Pending"
    );

    // Simulate the background prewarm completing: create a real worktree and
    // upgrade the record to Ready.
    let wt_result = ctx
        .api()
        .git_service()
        .expect("git service must be configured")
        .ensure_worktree(task_id, None)
        .expect("ensure_worktree should succeed");

    let ready_record = WorktreeRecord {
        task_id: task_id.to_string(),
        status: WorktreeStatus::Ready,
        worktree_path: Some(wt_result.worktree_path.to_string_lossy().into()),
        branch_name: Some(wt_result.branch_name.clone()),
        base_commit: Some(wt_result.base_commit.clone()),
        base_branch: Some("main".into()),
        created_at: chrono::Utc::now().to_rfc3339(),
    };
    ctx.api()
        .test_store()
        .save_worktree_record(&ready_record)
        .expect("save ready record");

    // One tick runs retry_pending_adoptions and adopts the now-Ready record.
    ctx.advance();

    let adopted = ctx.api().get_task(task_id).expect("task should exist");
    assert!(
        adopted.worktree_path.is_some(),
        "deferred adoption should set worktree_path after tick"
    );
    assert!(
        matches!(adopted.state, TaskState::Queued { ref stage } if stage == "chat"),
        "chat task state should remain Queued{{chat}} after adoption, got: {:?}",
        adopted.state
    );
}

// =============================================================================
// Startup cleanup: Ready record for live task survives (success criterion #3)
// =============================================================================

/// Verifies the preserve branch in `cleanup_orphaned_worktree_records`:
/// a Ready record that belongs to an existing task is kept intact so that
/// `retry_pending_adoptions` can adopt it in the same startup pass.
///
/// Scenario: task exists with `worktree_path` = None, a Ready record arrives
/// (e.g. prewarm completed between session exit and restart), startup recovery
/// runs — the record must survive cleanup.
#[test]
fn test_cleanup_preserves_ready_record_for_live_task() {
    let ctx = TestEnv::with_git(&two_stage_workflow(), &["planning", "work"]);

    // Create a chat task without prewarm — task has no worktree yet.
    let task = ctx
        .api()
        .create_chat_task_with_prewarm("live-task-no-wt", "Chat no wt", None)
        .expect("create chat should succeed");
    assert!(
        task.worktree_path.is_none(),
        "task should have no worktree when created without prewarm"
    );

    // Simulate a prewarm that completed after the previous session exited:
    // save a Ready record directly (not via the API prewarm flow, so adoption
    // has NOT run yet). Use a real tempdir with a .git file so the validity
    // guard in adopt_worktree::execute accepts the record.
    let tmp_wt = tempfile::tempdir().expect("tempdir");
    std::fs::write(tmp_wt.path().join(".git"), "gitdir: ...").expect("write .git");
    let wt_path = tmp_wt.path().to_string_lossy().to_string();
    let ready_record = WorktreeRecord {
        task_id: "live-task-no-wt".to_string(),
        status: WorktreeStatus::Ready,
        worktree_path: Some(wt_path),
        branch_name: Some("task/live-task-no-wt".to_string()),
        base_commit: Some("abc123".to_string()),
        base_branch: Some("main".to_string()),
        created_at: chrono::Utc::now().to_rfc3339(),
    };
    ctx.api()
        .test_store()
        .save_worktree_record(&ready_record)
        .expect("save ready record");

    // Startup recovery: cleanup preserves the Ready record, then
    // retry_pending_adoptions adopts it (consuming the record).
    ctx.run_startup_recovery();

    // If cleanup had incorrectly deleted the record, adoption would never run
    // and worktree_path would still be None. A set worktree_path proves the
    // preserve branch fired and adoption succeeded.
    let task_after = ctx.api().get_task("live-task-no-wt").expect("store query");
    assert!(
        task_after.worktree_path.is_some(),
        "task must have worktree_path after recovery — proves cleanup preserved the Ready record so retry_pending_adoptions could adopt it"
    );
}

// =============================================================================
// Startup cleanup preserves Ready records, deletes Pending records
// =============================================================================

#[test]
fn test_cleanup_preserves_ready_records_deletes_pending() {
    let ctx = TestEnv::with_git(&two_stage_workflow(), &["planning", "work"]);

    let task_id_a = "cleanup-task-a";
    let task_id_b = "cleanup-task-b";

    // Create task_a with a real prewarmed worktree.
    ctx.api()
        .prewarm_worktree(task_id_a, None)
        .expect("prewarm task_a");
    ctx.api()
        .create_chat_task_with_prewarm(task_id_a, "Chat A", None)
        .expect("create chat_a");

    // Create task_b with a real prewarmed worktree.
    ctx.api()
        .prewarm_worktree(task_id_b, None)
        .expect("prewarm task_b");
    ctx.api()
        .create_chat_task_with_prewarm(task_id_b, "Chat B", None)
        .expect("create chat_b");

    // Overwrite with a Pending record for task_b — simulates a dead prewarm thread.
    let pending_record = WorktreeRecord {
        task_id: task_id_b.to_string(),
        status: WorktreeStatus::Pending,
        base_branch: None,
        worktree_path: None,
        branch_name: None,
        base_commit: None,
        created_at: chrono::Utc::now().to_rfc3339(),
    };
    ctx.api()
        .test_store()
        .save_worktree_record(&pending_record)
        .expect("save pending record for task_b");

    // Save a Ready record for a task that doesn't exist — orphaned record.
    let orphan_record = WorktreeRecord {
        task_id: "nonexistent-task-id".to_string(),
        status: WorktreeStatus::Ready,
        worktree_path: Some("/tmp/ghost".to_string()),
        branch_name: Some("task/ghost".to_string()),
        base_commit: Some("abc123".to_string()),
        base_branch: Some("main".to_string()),
        created_at: chrono::Utc::now().to_rfc3339(),
    };
    ctx.api()
        .test_store()
        .save_worktree_record(&orphan_record)
        .expect("save orphan record");

    ctx.run_startup_recovery();

    // Orphaned record (no matching task) must be deleted.
    assert!(
        ctx.api()
            .test_store()
            .get_worktree_record("nonexistent-task-id")
            .expect("store query")
            .is_none(),
        "Ready record for non-existent task must be deleted by cleanup"
    );

    // Pending record for an existing task must be deleted (dead prewarm thread).
    assert!(
        ctx.api()
            .test_store()
            .get_worktree_record(task_id_b)
            .expect("store query")
            .is_none(),
        "Pending record for existing task must be deleted by cleanup"
    );
}

// =============================================================================
// Full deferred-adopt → promote → recovery lifecycle
// =============================================================================

#[test]
fn test_deferred_adopt_promote_survives_cleanup() {
    let ctx = TestEnv::with_git(&two_stage_workflow(), &["planning", "work"]);

    let task_id = "deferred-promote-recover";

    // Save a Pending record — prewarm not yet done.
    let pending_record = WorktreeRecord {
        task_id: task_id.to_string(),
        status: WorktreeStatus::Pending,
        base_branch: None,
        worktree_path: None,
        branch_name: None,
        base_commit: None,
        created_at: chrono::Utc::now().to_rfc3339(),
    };
    ctx.api()
        .test_store()
        .save_worktree_record(&pending_record)
        .expect("save pending record");

    // Create chat task — adoption skipped, worktree_path = None.
    let task = ctx
        .api()
        .create_chat_task_with_prewarm(task_id, "Deferred promote chat", None)
        .expect("create chat should succeed");
    assert!(
        task.worktree_path.is_none(),
        "worktree_path should be None when prewarm is Pending"
    );

    // Simulate prewarm completing: create real worktree, upgrade record to Ready.
    let wt_result = ctx
        .api()
        .git_service()
        .expect("git service required")
        .ensure_worktree(task_id, None)
        .expect("ensure_worktree should succeed");

    let ready_record = WorktreeRecord {
        task_id: task_id.to_string(),
        status: WorktreeStatus::Ready,
        worktree_path: Some(wt_result.worktree_path.to_string_lossy().into()),
        branch_name: Some(wt_result.branch_name.clone()),
        base_commit: Some(wt_result.base_commit.clone()),
        base_branch: Some("main".into()),
        created_at: chrono::Utc::now().to_rfc3339(),
    };
    ctx.api()
        .test_store()
        .save_worktree_record(&ready_record)
        .expect("save ready record");

    // Tick runs deferred adoption.
    ctx.advance();

    let adopted = ctx.api().get_task(task_id).expect("task should exist");
    let worktree_path = adopted
        .worktree_path
        .clone()
        .expect("worktree_path should be set after deferred adoption");

    // Promote chat → flow; task has worktree_path so setup is skipped.
    let promoted = ctx
        .api()
        .promote_to_flow(task_id, None, None, None, None, None)
        .expect("promote should succeed");

    assert!(
        matches!(promoted.state, TaskState::Queued { .. }),
        "promoted task with worktree should be Queued, not AwaitingSetup, got: {:?}",
        promoted.state
    );

    // Simulate restart: startup recovery should preserve the Ready record for
    // an existing task and leave the worktree intact.
    ctx.run_startup_recovery();

    let recovered = ctx
        .api()
        .get_task(task_id)
        .expect("task should survive recovery");
    assert!(
        recovered.worktree_path.is_some(),
        "worktree_path should survive startup recovery"
    );

    // Worktree directory must still exist on disk.
    assert!(
        std::path::Path::new(&worktree_path).exists(),
        "worktree directory must still exist on disk after recovery"
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

// =============================================================================
// Cleanup preserves prewarm worktrees (Bug 3 fix)
// =============================================================================

#[test]
fn test_prewarm_cleanup_preserves_worktree_with_record() {
    let ctx = TestEnv::with_git(&two_stage_workflow(), &["planning", "work"]);
    let task_id = "prewarm-cleanup-preserve";

    // Prewarm (sync mode → immediately Ready, creates real git worktree)
    ctx.api()
        .prewarm_worktree(task_id, None)
        .expect("prewarm should succeed");

    // Get the worktree path from the record
    let record = ctx
        .api()
        .test_store()
        .get_worktree_record(task_id)
        .expect("store query")
        .expect("record should exist after prewarm");
    let wt_path = record.worktree_path.expect("worktree_path should be set");

    assert!(
        std::path::Path::new(&wt_path).exists(),
        "worktree directory should exist before cleanup"
    );

    // Force cleanup and advance one tick
    ctx.force_periodic_due("cleanup_worktrees");
    ctx.advance();

    // Worktree directory must still exist (prewarm record protects it)
    assert!(
        std::path::Path::new(&wt_path).exists(),
        "worktree directory should still exist after cleanup — prewarm record protects it"
    );

    // Record must still exist in the store (not yet adopted by any task)
    let record_after = ctx
        .api()
        .test_store()
        .get_worktree_record(task_id)
        .expect("store query");
    assert!(
        record_after.is_some(),
        "worktree record should still exist after cleanup"
    );
}

// =============================================================================
// Cleanup removes truly orphaned worktrees (regression guard)
// =============================================================================

#[test]
fn test_cleanup_still_removes_truly_orphaned_worktrees() {
    let ctx = TestEnv::with_git(&two_stage_workflow(), &["planning", "work"]);
    let task_id = "orphaned-worktree-cleanup";

    // Prewarm (creates real git worktree + Ready record)
    ctx.api()
        .prewarm_worktree(task_id, None)
        .expect("prewarm should succeed");

    // Get the worktree path before deleting the record
    let record = ctx
        .api()
        .test_store()
        .get_worktree_record(task_id)
        .expect("store query")
        .expect("record should exist after prewarm");
    let wt_path = record.worktree_path.expect("worktree_path should be set");

    assert!(
        std::path::Path::new(&wt_path).exists(),
        "worktree directory should exist before test"
    );

    // Delete the record — simulates a truly orphaned worktree (no task, no record)
    ctx.api()
        .test_store()
        .delete_worktree_record(task_id)
        .expect("delete record");

    // Force cleanup and advance
    ctx.force_periodic_due("cleanup_worktrees");
    ctx.advance();

    // Orphaned worktree must be removed
    assert!(
        !std::path::Path::new(&wt_path).exists(),
        "orphaned worktree should be removed by cleanup"
    );
}

// =============================================================================
// Title generation does not clobber task state (Bug 2 fix)
// =============================================================================

#[test]
fn test_title_gen_does_not_clobber_task_state() {
    let (api, store, _tmp) = create_api_with_store();
    let task_id = "title-gen-state-test";

    // Create a task (empty title triggers title generation in setup)
    api.create_task_with_prewarm(
        task_id,
        "",
        "Implement the widget feature",
        None,
        orkestra_core::workflow::domain::TaskCreationMode::Normal,
        None,
        false,
        false,
    )
    .expect("create should succeed");

    // Manually advance state to AgentWorking and save (simulates race:
    // orchestrator advanced the task while title-gen is still running)
    let mut task = store
        .get_task(task_id)
        .expect("store query")
        .expect("task should exist");
    let stage = task.current_stage().unwrap_or("planning").to_string();
    task.state = TaskState::agent_working(&stage);
    store.save_task(&task).expect("save task with AgentWorking");

    // Call update_task_title — this is what generate_title::execute uses.
    // The fix: targeted SQL UPDATE on the title column only, not a save_task
    // that would overwrite the whole record and revert state to Queued.
    store
        .update_task_title(task_id, "Generated Task Title")
        .expect("update title should succeed");

    // Reload and verify state was not clobbered
    let reloaded = store
        .get_task(task_id)
        .expect("store query")
        .expect("task should exist");

    assert!(
        matches!(reloaded.state, TaskState::AgentWorking { .. }),
        "state must not be clobbered by title update, got: {:?}",
        reloaded.state
    );
    assert_eq!(
        reloaded.title, "Generated Task Title",
        "title should be updated by targeted update"
    );
}

// =============================================================================
// Invalid worktree falls back to normal setup (validity guard fix)
// =============================================================================

#[test]
fn test_invalid_worktree_falls_back_to_setup() {
    let ctx = TestEnv::with_git(&two_stage_workflow(), &["planning", "work"]);
    let task_id = "invalid-wt-fallback";

    // Save a Ready record pointing to a path with no .git file.
    // Using a non-existent path ensures git2 won't find a registered worktree
    // for this task_id, so normal setup can create a real one.
    let fake_record = WorktreeRecord {
        task_id: task_id.to_string(),
        status: WorktreeStatus::Ready,
        base_branch: None,
        worktree_path: Some("/nonexistent/prewarm/worktree".to_string()),
        branch_name: None,
        base_commit: None,
        created_at: chrono::Utc::now().to_rfc3339(),
    };
    ctx.api()
        .test_store()
        .save_worktree_record(&fake_record)
        .expect("save fake record");

    // Create task — validity guard sees no .git at the fake path → rejects adoption
    let task = ctx
        .api()
        .create_task_with_prewarm(
            task_id,
            "Invalid worktree test",
            "Description",
            None,
            orkestra_core::workflow::domain::TaskCreationMode::Normal,
            None,
            false,
            false,
        )
        .expect("create should succeed");

    // Task must fall back to AwaitingSetup (not Queued)
    assert!(
        matches!(task.state, TaskState::AwaitingSetup { .. }),
        "task should fall back to AwaitingSetup when prewarm worktree is invalid, got: {:?}",
        task.state
    );

    // Advance: setup_awaiting_tasks runs → creates a real worktree → task moves to Queued
    ctx.advance();

    let after_setup = ctx.api().get_task(task_id).expect("task should exist");

    assert!(
        matches!(after_setup.state, TaskState::Queued { .. }),
        "task should be Queued after setup completes, got: {:?}",
        after_setup.state
    );
    assert!(
        after_setup.worktree_path.is_some(),
        "task should have a valid worktree_path after setup"
    );
}

// =============================================================================
// Prewarmed worktree adoption happy path still works with validity guard (Test 5)
// =============================================================================

#[test]
fn test_prewarm_setup_is_idempotent() {
    let (api, _store, _tmp) = create_api_with_store();
    let task_id = "prewarm-idempotent";

    // Prewarm (sync mode → creates real git worktree with .git file)
    api.prewarm_worktree(task_id, None)
        .expect("prewarm should succeed");

    // Create task — validity guard checks .git file, finds it valid, adoption succeeds
    let task = api
        .create_task_with_prewarm(
            task_id,
            "Idempotent prewarm test",
            "Description",
            None,
            orkestra_core::workflow::domain::TaskCreationMode::Normal,
            None,
            false,
            false,
        )
        .expect("create should succeed");

    // Happy path: task starts in Queued (worktree adopted, not AwaitingSetup)
    assert!(
        matches!(task.state, TaskState::Queued { .. }),
        "task with valid prewarm should start in Queued, got: {:?}",
        task.state
    );
    assert!(
        task.worktree_path.is_some(),
        "task should have worktree_path after successful adoption"
    );

    // Verify the adopted worktree directory actually has a .git file
    let wt_path = task.worktree_path.as_ref().unwrap();
    assert!(
        std::path::Path::new(wt_path).join(".git").exists(),
        "adopted worktree must have a .git file"
    );
}
