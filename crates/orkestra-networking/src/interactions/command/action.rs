//! Human action command handlers: approve, reject, and all task lifecycle mutations.

use std::sync::Arc;

use orkestra_core::workflow::{
    spawn_merge_integration, spawn_pr_creation, spawn_pr_description_audit, PrCheckData,
    PrCommentData, QuestionAnswer,
};
use serde_json::Value;
use tokio::sync::broadcast;

use crate::types::{ErrorPayload, Event};

use super::dispatch::CommandContext;

/// Approves the current stage artifact.
///
/// Expected params: `{ "task_id": "<id>" }`
pub fn approve(ctx: &CommandContext, params: &Value) -> Result<Value, ErrorPayload> {
    let task_id = super::extract_task_id(params)?;
    let api = ctx.api.lock().map_err(|_| ErrorPayload::lock_error())?;
    let task = api.approve(&task_id).map_err(ErrorPayload::from)?;
    Ok(serde_json::to_value(task).unwrap_or(Value::Null))
}

/// Answers pending questions from the agent.
///
/// Expected params: `{ "task_id": "<id>", "answers": [...] }`
pub fn answer_questions(ctx: &CommandContext, params: &Value) -> Result<Value, ErrorPayload> {
    let task_id = super::extract_task_id(params)?;
    let answers: Vec<QuestionAnswer> = extract_param(params, "answers")?;

    let api = ctx.api.lock().map_err(|_| ErrorPayload::lock_error())?;
    let task = api
        .answer_questions(&task_id, answers)
        .map_err(ErrorPayload::from)?;
    Ok(serde_json::to_value(task).unwrap_or(Value::Null))
}

/// Enables or disables auto mode on a task.
///
/// Expected params: `{ "task_id": "<id>", "auto_mode": true|false }`
pub fn set_auto_mode(ctx: &CommandContext, params: &Value) -> Result<Value, ErrorPayload> {
    let task_id = super::extract_task_id(params)?;
    let auto_mode: bool = extract_param(params, "auto_mode")?;

    let api = ctx.api.lock().map_err(|_| ErrorPayload::lock_error())?;
    let task = api
        .set_auto_mode(&task_id, auto_mode)
        .map_err(ErrorPayload::from)?;
    Ok(serde_json::to_value(task).unwrap_or(Value::Null))
}

/// Interrupts a running agent execution.
///
/// Expected params: `{ "task_id": "<id>" }`
pub fn interrupt(ctx: &CommandContext, params: &Value) -> Result<Value, ErrorPayload> {
    let task_id = super::extract_task_id(params)?;
    let api = ctx.api.lock().map_err(|_| ErrorPayload::lock_error())?;
    let task = api.interrupt(&task_id).map_err(ErrorPayload::from)?;
    Ok(serde_json::to_value(task).unwrap_or(Value::Null))
}

/// Archives a Done task.
///
/// Expected params: `{ "task_id": "<id>" }`
pub fn archive(ctx: &CommandContext, params: &Value) -> Result<Value, ErrorPayload> {
    let task_id = super::extract_task_id(params)?;
    let api = ctx.api.lock().map_err(|_| ErrorPayload::lock_error())?;
    let task = api.archive_task(&task_id).map_err(ErrorPayload::from)?;
    Ok(serde_json::to_value(task).unwrap_or(Value::Null))
}

/// Rejects with line-level PR comments.
///
/// Expected params: `{ "task_id": "<id>", "comments": [...], "guidance": "<guidance>" }`
pub fn reject_with_comments(ctx: &CommandContext, params: &Value) -> Result<Value, ErrorPayload> {
    let task_id = super::extract_task_id(params)?;
    let comments: Vec<PrCommentData> = extract_param(params, "comments")?;
    let guidance = params
        .get("guidance")
        .and_then(|v| v.as_str())
        .map(ToString::to_string);

    let api = ctx.api.lock().map_err(|_| ErrorPayload::lock_error())?;
    let task = api
        .reject_with_comments(&task_id, comments, guidance)
        .map_err(ErrorPayload::from)?;
    Ok(serde_json::to_value(task).unwrap_or(Value::Null))
}

