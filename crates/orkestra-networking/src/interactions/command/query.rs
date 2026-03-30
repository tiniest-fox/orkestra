//! Read-only query command handlers.

use std::sync::Arc;
use std::time::Duration;

use chrono::Utc;
use orkestra_core::workflow::load_auto_task_templates;
use serde::{Deserialize, Serialize};
use serde_json::Value;
use tokio::process::Command;

use crate::types::{ErrorPayload, PrCheck, PrComment, PrReview, PrStatus};
use orkestra_types::config::ProjectInfo;

use super::dispatch::CommandContext;

// ============================================================================
// Simple API-backed queries
// ============================================================================

/// Returns the workflow configuration.
pub fn get_config(ctx: &CommandContext, _params: &Value) -> Result<Value, ErrorPayload> {
    let api = ctx.api.lock().map_err(|_| ErrorPayload::lock_error())?;
    let config = api.workflow().clone();
    Ok(serde_json::to_value(config).unwrap_or(Value::Null))
}

/// Returns config and full task list together.
///
/// Combines `get_config` and `list_tasks` in one round trip.
pub fn get_startup_data(ctx: &CommandContext, _params: &Value) -> Result<Value, ErrorPayload> {
    let api = ctx.api.lock().map_err(|_| ErrorPayload::lock_error())?;
    let config = api.workflow().clone();
    let tasks = api.list_task_views().map_err(ErrorPayload::from)?;
    Ok(serde_json::json!({ "config": config, "tasks": tasks }))
}

/// Loads predefined task templates.
pub fn get_auto_task_templates(
    ctx: &CommandContext,
    _params: &Value,
) -> Result<Value, ErrorPayload> {
    let api = ctx.api.lock().map_err(|_| ErrorPayload::lock_error())?;
    let config = api.workflow().clone();
    drop(api); // release lock before file I/O
    let templates = load_auto_task_templates(&ctx.project_root, &config);
    Ok(serde_json::to_value(templates).unwrap_or(Value::Array(vec![])))
}

/// Returns iterations for a task.
///
/// Expected params: `{ "task_id": "<id>" }`
pub fn get_iterations(ctx: &CommandContext, params: &Value) -> Result<Value, ErrorPayload> {
    let task_id = super::extract_task_id(params)?;
    let api = ctx.api.lock().map_err(|_| ErrorPayload::lock_error())?;
    let iterations = api.get_iterations(&task_id).map_err(ErrorPayload::from)?;
    Ok(serde_json::to_value(iterations).unwrap_or(Value::Array(vec![])))
}

/// Returns a named artifact for a task.
///
/// Expected params: `{ "task_id": "<id>", "name": "<artifact_name>" }`
pub fn get_artifact(ctx: &CommandContext, params: &Value) -> Result<Value, ErrorPayload> {
    let task_id = super::extract_task_id(params)?;
    let name = params
        .get("name")
        .and_then(|v| v.as_str())
        .ok_or_else(|| ErrorPayload::invalid_params("missing field: name"))?
        .to_string();

    let api = ctx.api.lock().map_err(|_| ErrorPayload::lock_error())?;
    let artifact = api
        .get_artifact(&task_id, &name)
        .map_err(ErrorPayload::from)?;
    Ok(serde_json::to_value(artifact).unwrap_or(Value::Null))
}

/// Returns pending questions for a task.
///
/// Expected params: `{ "task_id": "<id>" }`
pub fn get_pending_questions(ctx: &CommandContext, params: &Value) -> Result<Value, ErrorPayload> {
    let task_id = super::extract_task_id(params)?;
    let api = ctx.api.lock().map_err(|_| ErrorPayload::lock_error())?;
    let questions = api
        .get_pending_questions(&task_id)
        .map_err(ErrorPayload::from)?;
    Ok(serde_json::to_value(questions).unwrap_or(Value::Array(vec![])))
}

/// Returns the current stage for a task.
///
/// Expected params: `{ "task_id": "<id>" }`
pub fn get_current_stage(ctx: &CommandContext, params: &Value) -> Result<Value, ErrorPayload> {
    let task_id = super::extract_task_id(params)?;
    let api = ctx.api.lock().map_err(|_| ErrorPayload::lock_error())?;
    let stage = api
        .get_current_stage(&task_id)
        .map_err(ErrorPayload::from)?;
    Ok(serde_json::to_value(stage).unwrap_or(Value::Null))
}

