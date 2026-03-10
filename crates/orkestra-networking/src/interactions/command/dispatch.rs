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

use super::{action, assistant, diff, git, query, stage_chat, task};

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
        // -- Task CRUD --
        "list_tasks" => task::handle_list_tasks(ctx, params).await,
        "get_task" => task::handle_get_task(ctx, params).await,
        "create_task" => task::handle_create_task(ctx, params).await,
        "create_subtask" => task::handle_create_subtask(ctx, params).await,
        "delete_task" => task::handle_delete_task(ctx, params).await,
        "list_subtasks" => task::handle_list_subtasks(ctx, params).await,
        "get_archived_tasks" => task::handle_get_archived_tasks(ctx, params).await,

        // -- Human actions (synchronous) --
        "approve" => action::handle_approve(ctx, params).await,
        "reject" => action::handle_reject(ctx, params).await,
        "answer_questions" => action::handle_answer_questions(ctx, params).await,
        "retry" => action::handle_retry(ctx, params).await,
        "set_auto_mode" => action::handle_set_auto_mode(ctx, params).await,
        "interrupt" => action::handle_interrupt(ctx, params).await,
        "resume" => action::handle_resume(ctx, params).await,
        "archive" => action::handle_archive(ctx, params).await,
        "reject_with_comments" => action::handle_reject_with_comments(ctx, params).await,
        "address_pr_feedback" => action::handle_address_pr_feedback(ctx, params).await,
        "address_pr_conflicts" => action::handle_address_pr_conflicts(ctx, params).await,
        "request_update" => action::handle_request_update(ctx, params).await,
        "push_pr_changes" => action::handle_push_pr_changes(ctx, params).await,
        "pull_pr_changes" => action::handle_pull_pr_changes(ctx, params).await,
        "retry_pr" => action::handle_retry_pr(ctx, params).await,
        "return_to_work" => action::handle_return_to_work(ctx, params).await,

        // -- Human actions (spawn background work) --
        "merge_task" => action::handle_merge_task(ctx, event_tx, params).await,
        "open_pr" => action::handle_open_pr(ctx, event_tx, params).await,

        // -- Stage chat --
        "stage_chat_send" => stage_chat::handle_stage_chat_send(ctx, params).await,
        "stage_chat_stop" => stage_chat::handle_stage_chat_stop(ctx, params).await,

        // -- Assistant --
        "assistant_send_message" => assistant::handle_assistant_send_message(ctx, params).await,
        "assistant_stop" => assistant::handle_assistant_stop(ctx, params).await,
        "assistant_list_sessions" => assistant::handle_assistant_list_sessions(ctx, params).await,
        "assistant_get_logs" => assistant::handle_assistant_get_logs(ctx, params).await,
        "assistant_send_task_message" => {
            assistant::handle_assistant_send_task_message(ctx, params).await
        }
        "assistant_list_project_sessions" => {
            assistant::handle_assistant_list_project_sessions(ctx, params).await
        }

        // -- Queries --
        "get_config" => query::handle_get_config(ctx, params).await,
        "get_startup_data" => query::handle_get_startup_data(ctx, params).await,
        "get_auto_task_templates" => query::handle_get_auto_task_templates(ctx, params).await,
        "get_iterations" => query::handle_get_iterations(ctx, params).await,
        "get_artifact" => query::handle_get_artifact(ctx, params).await,
        "get_pending_questions" => query::handle_get_pending_questions(ctx, params).await,
        "get_current_stage" => query::handle_get_current_stage(ctx, params).await,
        "get_rejection_feedback" => query::handle_get_rejection_feedback(ctx, params).await,
        "list_branches" => query::handle_list_branches(ctx, params).await,
        "get_logs" => query::handle_get_logs(ctx, params).await,
        "get_latest_log" => query::handle_get_latest_log(ctx, params).await,
        "get_pr_status" => query::handle_get_pr_status(ctx, params).await,
        "get_project_info" => query::handle_get_project_info(ctx, params).await,

        // -- Diffs --
        "get_task_diff" => diff::handle_get_task_diff(ctx, params).await,
        "get_file_content" => diff::handle_get_file_content(ctx, params).await,
        "get_syntax_css" => Ok(diff::handle_get_syntax_css(&ctx, params)),
        "get_commit_log" => diff::handle_get_commit_log(ctx, params).await,
        "get_batch_file_counts" => diff::handle_get_batch_file_counts(ctx, params).await,
        "get_commit_diff" => diff::handle_get_commit_diff(ctx, params).await,

        // -- Git sync --
        "git_sync_status" => git::handle_git_sync_status(ctx, params).await,
        "git_push" => git::handle_git_push(ctx, params).await,
        "git_pull" => git::handle_git_pull(ctx, params).await,
        "git_fetch" => git::handle_git_fetch(ctx, params).await,

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