/// Routes task back to work with PR feedback.
///
/// Expected params: `{ "task_id": "<id>", "comments": [...], "checks": [...], "guidance": "<guidance>" }`
pub fn address_pr_feedback(ctx: &CommandContext, params: &Value) -> Result<Value, ErrorPayload> {
    let task_id = super::extract_task_id(params)?;
    let comments: Vec<PrCommentData> = extract_param(params, "comments")?;
    let checks: Vec<PrCheckData> = extract_param(params, "checks")?;
    let guidance = params
        .get("guidance")
        .and_then(|v| v.as_str())
        .map(ToString::to_string);

    let api = ctx.api.lock().map_err(|_| ErrorPayload::lock_error())?;
    let task = api
        .address_pr_feedback(&task_id, comments, checks, guidance)
        .map_err(ErrorPayload::from)?;
    Ok(serde_json::to_value(task).unwrap_or(Value::Null))
}

/// Routes task back to work to resolve conflicts.
///
/// Expected params: `{ "task_id": "<id>", "base_branch": "<branch>" }`
pub fn address_pr_conflicts(ctx: &CommandContext, params: &Value) -> Result<Value, ErrorPayload> {
    let task_id = super::extract_task_id(params)?;
    let base_branch = params
        .get("base_branch")
        .and_then(|v| v.as_str())
        .ok_or_else(|| ErrorPayload::invalid_params("missing field: base_branch"))?
        .to_string();

    let api = ctx.api.lock().map_err(|_| ErrorPayload::lock_error())?;
    let task = api
        .address_pr_conflicts(&task_id, &base_branch)
        .map_err(ErrorPayload::from)?;
    Ok(serde_json::to_value(task).unwrap_or(Value::Null))
}

/// Routes a Done task back to the recovery stage.
///
/// Expected params: `{ "task_id": "<id>", "feedback": "<feedback>" }`
pub fn request_update(ctx: &CommandContext, params: &Value) -> Result<Value, ErrorPayload> {
    let task_id = super::extract_task_id(params)?;
    let feedback = params
        .get("feedback")
        .and_then(|v| v.as_str())
        .ok_or_else(|| ErrorPayload::invalid_params("missing field: feedback"))?
        .to_string();

    let api = ctx.api.lock().map_err(|_| ErrorPayload::lock_error())?;
    let task = api
        .request_update(&task_id, &feedback)
        .map_err(ErrorPayload::from)?;
    Ok(serde_json::to_value(task).unwrap_or(Value::Null))
}

/// Commits and pushes pending changes to an open PR.
///
/// Expected params: `{ "task_id": "<id>" }`
pub fn push_pr_changes(ctx: &CommandContext, params: &Value) -> Result<Value, ErrorPayload> {
    let task_id = super::extract_task_id(params)?;
    let task = {
        let api = ctx.api.lock().map_err(|_| ErrorPayload::lock_error())?;
        api.commit_and_push_pr_changes(&task_id)
            .map_err(ErrorPayload::from)?
    };
    // Lock released — spawn best-effort description audit in background
    spawn_pr_description_audit(&ctx.api, &task_id);
    Ok(serde_json::to_value(task).unwrap_or(Value::Null))
}

/// Force-pushes the task's branch to origin using --force-with-lease.
///
/// Expected params: `{ "task_id": "<id>" }`
pub fn force_push_pr_changes(ctx: &CommandContext, params: &Value) -> Result<Value, ErrorPayload> {
    let task_id = super::extract_task_id(params)?;
    let api = ctx.api.lock().map_err(|_| ErrorPayload::lock_error())?;
    let task = api
        .force_push_pr_changes(&task_id)
        .map_err(ErrorPayload::from)?;
    Ok(serde_json::to_value(task).unwrap_or(Value::Null))
}

/// Pulls remote changes into the local worktree.
///
/// Expected params: `{ "task_id": "<id>" }`
pub fn pull_pr_changes(ctx: &CommandContext, params: &Value) -> Result<Value, ErrorPayload> {
    let task_id = super::extract_task_id(params)?;
    let api = ctx.api.lock().map_err(|_| ErrorPayload::lock_error())?;
    let task = api.pull_pr_changes(&task_id).map_err(ErrorPayload::from)?;
    Ok(serde_json::to_value(task).unwrap_or(Value::Null))
}

