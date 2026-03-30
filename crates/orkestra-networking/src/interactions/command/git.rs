//! Git sync command handlers: sync status, push, pull, fetch.
//!
//! Each handler clones the `Arc<dyn GitService>` while holding the API lock,
//! then drops the lock before calling git methods. This avoids holding the
//! `WorkflowApi` mutex during potentially-slow git subprocess invocations.

use std::sync::Arc;

use serde_json::Value;

use crate::types::ErrorPayload;

use super::dispatch::CommandContext;

/// Returns sync status relative to origin.
///
/// Returns `null` if no git service is configured or the branch has no remote tracking ref.
pub fn git_sync_status(ctx: &CommandContext, _params: &Value) -> Result<Value, ErrorPayload> {
    let git = {
        let api = ctx.api.lock().map_err(|_| ErrorPayload::lock_error())?;
        let Some(git) = api.git_service() else {
            return Ok(Value::Null);
        };
        Arc::clone(git)
    }; // lock released — git subprocess runs off the lock

    let status = git
        .sync_status()
        .map_err(|e| ErrorPayload::new("GIT_ERROR", e.to_string()))?;
    Ok(serde_json::to_value(status).unwrap_or(Value::Null))
}

/// Pushes the current branch to origin.
pub fn git_push(ctx: &CommandContext, _params: &Value) -> Result<Value, ErrorPayload> {
    let git = {
        let api = ctx.api.lock().map_err(|_| ErrorPayload::lock_error())?;
        let Some(git) = api.git_service() else {
            return Err(ErrorPayload::new("NO_GIT", "Git service not available"));
        };
        Arc::clone(git)
    }; // lock released — git subprocess runs off the lock

    let branch = git
        .current_branch()
        .map_err(|e| ErrorPayload::new("GIT_ERROR", e.to_string()))?;
    git.push_branch(&branch)
        .map_err(|e| ErrorPayload::new("GIT_ERROR", e.to_string()))?;
    Ok(Value::Null)
}

/// Pulls from origin into the current branch.
pub fn git_pull(ctx: &CommandContext, _params: &Value) -> Result<Value, ErrorPayload> {
    let git = {
        let api = ctx.api.lock().map_err(|_| ErrorPayload::lock_error())?;
        let Some(git) = api.git_service() else {
            return Err(ErrorPayload::new("NO_GIT", "Git service not available"));
        };
        Arc::clone(git)
    }; // lock released — git subprocess runs off the lock

    git.pull_branch()
        .map_err(|e| ErrorPayload::new("GIT_ERROR", e.to_string()))?;
    Ok(Value::Null)
}

/// Fetches from origin to update remote-tracking refs.
pub fn git_fetch(ctx: &CommandContext, _params: &Value) -> Result<Value, ErrorPayload> {
    let git = {
        let api = ctx.api.lock().map_err(|_| ErrorPayload::lock_error())?;
        let Some(git) = api.git_service() else {
            return Err(ErrorPayload::new("NO_GIT", "Git service not available"));
        };
        Arc::clone(git)
    }; // lock released — git subprocess runs off the lock

    git.fetch_origin()
        .map_err(|e| ErrorPayload::new("GIT_ERROR", e.to_string()))?;
    Ok(Value::Null)
}

/// Returns sync status for a specific task's branch relative to origin.
///
/// Expected params: `{ "task_id": "<id>" }`
pub fn task_sync_status(ctx: &CommandContext, params: &Value) -> Result<Value, ErrorPayload> {
    let task_id = super::extract_task_id(params)?;
    let api = ctx.api.lock().map_err(|_| ErrorPayload::lock_error())?;
    let status = api.task_sync_status(&task_id).map_err(ErrorPayload::from)?;
    Ok(serde_json::to_value(status).unwrap_or(Value::Null))
}
