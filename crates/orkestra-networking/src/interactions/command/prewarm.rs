//! Prewarm command handlers: trigger and cancel background worktree prewarming.

use serde_json::{json, Value};

use crate::types::ErrorPayload;

use super::dispatch::CommandContext;

/// Triggers background prewarming for a future task worktree.
///
/// Expected params: `{ "task_id": "<id>", "base_branch": "<branch>" (optional) }`
pub fn prewarm_worktree(ctx: &CommandContext, params: &Value) -> Result<Value, ErrorPayload> {
    let task_id = super::extract_task_id(params)?;
    let base_branch = params
        .get("base_branch")
        .and_then(|v| v.as_str())
        .map(ToString::to_string);

    let api = ctx.api.lock().map_err(|_| ErrorPayload::lock_error())?;
    api.prewarm_worktree(&task_id, base_branch.as_deref())
        .map_err(ErrorPayload::from)?;
    Ok(json!({ "ok": true }))
}

/// Cancels a pending prewarm and removes the worktree record.
///
/// Expected params: `{ "task_id": "<id>" }`
pub fn cancel_prewarm(ctx: &CommandContext, params: &Value) -> Result<Value, ErrorPayload> {
    let task_id = super::extract_task_id(params)?;
    let api = ctx.api.lock().map_err(|_| ErrorPayload::lock_error())?;
    api.cancel_prewarm(&task_id).map_err(ErrorPayload::from)?;
    Ok(json!({ "ok": true }))
}

// ============================================================================
// Tests
// ============================================================================

#[cfg(test)]
mod tests {
    use super::*;
    use std::path::PathBuf;
    use std::sync::{Arc, Mutex};

    use orkestra_core::adapters::sqlite::DatabaseConnection;
    use orkestra_core::workflow::{
        config::{StageConfig, WorkflowConfig},
        execution::ProviderRegistry,
        SqliteWorkflowStore, WorkflowApi, WorkflowStore,
    };

    fn test_workflow() -> WorkflowConfig {
        WorkflowConfig::new(vec![StageConfig::new("work", "summary")])
    }

    fn make_ctx() -> Arc<CommandContext> {
        let conn = DatabaseConnection::in_memory().expect("in-memory DB");
        let raw_conn = conn.shared();
        let store: Arc<dyn WorkflowStore> = Arc::new(SqliteWorkflowStore::new(conn.shared()));
        let api = WorkflowApi::new(test_workflow(), store.clone());
        Arc::new(CommandContext::new(
            Arc::new(Mutex::new(api)),
            raw_conn,
            PathBuf::new(),
            Arc::new(ProviderRegistry::new("claudecode")),
            store,
        ))
    }

    #[test]
    fn prewarm_worktree_missing_task_id_returns_error() {
        let ctx = make_ctx();
        let result = prewarm_worktree(&ctx, &serde_json::json!({}));
        assert!(result.is_err());
        let err = result.unwrap_err();
        assert_eq!(err.code, "INVALID_PARAMS");
    }

    #[test]
    fn cancel_prewarm_missing_task_id_returns_error() {
        let ctx = make_ctx();
        let result = cancel_prewarm(&ctx, &serde_json::json!({}));
        assert!(result.is_err());
        let err = result.unwrap_err();
        assert_eq!(err.code, "INVALID_PARAMS");
    }

    #[test]
    fn prewarm_worktree_no_git_returns_error() {
        // No git service configured — prewarm_worktree must fail with a meaningful error.
        let ctx = make_ctx();
        let result = prewarm_worktree(
            &ctx,
            &serde_json::json!({ "task_id": "test-task-id", "base_branch": "main" }),
        );
        // Fails because no git service is configured (not because of missing params).
        assert!(result.is_err());
        let err = result.unwrap_err();
        assert_ne!(
            err.code, "INVALID_PARAMS",
            "should fail for git, not params"
        );
    }

    #[test]
    fn cancel_prewarm_nonexistent_task_returns_ok() {
        // DELETE of a nonexistent row is a no-op in SQLite — returns Ok.
        let ctx = make_ctx();
        let result = cancel_prewarm(
            &ctx,
            &serde_json::json!({ "task_id": "nonexistent-task-id" }),
        );
        assert!(result.is_ok());
        assert_eq!(result.unwrap()["ok"], true);
    }
}