/// Handle the `merge_task` method — merges a Done task's branch into its base branch.
///
/// Spawns background git work and returns the task in `Integrating` state immediately.
/// Clients receive the completion notification via a `task_updated` broadcast event.
///
/// Expected params: `{ "task_id": "<id>" }`
pub(super) async fn handle_merge_task(
    ctx: Arc<CommandContext>,
    event_tx: broadcast::Sender<Event>,
    params: Value,
) -> Result<Value, ErrorPayload> {
    let task_id = super::extract_task_id(&params)?;
    let api_clone = Arc::clone(&ctx.api);
    let task_id_for_complete = task_id.clone();
    let event_tx_for_complete = event_tx.clone();
    let event_tx_for_immediate = event_tx.clone();

    tokio::task::spawn_blocking(move || {
        let on_complete = move || {
            // Notify clients when background git work finishes.
            let _ = event_tx_for_complete.send(Event::task_updated(task_id_for_complete));
        };
        let task = spawn_merge_integration(api_clone, &task_id, on_complete)
            .map_err(ErrorPayload::from)?;
        // Emit immediately for the initial state change (covers the no-git case where
        // on_complete is skipped because integration succeeds synchronously).
        let _ = event_tx_for_immediate.send(Event::task_updated(&task_id));
        Ok(serde_json::to_value(task).unwrap_or(Value::Null))
    })
    .await
    .map_err(|e| ErrorPayload::internal(e.to_string()))?
}

/// Handle the `open_pr` method — creates a pull request for a Done task.
///
/// Spawns background PR creation and returns the task in `Integrating` state immediately.
/// Clients receive the completion notification via a `task_updated` broadcast event.
///
/// Expected params: `{ "task_id": "<id>" }`
pub(super) async fn handle_open_pr(
    ctx: Arc<CommandContext>,
    event_tx: broadcast::Sender<Event>,
    params: Value,
) -> Result<Value, ErrorPayload> {
    let task_id = super::extract_task_id(&params)?;
    let api_clone = Arc::clone(&ctx.api);
    let event_tx_clone = event_tx.clone();

    tokio::task::spawn_blocking(move || {
        let task = spawn_pr_creation(api_clone, &task_id).map_err(ErrorPayload::from)?;
        // Notify clients of the state change to Integrating.
        let _ = event_tx_clone.send(Event::task_updated(&task_id));
        Ok(serde_json::to_value(task).unwrap_or(Value::Null))
    })
    .await
    .map_err(|e| ErrorPayload::internal(e.to_string()))?
}

/// Recovers a PR creation from Failed back to Done+Idle.
///
/// Expected params: `{ "task_id": "<id>" }`
pub fn retry_pr(ctx: &CommandContext, params: &Value) -> Result<Value, ErrorPayload> {
    let task_id = super::extract_task_id(params)?;
    let api = ctx.api.lock().map_err(|_| ErrorPayload::lock_error())?;
    let task = api
        .retry_pr_creation(&task_id)
        .map_err(ErrorPayload::from)?;
    Ok(serde_json::to_value(task).unwrap_or(Value::Null))
}

/// Skips the current stage, advancing to the next with a message.
///
/// Expected params: `{ "task_id": "<id>", "message": "<message>" }`
pub fn skip_stage(ctx: &CommandContext, params: &Value) -> Result<Value, ErrorPayload> {
    let task_id = super::extract_task_id(params)?;
    let message = params
        .get("message")
        .and_then(|v| v.as_str())
        .ok_or_else(|| ErrorPayload::invalid_params("missing field: message"))?
        .to_string();

    let api = ctx.api.lock().map_err(|_| ErrorPayload::lock_error())?;
    let task = api
        .skip_stage(&task_id, &message)
        .map_err(ErrorPayload::from)?;
    Ok(serde_json::to_value(task).unwrap_or(Value::Null))
}

