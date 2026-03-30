//! Stage chat command handlers for sending messages to running agents.

use serde_json::Value;

use crate::types::ErrorPayload;

use super::dispatch::CommandContext;

/// Sends a chat message to the running agent.
///
/// Expected params: `{ "task_id": "<id>", "message": "<message>" }`
pub fn stage_chat_send(ctx: &CommandContext, params: &Value) -> Result<Value, ErrorPayload> {
    let task_id = super::extract_task_id(params)?;
    let message = params
        .get("message")
        .and_then(|v| v.as_str())
        .ok_or_else(|| ErrorPayload::invalid_params("missing field: message"))?
        .to_string();

    let api = ctx.api.lock().map_err(|_| ErrorPayload::lock_error())?;
    api.send_chat_message(&task_id, &message)
        .map_err(ErrorPayload::from)?;
    Ok(Value::Null)
}

/// Stops the running agent's chat process.
///
/// Expected params: `{ "task_id": "<id>" }`
pub fn stage_chat_stop(ctx: &CommandContext, params: &Value) -> Result<Value, ErrorPayload> {
    let task_id = super::extract_task_id(params)?;
    let api = ctx.api.lock().map_err(|_| ErrorPayload::lock_error())?;
    api.kill_chat_agent(&task_id).map_err(ErrorPayload::from)?;
    Ok(Value::Null)
}
