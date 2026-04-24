//! Routes incoming method names to their command handlers.

use std::path::PathBuf;
use std::sync::{Arc, Mutex};

use orkestra_core::workflow::execution::ProviderRegistry;
use orkestra_core::workflow::ports::WorkflowStore;
use orkestra_core::workflow::{AssistantService, WorkflowApi};
use rusqlite::Connection;
use serde_json::Value;
use tokio::sync::broadcast;

use crate::diff_cache::DiffCacheState;
use crate::highlight::SyntaxHighlighter;
use crate::interactions::auth::{generate_pairing_code, list_devices, revoke_device};
use crate::types::{ErrorPayload, Event};

use super::{action, assistant, diff, git, query, task};

// ============================================================================
// Command Context
// ============================================================================

/// Shared context passed to every command handler.
///
/// Bundles the API lock, project root (for template loading), diff-related
/// state, and the auth DB connection so handlers can take what they need
/// without growing argument lists.
pub struct CommandContext {
    pub(crate) api: Arc<Mutex<WorkflowApi>>,
    pub(crate) project_root: Arc<PathBuf>,
    pub(crate) highlighter: Arc<SyntaxHighlighter>,
    pub(crate) diff_cache: Arc<DiffCacheState>,
    pub(crate) conn: Arc<Mutex<Connection>>,
    pub(crate) provider_registry: Arc<ProviderRegistry>,
    pub(crate) store: Arc<dyn WorkflowStore>,
}

impl CommandContext {
    /// Construct a new `CommandContext` with a fresh syntax highlighter and diff cache.
    pub fn new(
        api: Arc<Mutex<WorkflowApi>>,
        conn: Arc<Mutex<Connection>>,
        project_root: PathBuf,
        provider_registry: Arc<ProviderRegistry>,
        store: Arc<dyn WorkflowStore>,
    ) -> Self {
        Self {
            api,
            conn,
            project_root: Arc::new(project_root),
            highlighter: Arc::new(SyntaxHighlighter::new()),
            diff_cache: Arc::new(DiffCacheState::new()),
            provider_registry,
            store,
        }
    }

    /// Construct an `AssistantService` bound to this context's store, registry, and project root.
    pub(crate) fn create_assistant_service(&self) -> AssistantService {
        AssistantService::new(
            Arc::clone(&self.store),
            Arc::clone(&self.provider_registry),
            (*self.project_root).clone(),
        )
    }
}

// ============================================================================
// Dispatch
// ============================================================================

/// Run a synchronous handler on a blocking thread.
///
/// All shared handlers have the signature `fn(&CommandContext, Value) -> Result<Value, ErrorPayload>`.
/// This wrapper offloads them to a `spawn_blocking` thread so they don't block the async runtime.
async fn run_sync(
    ctx: Arc<CommandContext>,
    params: Value,
    f: fn(&CommandContext, &Value) -> Result<Value, ErrorPayload>,
) -> Result<Value, ErrorPayload> {
    tokio::task::spawn_blocking(move || f(&ctx, &params))
        .await
        .map_err(|e| ErrorPayload::internal(e.to_string()))?
}

