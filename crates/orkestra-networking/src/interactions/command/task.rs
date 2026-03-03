//! Task CRUD command handlers: create, read, list, delete operations.

use std::sync::Arc;

use serde_json::Value;

use crate::types::ErrorPayload;

use super::dispatch::CommandContext;

/// Handle the `list_tasks` method — returns all active top-level tasks as views.
pub(super) async fn handle_list_tasks(
    ctx: Arc<CommandContext>,
    _params: Value,
) -> Result<Value, ErrorPayload> {
    let api = Arc::clone(&ctx.api);
    tokio::task::spawn_blocking(move || {
        let api = api.lock().map_err(|_| ErrorPayload::lock_error())?;
        let tasks = api.list_task_views().map_err(ErrorPayload::from)?;
        Ok(serde_json::to_value(tasks).unwrap_or(Value::Array(vec![])))
    })
    .await
    .map_err(|e| ErrorPayload::internal(e.to_string()))?
}

/// Handle the `get_task` method — returns a single task by ID.
///
/// Expected params: `{ "task_id": "<id>" }`
pub(super) async fn handle_get_task(
    ctx: Arc<CommandContext>,
    params: Value,
) -> Result<Value, ErrorPayload> {
    let task_id = super::extract_task_id(&params)?;
    let api = Arc::clone(&ctx.api);
    tokio::task::spawn_blocking(move || {
        let api = api.lock().map_err(|_| ErrorPayload::lock_error())?;
        let task = api.get_task(&task_id).map_err(ErrorPayload::from)?;
        Ok(serde_json::to_value(task).unwrap_or(Value::Null))
    })
    .await
    .map_err(|e| ErrorPayload::internal(e.to_string()))?
}

/// Handle the `create_task` method — creates a new task.
///
/// Expected params: `{ "title": "<title>", "description": "<desc>", "base_branch": "<branch>" }`
pub(super) async fn handle_create_task(
    ctx: Arc<CommandContext>,
    params: Value,
) -> Result<Value, ErrorPayload> {
    let title = params
        .get("title")
        .and_then(|v| v.as_str())
        .ok_or_else(|| ErrorPayload::invalid_params("missing field: title"))?
        .to_string();

    let description = params
        .get("description")
        .and_then(|v| v.as_str())
        .unwrap_or("")
        .to_string();

    let base_branch = params
        .get("base_branch")
        .and_then(|v| v.as_str())
        .map(ToString::to_string);

    let auto_mode = params
        .get("auto_mode")
        .and_then(serde_json::Value::as_bool)
        .unwrap_or(false);

    let flow = params
        .get("flow")
        .and_then(|v| v.as_str())
        .map(ToString::to_string);

    let api = Arc::clone(&ctx.api);
    tokio::task::spawn_blocking(move || {
        let api = api.lock().map_err(|_| ErrorPayload::lock_error())?;
        let task = api
            .create_task_with_options(
                &title,
                &description,
                base_branch.as_deref(),
                auto_mode,
                flow.as_deref(),
            )
            .map_err(ErrorPayload::from)?;
        Ok(serde_json::to_value(task).unwrap_or(Value::Null))
    })
    .await
    .map_err(|e| ErrorPayload::internal(e.to_string()))?
}

/// Handle the `create_subtask` method — creates a subtask under a parent task.
///
/// Expected params: `{ "parent_id": "<id>", "title": "<title>", "description": "<desc>" }`
pub(super) async fn handle_create_subtask(
    ctx: Arc<CommandContext>,
    params: Value,
) -> Result<Value, ErrorPayload> {
    let parent_id = params
        .get("parent_id")
        .and_then(|v| v.as_str())
        .ok_or_else(|| ErrorPayload::invalid_params("missing field: parent_id"))?
        .to_string();

    let title = params
        .get("title")
        .and_then(|v| v.as_str())
        .ok_or_else(|| ErrorPayload::invalid_params("missing field: title"))?
        .to_string();

    let description = params
        .get("description")
        .and_then(|v| v.as_str())
        .unwrap_or("")
        .to_string();

    let api = Arc::clone(&ctx.api);
    tokio::task::spawn_blocking(move || {
        let api = api.lock().map_err(|_| ErrorPayload::lock_error())?;
        let task = api
            .create_subtask(&parent_id, &title, &description)
            .map_err(ErrorPayload::from)?;
        Ok(serde_json::to_value(task).unwrap_or(Value::Null))
    })
    .await
    .map_err(|e| ErrorPayload::internal(e.to_string()))?
}

/// Handle the `delete_task` method — deletes a task and all associated data.
///
/// Expected params: `{ "task_id": "<id>" }`
pub(super) async fn handle_delete_task(
    ctx: Arc<CommandContext>,
    params: Value,
) -> Result<Value, ErrorPayload> {
    let task_id = super::extract_task_id(&params)?;
    let api = Arc::clone(&ctx.api);
    tokio::task::spawn_blocking(move || {
        let api = api.lock().map_err(|_| ErrorPayload::lock_error())?;
        api.delete_task_with_cleanup(&task_id)
            .map_err(ErrorPayload::from)?;
        Ok(Value::Null)
    })
    .await
    .map_err(|e| ErrorPayload::internal(e.to_string()))?
}

/// Handle the `list_subtasks` method — returns subtasks of a parent task.
///
/// Expected params: `{ "parent_id": "<id>" }`
pub(super) async fn handle_list_subtasks(
    ctx: Arc<CommandContext>,
    params: Value,
) -> Result<Value, ErrorPayload> {
    let parent_id = params
        .get("parent_id")
        .and_then(|v| v.as_str())
        .ok_or_else(|| ErrorPayload::invalid_params("missing field: parent_id"))?
        .to_string();

    let api = Arc::clone(&ctx.api);
    tokio::task::spawn_blocking(move || {
        let api = api.lock().map_err(|_| ErrorPayload::lock_error())?;
        let tasks = api
            .list_subtask_views(&parent_id)
            .map_err(ErrorPayload::from)?;
        Ok(serde_json::to_value(tasks).unwrap_or(Value::Array(vec![])))
    })
    .await
    .map_err(|e| ErrorPayload::internal(e.to_string()))?
}

/// Handle the `get_archived_tasks` method — returns all archived top-level tasks.
pub(super) async fn handle_get_archived_tasks(
    ctx: Arc<CommandContext>,
    _params: Value,
) -> Result<Value, ErrorPayload> {
    let api = Arc::clone(&ctx.api);
    tokio::task::spawn_blocking(move || {
        let api = api.lock().map_err(|_| ErrorPayload::lock_error())?;
        let tasks = api.list_archived_task_views().map_err(ErrorPayload::from)?;
        Ok(serde_json::to_value(tasks).unwrap_or(Value::Array(vec![])))
    })
    .await
    .map_err(|e| ErrorPayload::internal(e.to_string()))?
}
