//! Command dispatch and shared helpers.

pub mod action;
pub mod assistant;
pub(crate) mod ci_log_parser;
pub mod diff;
pub mod dispatch;
pub mod git;
pub mod interactive;
pub mod query;
pub mod registry;
pub mod stage_chat;
pub mod task;

use crate::types::ErrorPayload;
use serde_json::Value;

// -- Shared Param Helpers --

pub(crate) fn extract_task_id(params: &Value) -> Result<String, ErrorPayload> {
    params
        .get("task_id")
        .and_then(|v| v.as_str())
        .map(ToString::to_string)
        .ok_or_else(|| ErrorPayload::invalid_params("missing field: task_id"))
}
