//! Assistant command handlers for the project-level chat panel.

use std::sync::Arc;

use serde_json::Value;

use crate::types::ErrorPayload;

use super::dispatch::CommandContext;

/// Handle the `assistant_send_message` method — sends a message to the assistant chat.
///
/// Expected params: `{ "session_id": "<id>" (optional), "message": "<message>" }`
pub(super) async fn handle_assistant_send_message(
    ctx: Arc<CommandContext>,
    params: Value,
) -> Result<Value, ErrorPayload> {
    let session_id = params
        .get("session_id")
        .and_then(|v| v.as_str())
        .map(ToString::to_string);

    let message = params
        .get("message")
        .and_then(|v| v.as_str())
        .ok_or_else(|| ErrorPayload::invalid_params("missing field: message"))?
        .to_string();

    tokio::task::spawn_blocking(move || {
        let service = ctx.create_assistant_service();
        let session = service
            .send_message(session_id.as_deref(), &message)
            .map_err(ErrorPayload::from)?;
        Ok(serde_json::to_value(session).unwrap_or(Value::Null))
    })
    .await
    .map_err(|e| ErrorPayload::internal(e.to_string()))?
}

/// Handle the `assistant_stop` method — stops the running assistant agent.
///
/// Expected params: `{ "session_id": "<id>" }`
pub(super) async fn handle_assistant_stop(
    ctx: Arc<CommandContext>,
    params: Value,
) -> Result<Value, ErrorPayload> {
    let session_id = params
        .get("session_id")
        .and_then(|v| v.as_str())
        .ok_or_else(|| ErrorPayload::invalid_params("missing field: session_id"))?
        .to_string();

    tokio::task::spawn_blocking(move || {
        let service = ctx.create_assistant_service();
        service
            .stop_process(&session_id)
            .map_err(ErrorPayload::from)?;
        Ok(Value::Null)
    })
    .await
    .map_err(|e| ErrorPayload::internal(e.to_string()))?
}

/// Handle the `assistant_list_sessions` method — returns all assistant sessions.
pub(super) async fn handle_assistant_list_sessions(
    ctx: Arc<CommandContext>,
    _params: Value,
) -> Result<Value, ErrorPayload> {
    tokio::task::spawn_blocking(move || {
        let service = ctx.create_assistant_service();
        let sessions = service.list_sessions().map_err(ErrorPayload::from)?;
        Ok(serde_json::to_value(sessions).unwrap_or(Value::Array(vec![])))
    })
    .await
    .map_err(|e| ErrorPayload::internal(e.to_string()))?
}

/// Handle the `assistant_get_logs` method — returns log entries for an assistant session.
///
/// Expected params: `{ "session_id": "<id>" }`
pub(super) async fn handle_assistant_get_logs(
    ctx: Arc<CommandContext>,
    params: Value,
) -> Result<Value, ErrorPayload> {
    let session_id = params
        .get("session_id")
        .and_then(|v| v.as_str())
        .ok_or_else(|| ErrorPayload::invalid_params("missing field: session_id"))?
        .to_string();

    tokio::task::spawn_blocking(move || {
        let service = ctx.create_assistant_service();
        let logs = service
            .get_session_logs(&session_id)
            .map_err(ErrorPayload::from)?;
        Ok(serde_json::to_value(logs).unwrap_or(Value::Array(vec![])))
    })
    .await
    .map_err(|e| ErrorPayload::internal(e.to_string()))?
}

/// Handle the `assistant_send_task_message` method — sends a message to a task-scoped session.
///
/// Expected params: `{ "task_id": "<id>", "message": "<message>" }`
pub(super) async fn handle_assistant_send_task_message(
    ctx: Arc<CommandContext>,
    params: Value,
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

    tokio::task::spawn_blocking(move || {
        let service = ctx.create_assistant_service();
        let session = service
            .send_task_message(&task_id, &message)
            .map_err(ErrorPayload::from)?;
        Ok(serde_json::to_value(session).unwrap_or(Value::Null))
    })
    .await
    .map_err(|e| ErrorPayload::internal(e.to_string()))?
}

/// Handle the `assistant_list_project_sessions` method — returns project-level sessions only.
pub(super) async fn handle_assistant_list_project_sessions(
    ctx: Arc<CommandContext>,
    _params: Value,
) -> Result<Value, ErrorPayload> {
    tokio::task::spawn_blocking(move || {
        let service = ctx.create_assistant_service();
        let sessions = service
            .list_project_sessions()
            .map_err(ErrorPayload::from)?;
        Ok(serde_json::to_value(sessions).unwrap_or(Value::Array(vec![])))
    })
    .await
    .map_err(|e| ErrorPayload::internal(e.to_string()))?
}