/// Returns rejection feedback for a task.
///
/// Expected params: `{ "task_id": "<id>" }`
pub fn get_rejection_feedback(ctx: &CommandContext, params: &Value) -> Result<Value, ErrorPayload> {
    let task_id = super::extract_task_id(params)?;
    let api = ctx.api.lock().map_err(|_| ErrorPayload::lock_error())?;
    let feedback = api
        .get_rejection_feedback(&task_id)
        .map_err(ErrorPayload::from)?;
    Ok(serde_json::to_value(feedback).unwrap_or(Value::Null))
}

// ============================================================================
// Project info
// ============================================================================

/// Returns basic project environment metadata.
pub fn get_project_info(ctx: &CommandContext, _params: &Value) -> Result<Value, ErrorPayload> {
    let has_git = {
        let api = ctx.api.lock().map_err(|_| ErrorPayload::lock_error())?;
        api.git_service().is_some()
    };
    let has_gh_cli = std::process::Command::new("gh")
        .arg("--version")
        .stdin(std::process::Stdio::null())
        .output()
        .map(|o| o.status.success())
        .unwrap_or(false);
    let has_run_script = ctx
        .project_root
        .join(orkestra_types::config::RUN_SCRIPT_RELATIVE_PATH)
        .exists();
    let info = ProjectInfo {
        project_root: ctx.project_root.display().to_string(),
        has_git,
        has_gh_cli,
        has_run_script,
    };
    Ok(serde_json::to_value(info).unwrap_or(Value::Null))
}

// ============================================================================
// Branch queries
// ============================================================================

/// Branch information returned by `list_branches`.
#[derive(Serialize)]
pub(crate) struct BranchList {
    pub(crate) branches: Vec<String>,
    pub(crate) current: Option<String>,
    pub(crate) latest_commit_message: Option<String>,
}

/// Returns available git branches.
///
/// Returns empty lists if no git service is configured.
pub fn list_branches(ctx: &CommandContext, _params: &Value) -> Result<Value, ErrorPayload> {
    let git = {
        let api = ctx.api.lock().map_err(|_| ErrorPayload::lock_error())?;
        let Some(git) = api.git_service() else {
            return Ok(serde_json::to_value(BranchList {
                branches: vec![],
                current: None,
                latest_commit_message: None,
            })
            .unwrap_or(Value::Null));
        };
        Arc::clone(git)
    }; // lock released here — git subprocess runs off the lock

    let latest_commit_message = git
        .commit_log(1)
        .ok()
        .and_then(|commits| commits.first().map(|c| c.message.clone()));

    Ok(serde_json::to_value(BranchList {
        branches: git.list_branches().unwrap_or_default(),
        current: git.current_branch().ok(),
        latest_commit_message,
    })
    .unwrap_or(Value::Null))
}

// ============================================================================
// Log queries
// ============================================================================

/// Returns log entries for a task's stage/session.
///
/// Expected params: `{ "task_id": "<id>", "stage": "<stage>" (opt), "session_id": "<id>" (opt) }`
pub fn get_logs(ctx: &CommandContext, params: &Value) -> Result<Value, ErrorPayload> {
    let task_id = super::extract_task_id(params)?;
    let stage = params
        .get("stage")
        .and_then(|v| v.as_str())
        .map(ToString::to_string);
    let session_id = params
        .get("session_id")
        .and_then(|v| v.as_str())
        .map(ToString::to_string);

    let api = ctx.api.lock().map_err(|_| ErrorPayload::lock_error())?;
    let logs = api
        .get_task_logs(&task_id, stage.as_deref(), session_id.as_deref())
        .map_err(ErrorPayload::from)?;
    Ok(serde_json::to_value(logs).unwrap_or(Value::Array(vec![])))
}

/// Returns the most recent log entry for a task.
///
/// Expected params: `{ "task_id": "<id>" }`
pub fn get_latest_log(ctx: &CommandContext, params: &Value) -> Result<Value, ErrorPayload> {
    let task_id = super::extract_task_id(params)?;
    let api = ctx.api.lock().map_err(|_| ErrorPayload::lock_error())?;
    let log = api.get_latest_log(&task_id).map_err(ErrorPayload::from)?;
    Ok(serde_json::to_value(log).unwrap_or(Value::Null))
}

// ============================================================================
// PR status
// ============================================================================

