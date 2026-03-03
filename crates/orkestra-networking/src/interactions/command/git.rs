//! Git sync command handlers: sync status, push, pull, fetch.
//!
//! Each handler clones the `Arc<dyn GitService>` while holding the API lock,
//! then drops the lock before calling git methods. This avoids holding the
//! `WorkflowApi` mutex during potentially-slow git subprocess invocations.

use std::sync::Arc;

use serde_json::Value;

use crate::types::ErrorPayload;

use super::dispatch::CommandContext;

/// Handle the `git_sync_status` method — returns sync status relative to origin.
///
/// Returns `null` if no git service is configured or the branch has no remote tracking ref.
pub(super) async fn handle_git_sync_status(
    ctx: Arc<CommandContext>,
    _params: Value,
) -> Result<Value, ErrorPayload> {
    let api = Arc::clone(&ctx.api);
    tokio::task::spawn_blocking(move || {
        let git = {
            let api = api.lock().map_err(|_| ErrorPayload::lock_error())?;
            let Some(git) = api.git_service() else {
                return Ok(Value::Null);
            };
            Arc::clone(git)
        }; // lock released — git subprocess runs off the lock

        let status = git
            .sync_status()
            .map_err(|e| ErrorPayload::new("GIT_ERROR", e.to_string()))?;
        Ok(serde_json::to_value(status).unwrap_or(Value::Null))
    })
    .await
    .map_err(|e| ErrorPayload::internal(e.to_string()))?
}

/// Handle the `git_push` method — pushes the current branch to origin.
pub(super) async fn handle_git_push(
    ctx: Arc<CommandContext>,
    _params: Value,
) -> Result<Value, ErrorPayload> {
    let api = Arc::clone(&ctx.api);
    tokio::task::spawn_blocking(move || {
        let git = {
            let api = api.lock().map_err(|_| ErrorPayload::lock_error())?;
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
    })
    .await
    .map_err(|e| ErrorPayload::internal(e.to_string()))?
}

/// Handle the `git_pull` method — pulls from origin into the current branch.
pub(super) async fn handle_git_pull(
    ctx: Arc<CommandContext>,
    _params: Value,
) -> Result<Value, ErrorPayload> {
    let api = Arc::clone(&ctx.api);
    tokio::task::spawn_blocking(move || {
        let git = {
            let api = api.lock().map_err(|_| ErrorPayload::lock_error())?;
            let Some(git) = api.git_service() else {
                return Err(ErrorPayload::new("NO_GIT", "Git service not available"));
            };
            Arc::clone(git)
        }; // lock released — git subprocess runs off the lock

        git.pull_branch()
            .map_err(|e| ErrorPayload::new("GIT_ERROR", e.to_string()))?;
        Ok(Value::Null)
    })
    .await
    .map_err(|e| ErrorPayload::internal(e.to_string()))?
}

/// Handle the `git_fetch` method — fetches from origin to update remote-tracking refs.
pub(super) async fn handle_git_fetch(
    ctx: Arc<CommandContext>,
    _params: Value,
) -> Result<Value, ErrorPayload> {
    let api = Arc::clone(&ctx.api);
    tokio::task::spawn_blocking(move || {
        let git = {
            let api = api.lock().map_err(|_| ErrorPayload::lock_error())?;
            let Some(git) = api.git_service() else {
                return Err(ErrorPayload::new("NO_GIT", "Git service not available"));
            };
            Arc::clone(git)
        }; // lock released — git subprocess runs off the lock

        git.fetch_origin()
            .map_err(|e| ErrorPayload::new("GIT_ERROR", e.to_string()))?;
        Ok(Value::Null)
    })
    .await
    .map_err(|e| ErrorPayload::internal(e.to_string()))?
}
