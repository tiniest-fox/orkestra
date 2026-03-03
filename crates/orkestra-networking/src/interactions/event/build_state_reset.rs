//! Build a `state_reset` event containing all active task views.

use std::sync::Arc;

use crate::interactions::command::dispatch::CommandContext;
use crate::types::Event;

pub(crate) async fn execute(ctx: &Arc<CommandContext>) -> Option<Event> {
    let api = Arc::clone(&ctx.api);
    match tokio::task::spawn_blocking(move || {
        let api = api.lock().map_err(|e| format!("Lock poisoned: {e}"))?;
        let tasks = api
            .list_task_views()
            .map_err(|e| format!("DB query failed: {e}"))?;
        Ok::<_, String>(Event::new(
            "state_reset",
            serde_json::to_value(tasks).unwrap_or(serde_json::Value::Array(vec![])),
        ))
    })
    .await
    {
        Ok(Ok(event)) => Some(event),
        Ok(Err(reason)) => {
            tracing::error!("Failed to build state reset: {reason}");
            None
        }
        Err(e) => {
            tracing::error!("State reset task panicked: {e}");
            None
        }
    }
}