// -- gh CLI deserialization types --

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct GhPrResponse {
    url: String,
    state: String,
    #[serde(default)]
    status_check_rollup: Vec<GhStatusCheck>,
    #[serde(default)]
    mergeable: Option<String>,
    #[serde(default)]
    merge_state_status: Option<String>,
    #[serde(default)]
    head_ref_oid: Option<String>,
}

#[derive(Deserialize)]
struct GhStatusCheck {
    // CheckRun entries have `name`; StatusContext entries have `context`.
    // Both are optional here so either type deserializes without error.
    #[serde(default)]
    name: Option<String>,
    #[serde(default)]
    context: Option<String>,
    status: Option<String>,
    conclusion: Option<String>,
}

#[derive(Deserialize)]
struct GhApiReview {
    id: i64,
    user: Option<GhAuthor>,
    body: Option<String>,
    state: String,
    submitted_at: Option<String>,
}

#[derive(Deserialize)]
struct GhAuthor {
    login: String,
}

#[derive(Deserialize)]
struct GhGraphQLError {
    message: String,
}

#[derive(Deserialize)]
struct GhGraphQLResponse {
    data: Option<GhGraphQLData>,
    #[serde(default)]
    errors: Option<Vec<GhGraphQLError>>,
}

#[derive(Deserialize)]
struct GhGraphQLData {
    repository: GhGraphQLRepository,
}

#[derive(Deserialize)]
struct GhGraphQLRepository {
    #[serde(rename = "pullRequest")]
    pull_request: GhGraphQLPullRequest,
}

#[derive(Deserialize)]
struct GhGraphQLPullRequest {
    #[serde(rename = "reviewComments")]
    review_comments: GhGraphQLReviewComments,
}

#[derive(Deserialize)]
struct GhGraphQLReviewComments {
    nodes: Vec<GhGraphQLReviewComment>,
    #[serde(rename = "pageInfo")]
    page_info: GhGraphQLPageInfo,
}

#[derive(Deserialize)]
struct GhGraphQLPageInfo {
    #[serde(rename = "hasNextPage")]
    has_next_page: bool,
}

#[derive(Deserialize)]
struct GhGraphQLReviewComment {
    #[serde(rename = "databaseId")]
    database_id: i64,
    author: Option<GhAuthor>,
    body: String,
    path: Option<String>,
    #[serde(default)]
    line: Option<u32>,
    #[serde(rename = "createdAt")]
    created_at: String,
    #[serde(rename = "pullRequestReview")]
    pull_request_review: Option<GhGraphQLReviewRef>,
    outdated: bool,
}

#[derive(Deserialize)]
struct GhGraphQLReviewRef {
    #[serde(rename = "databaseId")]
    database_id: Option<i64>,
}

#[derive(Deserialize, Default)]
struct GhCheckRunsResponse {
    check_runs: Vec<GhCheckRun>,
}

#[derive(Deserialize)]
struct GhCheckRun {
    id: i64,
    name: String,
    output: Option<GhCheckRunOutput>,
}

#[derive(Deserialize)]
struct GhCheckRunOutput {
    summary: Option<String>,
}

const GH_TIMEOUT: Duration = Duration::from_secs(10);

const REVIEW_COMMENTS_QUERY: &str = r"
query($owner: String!, $repo: String!, $number: Int!) {
  repository(owner: $owner, name: $repo) {
    pullRequest(number: $number) {
      reviewComments(first: 100) {
        nodes {
          databaseId
          author { login }
          body
          path
          line
          createdAt
          pullRequestReview { databaseId }
          outdated
        }
        pageInfo { hasNextPage }
      }
    }
  }
}
";

/// Fetches PR state, checks, reviews, and comments.
///
/// Expected params: `{ "pr_url": "<url>" }`
///
/// Runs the async `fetch_pr_status` via `Handle::block_on` since this function
/// is called from a `spawn_blocking` thread through the `run_sync` wrapper.
pub fn get_pr_status(_ctx: &CommandContext, params: &Value) -> Result<Value, ErrorPayload> {
    let pr_url = params
        .get("pr_url")
        .and_then(|v| v.as_str())
        .ok_or_else(|| ErrorPayload::invalid_params("missing field: pr_url"))?
        .to_string();

    let handle = tokio::runtime::Handle::current();
    let status = handle.block_on(fetch_pr_status(&pr_url))?;
    Ok(serde_json::to_value(status).unwrap_or(Value::Null))
}

