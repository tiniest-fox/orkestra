//! Task CRUD command handlers: create, read, list, delete operations.

use std::collections::HashMap;

use orkestra_core::workflow::TaskCreationMode;
use serde_json::Value;

use crate::types::ErrorPayload;

use super::dispatch::CommandContext;

/// Returns active top-level tasks as views.
///
/// When params contains a `since` map (`{ task_id: updated_at }`), returns a
/// `DifferentialTaskResponse` with only changed tasks and deleted IDs.
/// Without `since`, returns the full `Vec<TaskView>` (backwards compatible).
/// Returns an error when `since` is present but not a valid `{ id: timestamp }` map.
pub fn list_tasks(ctx: &CommandContext, params: &Value) -> Result<Value, ErrorPayload> {
    let api = ctx.api.lock().map_err(|_| ErrorPayload::lock_error())?;

    let since_value = params.get("since");

    if let Some(raw) = since_value {
        // `since` is present — must be a valid `{ task_id: updated_at }` map.
        let timestamps = serde_json::from_value::<HashMap<String, String>>(raw.clone())
            .map_err(|e| ErrorPayload::invalid_params(format!("invalid `since` map: {e}")))?;
        let diff = api
            .list_task_views_differential(&timestamps)
            .map_err(ErrorPayload::from)?;
        Ok(serde_json::to_value(diff).unwrap_or(Value::Null))
    } else {
        let tasks = api.list_task_views().map_err(ErrorPayload::from)?;
        Ok(serde_json::to_value(tasks).unwrap_or(Value::Array(vec![])))
    }
}

/// Returns a single task by ID.
///
/// Expected params: `{ "task_id": "<id>" }`
pub fn get_task(ctx: &CommandContext, params: &Value) -> Result<Value, ErrorPayload> {
    let task_id = super::extract_task_id(params)?;
    let api = ctx.api.lock().map_err(|_| ErrorPayload::lock_error())?;
    let task = api.get_task(&task_id).map_err(ErrorPayload::from)?;
    Ok(serde_json::to_value(task).unwrap_or(Value::Null))
}

/// Creates a new task.
///
/// Expected params: `{ "title": "<title>", "description": "<desc>", "base_branch": "<branch>",
/// "auto_mode": <bool>, "flow": "<flow_name>" }`
///
/// `base_branch` and `flow` are optional.
pub fn create_task(ctx: &CommandContext, params: &Value) -> Result<Value, ErrorPayload> {
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

    let api = ctx.api.lock().map_err(|_| ErrorPayload::lock_error())?;
    let task = api
        .create_task_with_options(
            &title,
            &description,
            base_branch.as_deref(),
            if auto_mode {
                TaskCreationMode::AutoMode
            } else {
                TaskCreationMode::Normal
            },
            flow.as_deref(),
        )
        .map_err(ErrorPayload::from)?;
    Ok(serde_json::to_value(task).unwrap_or(Value::Null))
}

/// Creates a subtask under a parent task.
///
/// Expected params: `{ "parent_id": "<id>", "title": "<title>", "description": "<desc>" }`
pub fn create_subtask(ctx: &CommandContext, params: &Value) -> Result<Value, ErrorPayload> {
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

    let api = ctx.api.lock().map_err(|_| ErrorPayload::lock_error())?;
    let task = api
        .create_subtask(&parent_id, &title, &description)
        .map_err(ErrorPayload::from)?;
    Ok(serde_json::to_value(task).unwrap_or(Value::Null))
}

/// Deletes a task and all associated data.
///
/// Expected params: `{ "task_id": "<id>" }`
pub fn delete_task(ctx: &CommandContext, params: &Value) -> Result<Value, ErrorPayload> {
    let task_id = super::extract_task_id(params)?;
    let api = ctx.api.lock().map_err(|_| ErrorPayload::lock_error())?;
    api.delete_task_with_cleanup(&task_id)
        .map_err(ErrorPayload::from)?;
    Ok(Value::Null)
}

/// Returns subtasks of a parent task.
///
/// Expected params: `{ "parent_id": "<id>" }`
pub fn list_subtasks(ctx: &CommandContext, params: &Value) -> Result<Value, ErrorPayload> {
    let parent_id = params
        .get("parent_id")
        .and_then(|v| v.as_str())
        .ok_or_else(|| ErrorPayload::invalid_params("missing field: parent_id"))?
        .to_string();

    let api = ctx.api.lock().map_err(|_| ErrorPayload::lock_error())?;
    let tasks = api
        .list_subtask_views(&parent_id)
        .map_err(ErrorPayload::from)?;
    Ok(serde_json::to_value(tasks).unwrap_or(Value::Array(vec![])))
}

/// Returns all archived top-level tasks.
pub fn get_archived_tasks(ctx: &CommandContext, _params: &Value) -> Result<Value, ErrorPayload> {
    let api = ctx.api.lock().map_err(|_| ErrorPayload::lock_error())?;
    let tasks = api.list_archived_task_views().map_err(ErrorPayload::from)?;
    Ok(serde_json::to_value(tasks).unwrap_or(Value::Array(vec![])))
}

/// Creates a new chat task (no workflow, no worktree).
///
/// Expected params: `{ "title": "<title>" }`
pub fn create_chat_task(ctx: &CommandContext, params: &Value) -> Result<Value, ErrorPayload> {
    let title = params
        .get("title")
        .and_then(|v| v.as_str())
        .unwrap_or("New Chat")
        .to_string();
    let api = ctx.api.lock().map_err(|_| ErrorPayload::lock_error())?;
    let task = api.create_chat_task(&title).map_err(ErrorPayload::from)?;
    Ok(serde_json::to_value(task).unwrap_or(Value::Null))
}
