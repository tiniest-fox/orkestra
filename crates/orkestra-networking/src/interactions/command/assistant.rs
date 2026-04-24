//! Assistant command handlers for the project-level chat panel.

use serde_json::Value;

use crate::types::ErrorPayload;

use super::dispatch::CommandContext;

/// Sends a message to the assistant chat.
///
/// Expected params: `{ "session_id": "<id>" (optional), "message": "<message>" }`
pub fn assistant_send_message(ctx: &CommandContext, params: &Value) -> Result<Value, ErrorPayload> {
    let session_id = params
        .get("session_id")
        .and_then(|v| v.as_str())
        .map(ToString::to_string);

    let message = params
        .get("message")
        .and_then(|v| v.as_str())
        .ok_or_else(|| ErrorPayload::invalid_params("missing field: message"))?
        .to_string();

    let service = ctx.create_assistant_service();
    let session = service
        .send_message(session_id.as_deref(), &message)
        .map_err(ErrorPayload::from)?;
    Ok(serde_json::to_value(session).unwrap_or(Value::Null))
}

/// Stops the running assistant agent.
///
/// Expected params: `{ "session_id": "<id>" }`
pub fn assistant_stop(ctx: &CommandContext, params: &Value) -> Result<Value, ErrorPayload> {
    let session_id = params
        .get("session_id")
        .and_then(|v| v.as_str())
        .ok_or_else(|| ErrorPayload::invalid_params("missing field: session_id"))?
        .to_string();

    let service = ctx.create_assistant_service();
    service
        .stop_process(&session_id)
        .map_err(ErrorPayload::from)?;
    Ok(Value::Null)
}

/// Returns all assistant sessions.
pub fn assistant_list_sessions(
    ctx: &CommandContext,
    _params: &Value,
) -> Result<Value, ErrorPayload> {
    let service = ctx.create_assistant_service();
    let sessions = service.list_sessions().map_err(ErrorPayload::from)?;
    Ok(serde_json::to_value(sessions).unwrap_or(Value::Array(vec![])))
}

/// Returns log entries for an assistant session.
///
/// Expected params: `{ "session_id": "<id>" }`
pub fn assistant_get_logs(ctx: &CommandContext, params: &Value) -> Result<Value, ErrorPayload> {
    let session_id = params
        .get("session_id")
        .and_then(|v| v.as_str())
        .ok_or_else(|| ErrorPayload::invalid_params("missing field: session_id"))?
        .to_string();

    let service = ctx.create_assistant_service();
    let logs = service
        .get_session_logs(&session_id)
        .map_err(ErrorPayload::from)?;
    Ok(serde_json::to_value(logs).unwrap_or(Value::Array(vec![])))
}

/// Sends a message to a task-scoped session.
///
/// Expected params: `{ "task_id": "<id>", "message": "<message>" }`
pub fn assistant_send_task_message(
    ctx: &CommandContext,
    params: &Value,
) -> Result<Value, ErrorPayload> {
    let task_id = params
        .get("task_id")
        .and_then(|v| v.as_str())
        .ok_or_else(|| ErrorPayload::invalid_params("missing field: task_id"))?
        .to_string();
    let message = params
        .get("message")
        .and_then(|v| v.as_str())
        .ok_or_else(|| ErrorPayload::invalid_params("missing field: message"))?
        .to_string();

    let service = ctx.create_assistant_service();
    let session = service
        .send_task_message(&task_id, &message)
        .map_err(ErrorPayload::from)?;
    Ok(serde_json::to_value(session).unwrap_or(Value::Null))
}

/// Atomically creates a chat task and sends the first message.
///
/// Expected params: `{ "message": "<message>" }`
///
/// Returns `{ "task": WorkflowTask, "session": AssistantSession }`.
pub fn create_chat_and_send(ctx: &CommandContext, params: &Value) -> Result<Value, ErrorPayload> {
    let message = params
        .get("message")
        .and_then(|v| v.as_str())
        .ok_or_else(|| ErrorPayload::invalid_params("missing field: message"))?
        .to_string();

    let service = ctx.create_assistant_service();
    let (task, session) = service
        .create_and_send_chat_message(&message)
        .map_err(ErrorPayload::from)?;
    Ok(serde_json::json!({ "task": task, "session": session }))
}

/// Returns project-level sessions only.
pub fn assistant_list_project_sessions(
    ctx: &CommandContext,
    _params: &Value,
) -> Result<Value, ErrorPayload> {
    let service = ctx.create_assistant_service();
    let sessions = service
        .list_project_sessions()
        .map_err(ErrorPayload::from)?;
    Ok(serde_json::to_value(sessions).unwrap_or(Value::Array(vec![])))
}