/// Dispatch a method call to the appropriate handler.
///
/// Returns the handler's result or an error if the method is unknown.
pub async fn execute(
    method: &str,
    ctx: Arc<CommandContext>,
    event_tx: broadcast::Sender<Event>,
    params: Value,
) -> Result<Value, ErrorPayload> {
    match method {
        "ping" => Ok(serde_json::json!({})),

        // -- Task CRUD --
        "list_tasks" => run_sync(ctx, params, task::list_tasks).await,
        "get_task" => run_sync(ctx, params, task::get_task).await,
        "create_task" => run_sync(ctx, params, task::create_task).await,
        "create_subtask" => run_sync(ctx, params, task::create_subtask).await,
        "delete_task" => run_sync(ctx, params, task::delete_task).await,
        "list_subtasks" => run_sync(ctx, params, task::list_subtasks).await,
        "get_archived_tasks" => run_sync(ctx, params, task::get_archived_tasks).await,
        "create_chat_task" => run_sync(ctx, params, task::create_chat_task).await,

        // -- Human actions (synchronous) --
        "approve" => run_sync(ctx, params, action::approve).await,
        "answer_questions" => run_sync(ctx, params, action::answer_questions).await,
        "set_auto_mode" => run_sync(ctx, params, action::set_auto_mode).await,
        "interrupt" => run_sync(ctx, params, action::interrupt).await,
        "archive" => run_sync(ctx, params, action::archive).await,
        "reject_with_comments" => run_sync(ctx, params, action::reject_with_comments).await,
        "address_pr_feedback" => run_sync(ctx, params, action::address_pr_feedback).await,
        "address_pr_conflicts" => run_sync(ctx, params, action::address_pr_conflicts).await,
        "request_update" => run_sync(ctx, params, action::request_update).await,
        "push_pr_changes" => run_sync(ctx, params, action::push_pr_changes).await,
        "force_push_pr_changes" => run_sync(ctx, params, action::force_push_pr_changes).await,
        "pull_pr_changes" => run_sync(ctx, params, action::pull_pr_changes).await,
        "retry_pr" => run_sync(ctx, params, action::retry_pr).await,
        "skip_stage" => run_sync(ctx, params, action::skip_stage).await,
        "send_to_stage" => run_sync(ctx, params, action::send_to_stage).await,
        "restart_stage" => run_sync(ctx, params, action::restart_stage).await,
        "send_message" => run_sync(ctx, params, action::send_message).await,
        "promote_to_flow" => run_sync(ctx, params, action::promote_to_flow).await,

        // -- Human actions (spawn background work) --
        "merge_task" => action::handle_merge_task(ctx, event_tx, params).await,
        "open_pr" => action::handle_open_pr(ctx, event_tx, params).await,

        // -- Assistant --
        "create_chat_and_send" => run_sync(ctx, params, assistant::create_chat_and_send).await,
        "assistant_send_message" => run_sync(ctx, params, assistant::assistant_send_message).await,
        "assistant_stop" => run_sync(ctx, params, assistant::assistant_stop).await,
        "assistant_list_sessions" => {
            run_sync(ctx, params, assistant::assistant_list_sessions).await
        }
        "assistant_get_logs" => run_sync(ctx, params, assistant::assistant_get_logs).await,
        "assistant_send_task_message" => {
            run_sync(ctx, params, assistant::assistant_send_task_message).await
        }
        "assistant_list_project_sessions" => {
            run_sync(ctx, params, assistant::assistant_list_project_sessions).await
        }

        // -- Queries --
        "get_config" => run_sync(ctx, params, query::get_config).await,
        "get_startup_data" => run_sync(ctx, params, query::get_startup_data).await,
        "get_auto_task_templates" => run_sync(ctx, params, query::get_auto_task_templates).await,
        "get_iterations" => run_sync(ctx, params, query::get_iterations).await,
        "get_artifact" => run_sync(ctx, params, query::get_artifact).await,
        "get_pending_questions" => run_sync(ctx, params, query::get_pending_questions).await,
        "get_current_stage" => run_sync(ctx, params, query::get_current_stage).await,
        "get_rejection_feedback" => run_sync(ctx, params, query::get_rejection_feedback).await,
        "list_branches" => run_sync(ctx, params, query::list_branches).await,
        "list_project_files" => run_sync(ctx, params, query::list_project_files).await,
        "get_logs" => run_sync(ctx, params, query::get_logs).await,
        "get_latest_log" => run_sync(ctx, params, query::get_latest_log).await,
        "get_pr_status" => run_sync(ctx, params, query::get_pr_status).await,
        "get_project_info" => run_sync(ctx, params, query::get_project_info).await,

        // -- Diffs --
        "get_task_diff" => diff::handle_get_task_diff(ctx, params).await,
        "get_file_content" => diff::handle_get_file_content(ctx, params).await,
        "get_project_file_content" => diff::handle_get_project_file_content(ctx, params).await,
        "get_syntax_css" => Ok(diff::handle_get_syntax_css(&ctx, params)),
        "get_branch_commits" => run_sync(ctx, params, diff::get_branch_commits).await,
        "get_uncommitted_diff" => run_sync(ctx, params, diff::get_uncommitted_diff).await,
        "get_commit_log" => diff::handle_get_commit_log(ctx, params).await,
        "get_batch_file_counts" => diff::handle_get_batch_file_counts(ctx, params).await,
        "get_commit_diff" => diff::handle_get_commit_diff(ctx, params).await,

        // -- Git sync --
        "git_sync_status" => run_sync(ctx, params, git::git_sync_status).await,
        "git_push" => run_sync(ctx, params, git::git_push).await,
        "git_pull" => run_sync(ctx, params, git::git_pull).await,
        "git_fetch" => run_sync(ctx, params, git::git_fetch).await,
        "task_sync_status" => run_sync(ctx, params, git::task_sync_status).await,

        // -- Device management --
        "list_devices" => handle_list_devices(Arc::clone(&ctx.conn)).await,
        "revoke_device" => handle_revoke_device(Arc::clone(&ctx.conn), params).await,
        "generate_pairing_code" => handle_generate_pairing_code(Arc::clone(&ctx.conn)).await,

        _ => Err(ErrorPayload::method_not_found(method)),
    }
}

// -- Device management handlers --

async fn handle_list_devices(conn: Arc<Mutex<Connection>>) -> Result<Value, ErrorPayload> {
    tokio::task::spawn_blocking(move || {
        list_devices::execute(&conn)
            .map(|devices| serde_json::to_value(devices).unwrap_or(Value::Array(vec![])))
            .map_err(|e| ErrorPayload::internal(e.to_string()))
    })
    .await
    .map_err(|e| ErrorPayload::internal(e.to_string()))?
}

async fn handle_revoke_device(
    conn: Arc<Mutex<Connection>>,
    params: Value,
) -> Result<Value, ErrorPayload> {
    let device_id = params
        .get("device_id")
        .and_then(|v| v.as_str())
        .ok_or_else(|| ErrorPayload::invalid_params("missing field: device_id"))?
        .to_string();

    tokio::task::spawn_blocking(move || {
        revoke_device::execute(&conn, &device_id)
            .map(|()| serde_json::json!({"revoked": true}))
            .map_err(|e| ErrorPayload::internal(e.to_string()))
    })
    .await
    .map_err(|e| ErrorPayload::internal(e.to_string()))?
}

async fn handle_generate_pairing_code(conn: Arc<Mutex<Connection>>) -> Result<Value, ErrorPayload> {
    tokio::task::spawn_blocking(move || {
        generate_pairing_code::execute(&conn)
            .map(|code| serde_json::json!({"code": code}))
            .map_err(|e| ErrorPayload::internal(e.to_string()))
    })
    .await
    .map_err(|e| ErrorPayload::internal(e.to_string()))?
}