/// Restarts the current stage with a fresh agent session.
///
/// Expected params: `{ "task_id": "<id>", "message": "<message>" }`
pub fn restart_stage(ctx: &CommandContext, params: &Value) -> Result<Value, ErrorPayload> {
    let task_id = super::extract_task_id(params)?;
    let message = params
        .get("message")
        .and_then(|v| v.as_str())
        .ok_or_else(|| ErrorPayload::invalid_params("missing field: message"))?
        .to_string();

    let api = ctx.api.lock().map_err(|_| ErrorPayload::lock_error())?;
    let task = api
        .restart_stage(&task_id, &message)
        .map_err(ErrorPayload::from)?;
    Ok(serde_json::to_value(task).unwrap_or(Value::Null))
}

/// Sends a task to a specific stage with a message.
///
/// Expected params: `{ "task_id": "<id>", "target_stage": "<stage>", "message": "<message>" }`
pub fn send_to_stage(ctx: &CommandContext, params: &Value) -> Result<Value, ErrorPayload> {
    let task_id = super::extract_task_id(params)?;
    let target_stage = params
        .get("target_stage")
        .and_then(|v| v.as_str())
        .ok_or_else(|| ErrorPayload::invalid_params("missing field: target_stage"))?
        .to_string();
    let message = params
        .get("message")
        .and_then(|v| v.as_str())
        .ok_or_else(|| ErrorPayload::invalid_params("missing field: message"))?
        .to_string();

    let api = ctx.api.lock().map_err(|_| ErrorPayload::lock_error())?;
    let task = api
        .send_to_stage(&task_id, &target_stage, &message)
        .map_err(ErrorPayload::from)?;
    Ok(serde_json::to_value(task).unwrap_or(Value::Null))
}

/// Sends a message to the agent via the unified `send_message` API.
///
/// Valid from `AwaitingQuestionAnswer`, `AwaitingApproval`, `AwaitingRejectionConfirmation`,
/// `Failed`, `Blocked`, `Interrupted`.
/// Creates a `UserMessage` iteration and transitions to `Queued`.
///
/// Expected params: `{ "task_id": "<id>", "message": "<message>" }`
pub fn send_message(ctx: &CommandContext, params: &Value) -> Result<Value, ErrorPayload> {
    let task_id = super::extract_task_id(params)?;
    let message = params
        .get("message")
        .and_then(|v| v.as_str())
        .ok_or_else(|| ErrorPayload::invalid_params("missing field: message"))?
        .to_string();

    let api = ctx.api.lock().map_err(|_| ErrorPayload::lock_error())?;
    let task = api
        .send_message(&task_id, &message)
        .map_err(ErrorPayload::from)?;
    Ok(serde_json::to_value(task).unwrap_or(Value::Null))
}

/// Promotes a chat task to a full workflow flow.
///
/// Expected params: `{ "task_id": "<id>", "flow": "<flow_name>", "starting_stage": "<stage>", "title": "<title>", "artifact_content": "<content>" }`
/// All fields except `task_id` are optional.
pub fn promote_to_flow(ctx: &CommandContext, params: &Value) -> Result<Value, ErrorPayload> {
    let task_id = super::extract_task_id(params)?;
    let flow = params
        .get("flow")
        .and_then(|v| v.as_str())
        .map(ToString::to_string);
    let starting_stage = params
        .get("starting_stage")
        .and_then(|v| v.as_str())
        .map(ToString::to_string);
    let title = params
        .get("title")
        .and_then(|v| v.as_str())
        .map(ToString::to_string);
    let artifact_content = params
        .get("artifact_content")
        .and_then(|v| v.as_str())
        .map(ToString::to_string);
    let api = ctx.api.lock().map_err(|_| ErrorPayload::lock_error())?;
    let task = api
        .promote_to_flow(
            &task_id,
            flow.as_deref(),
            starting_stage.as_deref(),
            title.as_deref(),
            artifact_content.as_deref(),
        )
        .map_err(ErrorPayload::from)?;
    Ok(serde_json::to_value(task).unwrap_or(Value::Null))
}

// -- Helpers --

fn extract_param<T: for<'de> serde::Deserialize<'de>>(
    params: &Value,
    field: &str,
) -> Result<T, ErrorPayload> {
    let v = params
        .get(field)
        .ok_or_else(|| ErrorPayload::invalid_params(format!("missing field: {field}")))?;
    serde_json::from_value(v.clone())
        .map_err(|e| ErrorPayload::invalid_params(format!("invalid '{field}': {e}")))
}