/// Fetches PR status from GitHub using the `gh` CLI.
///
/// Parses the PR URL, calls `gh pr view` and `gh api` endpoints, and returns
/// a structured `PrStatus`. Requires the `gh` CLI to be installed and authenticated.
pub async fn fetch_pr_status(pr_url: &str) -> Result<PrStatus, ErrorPayload> {
    let (owner, repo, number) = parse_pr_url(pr_url).ok_or_else(|| {
        ErrorPayload::new(
            "INVALID_PR_URL",
            format!("Not a valid GitHub PR URL: {pr_url}"),
        )
    })?;

    let reviews_path = format!("repos/{owner}/{repo}/pulls/{number}/reviews");
    let pr_view_args = [
        "pr",
        "view",
        pr_url,
        "--json",
        "state,statusCheckRollup,url,number,mergeable,mergeStateStatus,headRefOid",
    ];

    let stdout = run_gh(&pr_view_args).await?;
    let response: GhPrResponse = serde_json::from_str(&stdout).map_err(|e| {
        ErrorPayload::new(
            "GH_PARSE_ERROR",
            format!("Failed to parse gh pr view output: {e}"),
        )
    })?;

    let check_runs_path = response
        .head_ref_oid
        .as_deref()
        .map(|sha| format!("repos/{owner}/{repo}/commits/{sha}/check-runs?per_page=100"));

    let reviews_args: [&str; 2] = ["api", &reviews_path];

    let (reviews_result, comments_result, check_runs_result) = tokio::join!(
        run_gh(&reviews_args),
        fetch_graphql_comments(owner, repo, number),
        async {
            match &check_runs_path {
                Some(path) => run_gh(&["api", path]).await,
                None => Err(ErrorPayload::new("NO_HEAD_SHA", "No head SHA available")),
            }
        }
    );

    let check_enrichments: std::collections::HashMap<String, (i64, Option<String>)> =
        match check_runs_result {
            Ok(api_stdout) => {
                let parsed: GhCheckRunsResponse =
                    serde_json::from_str(&api_stdout).unwrap_or_else(|e| {
                        tracing::warn!("Failed to parse check-runs JSON: {e}");
                        GhCheckRunsResponse::default()
                    });
                parsed
                    .check_runs
                    .into_iter()
                    .map(|cr| (cr.name, (cr.id, cr.output.and_then(|o| o.summary))))
                    .collect()
            }
            Err(e) => {
                tracing::warn!("[pr] Failed to fetch check-runs: {}", e.message);
                std::collections::HashMap::new()
            }
        };

    let checks = map_checks(response.status_check_rollup.iter(), check_enrichments);

    let reviews = match reviews_result {
        Ok(api_stdout) => map_reviews(&api_stdout),
        Err(e) => {
            tracing::warn!("[pr] Failed to fetch PR reviews: {}", e.message);
            Vec::new()
        }
    };

    let comments = match comments_result {
        Ok(c) => c,
        Err(e) => {
            tracing::warn!("[pr] Failed to fetch PR comments: {}", e.message);
            Vec::new()
        }
    };

    let mergeable = response.mergeable.as_deref().and_then(|m| match m {
        "MERGEABLE" => Some(true),
        "CONFLICTING" => Some(false),
        _ => None,
    });

    let state = normalize_pr_state(&response.state).to_string();

    Ok(PrStatus {
        url: response.url,
        state,
        checks,
        reviews,
        comments,
        fetched_at: Utc::now().to_rfc3339(),
        mergeable,
        merge_state_status: response.merge_state_status,
    })
}

// -- Helpers --

fn map_checks<'a>(
    status_checks: impl Iterator<Item = &'a GhStatusCheck>,
    mut check_enrichments: std::collections::HashMap<String, (i64, Option<String>)>,
) -> Vec<PrCheck> {
    status_checks
        .map(|check| {
            let name = check
                .name
                .clone()
                .or_else(|| check.context.clone())
                .unwrap_or_default();
            let enrichment = check_enrichments.remove(&name);
            PrCheck {
                name,
                status: orkestra_types::domain::classify_check(
                    check.status.as_deref(),
                    check.conclusion.as_deref(),
                )
                .as_str()
                .to_string(),
                conclusion: check.conclusion.clone(),
                id: enrichment.as_ref().map(|(id, _)| *id),
                summary: enrichment.and_then(|(_, s)| s),
            }
        })
        .collect()
}

