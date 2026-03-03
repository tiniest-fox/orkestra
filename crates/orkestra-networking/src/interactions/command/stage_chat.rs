//! Stage chat command handlers for sending messages to running agents.

use std::sync::Arc;

use serde_json::Value;

use crate::types::ErrorPayload;

use super::dispatch::CommandContext;

/// Handle the `stage_chat_send` method — sends a chat message to the running agent.
///
/// Expected params: `{ "task_id": "<id>", "message": "<message>" }`
pub(super) async fn handle_stage_chat_send(
    ctx: Arc<CommandContext>,
    params: Value,
) -> Result<Value, ErrorPayload> {
    let task_id = super::extract_task_id(&params)?;
    let message = params
        .get("message")
        .and_then(|v| v.as_str())
        .ok_or_else(|| ErrorPayload::invalid_params("missing field: message"))?
        .to_string();

    let api = Arc::clone(&ctx.api);
    tokio::task::spawn_blocking(move || {
        let api = api.lock().map_err(|_| ErrorPayload::lock_error())?;
        api.send_chat_message(&task_id, &message)
            .map_err(ErrorPayload::from)?;
        Ok(Value::Null)
    })
    .await
    .map_err(|e| ErrorPayload::internal(e.to_string()))?
}

/// Handle the `stage_chat_stop` method — stops the running agent's chat process.
///
/// Expected params: `{ "task_id": "<id>" }`
pub(super) async fn handle_stage_chat_stop(
    ctx: Arc<CommandContext>,
    params: Value,
) -> Result<Value, ErrorPayload> {
    let task_id = super::extract_task_id(&params)?;
    let api = Arc::clone(&ctx.api);
    tokio::task::spawn_blocking(move || {
        let api = api.lock().map_err(|_| ErrorPayload::lock_error())?;
        api.kill_chat_agent(&task_id).map_err(ErrorPayload::from)?;
        Ok(Value::Null)
    })
    .await
    .map_err(|e| ErrorPayload::internal(e.to_string()))?
}
