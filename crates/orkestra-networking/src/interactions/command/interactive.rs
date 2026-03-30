//! Interactive mode command handlers.

use serde_json::Value;

use crate::types::ErrorPayload;

use super::dispatch::CommandContext;

/// Enter interactive mode for a task.
///
/// Expected params: `{ "task_id": "<id>" }`
pub fn enter(ctx: &CommandContext, params: &Value) -> Result<Value, ErrorPayload> {
    let task_id = super::extract_task_id(params)?;
    let api = ctx.api.lock().map_err(|_| ErrorPayload::lock_error())?;
    api.enter_interactive_mode(&task_id)
        .map_err(ErrorPayload::from)?;
    Ok(Value::Null)
}

/// Send a message to the interactive session for a task.
///
/// Expected params: `{ "task_id": "<id>", "message": "<message>" }`
pub fn send_message(ctx: &CommandContext, params: &Value) -> Result<Value, ErrorPayload> {
    let task_id = super::extract_task_id(params)?;
    let message = params
        .get("message")
        .and_then(|v| v.as_str())
        .ok_or_else(|| ErrorPayload::invalid_params("missing field: message"))?
        .to_string();

    let service = ctx.create_assistant_service();
    service
        .send_interactive_task_message(&task_id, &message)
        .map_err(ErrorPayload::from)?;
    Ok(Value::Null)
}

/// Exit interactive mode for a task.
///
/// Expected params: `{ "task_id": "<id>", "target_stage": "<stage>" (optional) }`
pub fn exit(ctx: &CommandContext, params: &Value) -> Result<Value, ErrorPayload> {
    let task_id = super::extract_task_id(params)?;
    let target_stage = params
        .get("target_stage")
        .and_then(|v| v.as_str())
        .map(ToString::to_string);

    let api = ctx.api.lock().map_err(|_| ErrorPayload::lock_error())?;
    api.exit_interactive_mode(&task_id, target_stage.as_deref())
        .map_err(ErrorPayload::from)?;
    Ok(Value::Null)
}