fn map_reviews(api_stdout: &str) -> Vec<PrReview> {
    let api_reviews: Vec<GhApiReview> = match serde_json::from_str(api_stdout) {
        Ok(v) => v,
        Err(e) => {
            tracing::warn!("Failed to parse PR reviews JSON: {e}");
            Vec::new()
        }
    };
    api_reviews
        .into_iter()
        .map(|r| PrReview {
            id: r.id,
            author: r.user.map_or_else(|| "ghost".into(), |u| u.login),
            state: r.state,
            body: r.body,
            submitted_at: r.submitted_at.unwrap_or_default(),
        })
        .collect()
}

async fn fetch_graphql_comments(
    owner: &str,
    repo: &str,
    number: &str,
) -> Result<Vec<PrComment>, ErrorPayload> {
    let query_arg = format!("query={REVIEW_COMMENTS_QUERY}");
    let owner_arg = format!("owner={owner}");
    let repo_arg = format!("repo={repo}");
    let number_arg = format!("number={number}");

    let stdout = run_gh(&[
        "api",
        "graphql",
        "-f",
        &query_arg,
        "-F",
        &owner_arg,
        "-F",
        &repo_arg,
        "-F",
        &number_arg,
    ])
    .await?;

    let response: GhGraphQLResponse = serde_json::from_str(&stdout).map_err(|e| {
        ErrorPayload::new(
            "GH_PARSE_ERROR",
            format!("Failed to parse GraphQL comments response: {e}"),
        )
    })?;

    if let Some(errors) = &response.errors {
        let messages: Vec<&str> = errors.iter().map(|e| e.message.as_str()).collect();
        return Err(ErrorPayload::new(
            "GH_GRAPHQL_ERROR",
            format!("GraphQL returned errors: {}", messages.join("; ")),
        ));
    }

    let data = response.data.ok_or_else(|| {
        ErrorPayload::new("GH_GRAPHQL_ERROR", "GraphQL response missing data field")
    })?;

    let comments_data = data.repository.pull_request.review_comments;

    if comments_data.page_info.has_next_page {
        tracing::warn!(
            "[pr] GraphQL reviewComments has more than 100 results; pagination not yet implemented"
        );
    }

    Ok(comments_data
        .nodes
        .into_iter()
        .map(|c| PrComment {
            id: c.database_id,
            author: c.author.map_or_else(|| "ghost".into(), |a| a.login),
            body: c.body,
            path: c.path,
            line: c.line,
            created_at: c.created_at,
            review_id: c.pull_request_review.and_then(|r| r.database_id),
            outdated: c.outdated,
        })
        .collect())
}

fn parse_pr_url(url: &str) -> Option<(&str, &str, &str)> {
    let path = url.strip_prefix("https://github.com/")?;
    let parts: Vec<&str> = path.split('/').collect();
    if parts.len() >= 4 && parts[2] == "pull" {
        Some((parts[0], parts[1], parts[3]))
    } else {
        None
    }
}

fn normalize_pr_state(state: &str) -> &'static str {
    if state.eq_ignore_ascii_case("merged") {
        "merged"
    } else if state.eq_ignore_ascii_case("closed") {
        "closed"
    } else {
        "open"
    }
}

async fn run_gh(args: &[&str]) -> Result<String, ErrorPayload> {
    let result = tokio::time::timeout(GH_TIMEOUT, Command::new("gh").args(args).output()).await;

    let output = match result {
        Ok(Ok(output)) => output,
        Ok(Err(e)) => {
            return if e.kind() == std::io::ErrorKind::NotFound {
                Err(ErrorPayload::new(
                    "GH_CLI_NOT_FOUND",
                    "GitHub CLI (gh) is not installed or not in PATH",
                ))
            } else {
                Err(ErrorPayload::new(
                    "GH_CLI_ERROR",
                    format!("Failed to run gh: {e}"),
                ))
            };
        }
        Err(_) => {
            return Err(ErrorPayload::new(
                "GH_TIMEOUT",
                "GitHub CLI timed out after 10 seconds",
            ))
        }
    };

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        return Err(ErrorPayload::new(
            "GH_CLI_ERROR",
            format!("gh command failed: {stderr}"),
        ));
    }

    Ok(String::from_utf8_lossy(&output.stdout).into_owned())
}
