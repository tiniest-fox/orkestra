//! Read-only query commands.

use std::sync::Arc;

use crate::{error::TauriError, project_registry::ProjectRegistry};
use chrono::Utc;
use orkestra_core::workflow::{
    Artifact, AutoTaskTemplate, Iteration, LogEntry, Question, TaskView, WorkflowConfig,
};
use serde::{Deserialize, Serialize};
use std::time::Duration;
use tauri::{State, Window};
use tokio::process::Command;

/// Get the workflow configuration.
///
/// Returns the stage definitions and workflow settings.
/// This is infallible since config is loaded at startup, but returns Result
/// for API consistency.
#[tauri::command]
#[allow(clippy::unnecessary_wraps)]
pub fn workflow_get_config(
    registry: State<ProjectRegistry>,
    window: Window,
) -> Result<WorkflowConfig, TauriError> {
    registry.with_project(window.label(), |state| Ok(state.config().clone()))
}

/// Bundled startup data pushed from the Tauri side before React mounts.
///
/// Lets React skip IPC calls for the initial render — both config and tasks
/// are already in memory when the window opens.
#[derive(serde::Serialize, Clone)]
pub struct StartupData {
    /// Workflow config (already loaded at startup).
    pub config: WorkflowConfig,
    /// Task list pre-fetched in the background thread.
    pub tasks: Vec<TaskView>,
}

/// Consume the pre-fetched startup data (one-shot).
///
/// Returns `Some(StartupData)` if the background prefetch has completed,
/// `None` if it hasn't finished yet (React should fall back to polling).
#[tauri::command]
#[allow(clippy::unnecessary_wraps)]
pub fn workflow_get_startup_data(
    registry: State<ProjectRegistry>,
    window: Window,
) -> Result<Option<StartupData>, TauriError> {
    registry.with_project(window.label(), |state| {
        let arc = state.startup_tasks();
        let slot = arc.lock().unwrap();
        Ok(slot.as_ref().map(|tasks| StartupData {
            config: state.config().clone(),
            tasks: tasks.clone(),
        }))
    })
}

/// Get auto-task templates.
///
/// Returns predefined task templates loaded from `.orkestra/tasks/*.md`.
/// Templates are loaded once at startup and cached.
#[tauri::command]
#[allow(clippy::unnecessary_wraps)]
pub fn workflow_get_auto_task_templates(
    registry: State<ProjectRegistry>,
    window: Window,
) -> Result<Vec<AutoTaskTemplate>, TauriError> {
    registry.with_project(window.label(), |state| {
        Ok(state.auto_task_templates().to_vec())
    })
}

/// Get all iterations for a task.
#[tauri::command]
pub fn workflow_get_iterations(
    registry: State<ProjectRegistry>,
    window: Window,
    task_id: String,
) -> Result<Vec<Iteration>, TauriError> {
    registry.with_project(window.label(), |state| {
        state.api()?.get_iterations(&task_id).map_err(Into::into)
    })
}

/// Get a specific artifact by name.
#[tauri::command]
pub fn workflow_get_artifact(
    registry: State<ProjectRegistry>,
    window: Window,
    task_id: String,
    name: String,
) -> Result<Option<Artifact>, TauriError> {
    registry.with_project(window.label(), |state| {
        state
            .api()?
            .get_artifact(&task_id, &name)
            .map_err(Into::into)
    })
}

/// Get pending questions for a task.
#[tauri::command]
pub fn workflow_get_pending_questions(
    registry: State<ProjectRegistry>,
    window: Window,
    task_id: String,
) -> Result<Vec<Question>, TauriError> {
    registry.with_project(window.label(), |state| {
        state
            .api()?
            .get_pending_questions(&task_id)
            .map_err(Into::into)
    })
}

/// Get the current stage for a task.
#[tauri::command]
pub fn workflow_get_current_stage(
    registry: State<ProjectRegistry>,
    window: Window,
    task_id: String,
) -> Result<Option<String>, TauriError> {
    registry.with_project(window.label(), |state| {
        state.api()?.get_current_stage(&task_id).map_err(Into::into)
    })
}

/// Get rejection feedback from the last iteration.
#[tauri::command]
pub fn workflow_get_rejection_feedback(
    registry: State<ProjectRegistry>,
    window: Window,
    task_id: String,
) -> Result<Option<String>, TauriError> {
    registry.with_project(window.label(), |state| {
        state
            .api()?
            .get_rejection_feedback(&task_id)
            .map_err(Into::into)
    })
}

/// Branch information for the UI.
#[derive(Serialize)]
pub struct BranchList {
    /// Available branches (excluding task/* branches).
    pub branches: Vec<String>,
    /// Currently checked-out branch.
    pub current: Option<String>,
    /// Latest commit message (first line).
    pub latest_commit_message: Option<String>,
}

/// List available git branches.
///
/// Returns empty lists if git service is not configured.
#[tauri::command]
pub fn workflow_list_branches(
    registry: State<ProjectRegistry>,
    window: Window,
) -> Result<BranchList, TauriError> {
    registry.with_project(window.label(), |state| {
        let git = {
            let api = state.api()?;
            let Some(git) = api.git_service() else {
                return Ok(BranchList {
                    branches: vec![],
                    current: None,
                    latest_commit_message: None,
                });
            };
            Arc::clone(git)
        }; // mutex released here — git subprocesses run off the lock

        let latest_commit_message = git
            .commit_log(1)
            .ok()
            .and_then(|commits| commits.first().map(|c| c.message.clone()));

        Ok(BranchList {
            branches: git.list_branches().unwrap_or_default(),
            current: git.current_branch().ok(),
            latest_commit_message,
        })
    })
}

/// Get log entries for a task's stage or a specific session.
///
/// Reads log entries from the database for a specific session, or the task's
/// current (or specified) stage session.
///
/// # Arguments
/// * `task_id` - The task ID
/// * `stage` - Optional stage name. If None, uses the task's current stage.
/// * `session_id` - Optional session ID. If provided, fetches logs for that
///   specific session directly (takes precedence over `stage`).
///
/// # Returns
/// Vec of LogEntry representing agent activity (tool uses, text output, etc.)
#[tauri::command]
#[allow(clippy::similar_names)]
pub fn workflow_get_logs(
    registry: State<ProjectRegistry>,
    window: Window,
    task_id: String,
    stage: Option<String>,
    session_id: Option<String>,
) -> Result<Vec<LogEntry>, TauriError> {
    registry.with_project(window.label(), |state| {
        state
            .api()?
            .get_task_logs(&task_id, stage.as_deref(), session_id.as_deref())
            .map_err(Into::into)
    })
}

/// Get the most recent log entry for a task's current stage session.
///
/// Returns `None` if the task has no active stage, no session for the stage,
/// or the session has no log entries.
#[tauri::command]
pub fn workflow_get_latest_log(
    registry: State<ProjectRegistry>,
    window: Window,
    task_id: String,
) -> Result<Option<LogEntry>, TauriError> {
    registry.with_project(window.label(), |state| {
        state.api()?.get_latest_log(&task_id).map_err(Into::into)
    })
}

// =============================================================================
// PR Status
// =============================================================================

/// PR status information from GitHub.
#[derive(Serialize)]
#[serde(rename_all = "snake_case")]
pub struct PrStatus {
    /// The PR URL.
    pub url: String,
    /// PR state: "open", "merged", or "closed".
    pub state: String,
    /// CI/CD check statuses.
    pub checks: Vec<PrCheck>,
    /// Review statuses.
    pub reviews: Vec<PrReview>,
    /// Review comments on the PR.
    pub comments: Vec<PrComment>,
    /// Timestamp when this status was fetched (RFC3339).
    pub fetched_at: String,
    /// Whether the PR can be merged (false if conflicts exist).
    pub mergeable: Option<bool>,
    /// GitHub merge state: "BEHIND", "BLOCKED", "CLEAN", "DIRTY", "DRAFT", "`HAS_HOOKS`", "UNKNOWN", "UNSTABLE".
    /// "DIRTY" indicates merge conflicts.
    pub merge_state_status: Option<String>,
}

/// A single CI/CD check status.
#[derive(Serialize)]
pub struct PrCheck {
    /// Name of the check (e.g., "tests", "lint").
    pub name: String,
    /// Status: "pending", "success", "failure", or "skipped".
    pub status: String,
    /// Conclusion if completed (e.g., "SUCCESS", "FAILURE").
    pub conclusion: Option<String>,
    /// GitHub check run ID (if available from check-runs API).
    pub id: Option<i64>,
    /// Failure summary from check run output (e.g., "3 tests failed").
    pub summary: Option<String>,
}

/// A single review status.
#[derive(Serialize)]
pub struct PrReview {
    /// GitHub review ID (numeric, from REST API).
    pub id: i64,
    /// GitHub username of the reviewer.
    pub author: String,
    /// Review state: "APPROVED", "`CHANGES_REQUESTED`", "COMMENTED", or "PENDING".
    pub state: String,
    /// Review body (markdown), may be empty.
    pub body: Option<String>,
    /// When the review was submitted (ISO 8601). Empty for pending reviews.
    pub submitted_at: String,
}

/// A single PR review comment.
#[derive(Serialize)]
pub struct PrComment {
    /// GitHub comment ID.
    pub id: i64,
    /// GitHub username of the commenter.
    pub author: String,
    /// Comment body (markdown).
    pub body: String,
    /// File path if this is a file-level or line-level comment.
    pub path: Option<String>,
    /// Line number if this is a line-level comment.
    pub line: Option<u32>,
    /// When the comment was created (ISO 8601).
    pub created_at: String,
    /// Review ID this comment belongs to (null for standalone comments).
    pub review_id: Option<i64>,
}

/// Raw JSON response from `gh pr view --json`.
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct GhPrResponse {
    url: String,
    state: String,
    #[serde(default)]
    status_check_rollup: Vec<GhStatusCheck>,
    /// GitHub returns "MERGEABLE", "CONFLICTING", or "UNKNOWN".
    #[serde(default)]
    mergeable: Option<String>,
    /// Merge state: "BEHIND", "BLOCKED", "CLEAN", "DIRTY", "DRAFT", "`HAS_HOOKS`", "UNKNOWN", "UNSTABLE".
    #[serde(default)]
    merge_state_status: Option<String>,
    /// HEAD commit SHA for fetching check-runs via the REST API.
    #[serde(default)]
    head_ref_oid: Option<String>,
}

/// Raw JSON response from `gh api` for review comments.
#[derive(Deserialize)]
struct GhApiReviewComment {
    id: i64,
    user: Option<GhAuthor>,
    body: String,
    path: Option<String>,
    #[serde(default)]
    line: Option<u32>,
    created_at: String,
    pull_request_review_id: Option<i64>,
}

/// Raw JSON response from `gh api` for reviews.
#[derive(Deserialize)]
struct GhApiReview {
    id: i64,
    user: Option<GhAuthor>,
    body: Option<String>,
    state: String,
    submitted_at: Option<String>,
}

#[derive(Deserialize)]
struct GhStatusCheck {
    name: String,
    status: Option<String>,
    conclusion: Option<String>,
}

#[derive(Deserialize)]
struct GhAuthor {
    login: String,
}

/// Raw JSON response from the GitHub check-runs API.
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

/// Parse a GitHub PR URL into `(owner, repo, number)`.
///
/// Accepts URLs like `https://github.com/owner/repo/pull/123`.
fn parse_pr_url(url: &str) -> Option<(&str, &str, &str)> {
    let path = url.strip_prefix("https://github.com/")?;
    let parts: Vec<&str> = path.split('/').collect();
    if parts.len() >= 4 && parts[2] == "pull" {
        Some((parts[0], parts[1], parts[3]))
    } else {
        None
    }
}

/// Convert GitHub's PR state to our normalized format.
fn normalize_pr_state(state: &str) -> &'static str {
    match state.to_uppercase().as_str() {
        "MERGED" => "merged",
        "CLOSED" => "closed",
        _ => "open", // OPEN or unknown states default to open
    }
}

const GH_TIMEOUT: Duration = Duration::from_secs(10);

/// Run a `gh` CLI command and return stdout on success.
async fn run_gh(args: &[&str]) -> Result<String, TauriError> {
    let result = tokio::time::timeout(GH_TIMEOUT, Command::new("gh").args(args).output()).await;

    let output = match result {
        Ok(Ok(output)) => output,
        Ok(Err(e)) => {
            return if e.kind() == std::io::ErrorKind::NotFound {
                Err(TauriError::new(
                    "GH_CLI_NOT_FOUND",
                    "GitHub CLI (gh) is not installed or not in PATH",
                ))
            } else {
                Err(TauriError::new(
                    "GH_CLI_ERROR",
                    format!("Failed to run gh: {e}"),
                ))
            };
        }
        Err(_) => {
            return Err(TauriError::new(
                "GH_TIMEOUT",
                "GitHub CLI timed out after 10 seconds",
            ));
        }
    };

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        return Err(TauriError::new(
            "GH_CLI_ERROR",
            format!("gh command failed: {stderr}"),
        ));
    }

    Ok(String::from_utf8_lossy(&output.stdout).into_owned())
}

/// Get PR status from GitHub.
///
/// Calls `gh pr view` for state/checks/reviews, then `gh api` for review comments
/// (inline code comments). The `gh pr view` CLI doesn't expose review comments as
/// a JSON field, so a separate REST API call is needed.
///
/// # Arguments
/// * `pr_url` - The full GitHub PR URL (e.g., `https://github.com/owner/repo/pull/123`)
///
/// # Returns
/// `PrStatus` with state, checks, reviews, and review comments.
///
/// # Errors
/// Returns error if `gh` CLI is not installed or the PR URL is invalid.
#[tauri::command]
#[allow(clippy::too_many_lines)]
pub async fn workflow_get_pr_status(pr_url: String) -> Result<PrStatus, TauriError> {
    // Parse URL upfront so we fail fast instead of silently returning empty comments.
    let (owner, repo, number) = parse_pr_url(&pr_url).ok_or_else(|| {
        TauriError::new(
            "INVALID_PR_URL",
            format!("Not a valid GitHub PR URL: {pr_url}"),
        )
    })?;

    // Fetch PR view first — the HEAD SHA it returns is needed for the check-runs call.
    let reviews_path = format!("repos/{owner}/{repo}/pulls/{number}/reviews");
    let comments_path = format!("repos/{owner}/{repo}/pulls/{number}/comments");
    let pr_view_args = [
        "pr",
        "view",
        &pr_url,
        "--json",
        "state,statusCheckRollup,url,number,mergeable,mergeStateStatus,headRefOid",
    ];

    let stdout = run_gh(&pr_view_args).await?;
    let response: GhPrResponse = serde_json::from_str(&stdout).map_err(|e| {
        TauriError::new(
            "GH_PARSE_ERROR",
            format!("Failed to parse gh pr view output: {e}\nRaw output: {stdout}"),
        )
    })?;

    // Build check-runs path from the HEAD SHA (now available after pr view).
    let check_runs_path = response
        .head_ref_oid
        .as_deref()
        .map(|sha| format!("repos/{owner}/{repo}/commits/{sha}/check-runs?per_page=100"));

    // Run reviews, comments, and check-runs concurrently.
    let reviews_args: [&str; 2] = ["api", &reviews_path];
    let comments_args: [&str; 2] = ["api", &comments_path];

    let (reviews_result, comments_result, check_runs_result) =
        tokio::join!(run_gh(&reviews_args), run_gh(&comments_args), async {
            match &check_runs_path {
                Some(path) => run_gh(&["api", path]).await,
                None => Err(TauriError::new("NO_HEAD_SHA", "No head SHA available")),
            }
        });

    // Build enrichment lookup from check-runs API (non-fatal).
    let check_enrichments: std::collections::HashMap<String, (i64, Option<String>)> =
        match check_runs_result {
            Ok(api_stdout) => {
                let parsed: GhCheckRunsResponse =
                    serde_json::from_str(&api_stdout).unwrap_or_else(|e| {
                        tracing::warn!("[pr] Failed to parse check-runs response: {e}");
                        GhCheckRunsResponse::default()
                    });
                parsed
                    .check_runs
                    .into_iter()
                    .map(|cr| {
                        let summary = cr.output.and_then(|o| o.summary);
                        (cr.name, (cr.id, summary))
                    })
                    .collect()
            }
            Err(e) => {
                tracing::warn!("[pr] Failed to fetch check-runs: {e}");
                std::collections::HashMap::new()
            }
        };

    let checks: Vec<PrCheck> = response
        .status_check_rollup
        .iter()
        .map(|check| {
            let enrichment = check_enrichments.get(&check.name);
            PrCheck {
                name: check.name.clone(),
                status: orkestra_types::domain::classify_check(
                    check.status.as_deref(),
                    check.conclusion.as_deref(),
                )
                .as_str()
                .to_string(),
                conclusion: check.conclusion.clone(),
                id: enrichment.map(|(id, _)| *id),
                summary: enrichment.and_then(|(_, s)| s.clone()),
            }
        })
        .collect();

    // Reviews are non-fatal: PR status is still useful without them.
    let reviews = match reviews_result {
        Ok(api_stdout) => {
            let api_reviews: Vec<GhApiReview> =
                serde_json::from_str(&api_stdout).unwrap_or_default();
            api_reviews
                .into_iter()
                .filter_map(|r| {
                    Some(PrReview {
                        id: r.id,
                        author: r.user?.login,
                        state: r.state,
                        body: r.body,
                        submitted_at: r.submitted_at.unwrap_or_default(),
                    })
                })
                .collect()
        }
        Err(e) => {
            tracing::warn!("[pr] Failed to fetch PR reviews: {e}");
            Vec::new()
        }
    };

    // Comments are non-fatal: PR status is still useful without them.
    let comments = match comments_result {
        Ok(api_stdout) => {
            let api_comments: Vec<GhApiReviewComment> =
                serde_json::from_str(&api_stdout).unwrap_or_default();
            api_comments
                .into_iter()
                .filter_map(|c| {
                    Some(PrComment {
                        id: c.id,
                        author: c.user?.login,
                        body: c.body,
                        path: c.path,
                        line: c.line,
                        created_at: c.created_at,
                        review_id: c.pull_request_review_id,
                    })
                })
                .collect()
        }
        Err(e) => {
            tracing::warn!("[pr] Failed to fetch PR comments: {e}");
            Vec::new()
        }
    };

    // Convert mergeable enum to boolean: "MERGEABLE" -> true, "CONFLICTING" -> false, "UNKNOWN" -> None
    let mergeable = response.mergeable.as_deref().and_then(|m| match m {
        "MERGEABLE" => Some(true),
        "CONFLICTING" => Some(false),
        _ => None, // "UNKNOWN" or unexpected values
    });

    Ok(PrStatus {
        url: response.url,
        state: normalize_pr_state(&response.state).to_string(),
        checks,
        reviews,
        comments,
        fetched_at: Utc::now().to_rfc3339(),
        mergeable,
        merge_state_status: response.merge_state_status,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn normalize_pr_state_handles_known_states() {
        assert_eq!(normalize_pr_state("MERGED"), "merged");
        assert_eq!(normalize_pr_state("CLOSED"), "closed");
        assert_eq!(normalize_pr_state("OPEN"), "open");
    }

    #[test]
    fn normalize_pr_state_is_case_insensitive() {
        assert_eq!(normalize_pr_state("merged"), "merged");
        assert_eq!(normalize_pr_state("Merged"), "merged");
        assert_eq!(normalize_pr_state("closed"), "closed");
        assert_eq!(normalize_pr_state("Closed"), "closed");
    }

    #[test]
    fn normalize_pr_state_defaults_unknown_to_open() {
        assert_eq!(normalize_pr_state("DRAFT"), "open");
        assert_eq!(normalize_pr_state("unknown"), "open");
        assert_eq!(normalize_pr_state(""), "open");
    }

    #[test]
    fn deserialize_gh_pr_response() {
        let json = r#"{
            "url": "https://github.com/owner/repo/pull/123",
            "state": "OPEN",
            "statusCheckRollup": []
        }"#;

        let response: GhPrResponse = serde_json::from_str(json).unwrap();
        assert_eq!(response.url, "https://github.com/owner/repo/pull/123");
        assert_eq!(response.state, "OPEN");
        assert!(response.status_check_rollup.is_empty());
        assert!(response.mergeable.is_none());
        assert!(response.merge_state_status.is_none());
        assert!(response.head_ref_oid.is_none());
    }

    #[test]
    fn deserialize_gh_pr_response_with_merge_fields() {
        let json = r#"{
            "url": "https://github.com/owner/repo/pull/123",
            "state": "OPEN",
            "statusCheckRollup": [],
            "mergeable": "CONFLICTING",
            "mergeStateStatus": "DIRTY"
        }"#;

        let response: GhPrResponse = serde_json::from_str(json).unwrap();
        assert_eq!(response.mergeable, Some("CONFLICTING".to_string()));
        assert_eq!(response.merge_state_status, Some("DIRTY".to_string()));
    }

    #[test]
    fn deserialize_gh_pr_response_with_head_ref_oid() {
        let json = r#"{
            "url": "https://github.com/owner/repo/pull/123",
            "state": "OPEN",
            "statusCheckRollup": [],
            "headRefOid": "abc123def456"
        }"#;

        let response: GhPrResponse = serde_json::from_str(json).unwrap();
        assert_eq!(response.head_ref_oid, Some("abc123def456".to_string()));
    }

    #[test]
    fn deserialize_gh_check_runs_response() {
        let json = r#"{
            "check_runs": [
                {
                    "id": 12345,
                    "name": "CI / tests",
                    "output": {"summary": "3 tests failed"}
                },
                {
                    "id": 12346,
                    "name": "CI / lint",
                    "output": null
                },
                {
                    "id": 12347,
                    "name": "CI / build",
                    "output": {"summary": null}
                }
            ]
        }"#;

        let response: GhCheckRunsResponse = serde_json::from_str(json).unwrap();
        assert_eq!(response.check_runs.len(), 3);

        assert_eq!(response.check_runs[0].id, 12345);
        assert_eq!(response.check_runs[0].name, "CI / tests");
        assert_eq!(
            response.check_runs[0].output.as_ref().unwrap().summary,
            Some("3 tests failed".to_string())
        );

        assert_eq!(response.check_runs[1].id, 12346);
        assert!(response.check_runs[1].output.is_none());

        assert_eq!(response.check_runs[2].id, 12347);
        assert_eq!(
            response.check_runs[2].output.as_ref().unwrap().summary,
            None
        );
    }

    #[test]
    fn check_enrichment_matches_by_name() {
        let check_runs = GhCheckRunsResponse {
            check_runs: vec![
                GhCheckRun {
                    id: 100,
                    name: "CI / tests".to_string(),
                    output: Some(GhCheckRunOutput {
                        summary: Some("2 tests failed".to_string()),
                    }),
                },
                GhCheckRun {
                    id: 101,
                    name: "CI / lint".to_string(),
                    output: None,
                },
            ],
        };

        let enrichments: std::collections::HashMap<String, (i64, Option<String>)> = check_runs
            .check_runs
            .into_iter()
            .map(|cr| {
                let summary = cr.output.and_then(|o| o.summary);
                (cr.name, (cr.id, summary))
            })
            .collect();

        let (id, summary) = enrichments.get("CI / tests").unwrap();
        assert_eq!(*id, 100);
        assert_eq!(summary.as_deref(), Some("2 tests failed"));

        let (id, summary) = enrichments.get("CI / lint").unwrap();
        assert_eq!(*id, 101);
        assert!(summary.is_none());

        // Unmatched name returns None
        assert!(enrichments.get("CI / missing").is_none());
    }

    #[test]
    fn mergeable_conversion() {
        // MERGEABLE -> true
        let mergeable_str = Some("MERGEABLE");
        let result = mergeable_str.and_then(|m| match m {
            "MERGEABLE" => Some(true),
            "CONFLICTING" => Some(false),
            _ => None,
        });
        assert_eq!(result, Some(true));

        // CONFLICTING -> false
        let conflicting_str = Some("CONFLICTING");
        let result = conflicting_str.and_then(|m| match m {
            "MERGEABLE" => Some(true),
            "CONFLICTING" => Some(false),
            _ => None,
        });
        assert_eq!(result, Some(false));

        // UNKNOWN -> None
        let unknown_str = Some("UNKNOWN");
        let result = unknown_str.and_then(|m| match m {
            "MERGEABLE" => Some(true),
            "CONFLICTING" => Some(false),
            _ => None,
        });
        assert_eq!(result, None);

        // None -> None
        let none_str: Option<&str> = None;
        let result = none_str.and_then(|m| match m {
            "MERGEABLE" => Some(true),
            "CONFLICTING" => Some(false),
            _ => None,
        });
        assert_eq!(result, None);
    }

    #[test]
    fn deserialize_api_review_comments() {
        let json = r#"[
            {
                "id": 42,
                "user": {"login": "reviewer"},
                "body": "Please fix this",
                "path": "src/main.rs",
                "line": 10,
                "created_at": "2024-01-15T10:30:00Z",
                "pull_request_review_id": 999
            },
            {
                "id": 43,
                "user": {"login": "reviewer2"},
                "body": "General comment",
                "path": null,
                "line": null,
                "created_at": "2024-01-15T11:00:00Z",
                "pull_request_review_id": null
            }
        ]"#;

        let comments: Vec<GhApiReviewComment> = serde_json::from_str(json).unwrap();
        assert_eq!(comments.len(), 2);

        assert_eq!(comments[0].id, 42);
        assert_eq!(comments[0].user.as_ref().unwrap().login, "reviewer");
        assert_eq!(comments[0].body, "Please fix this");
        assert_eq!(comments[0].path, Some("src/main.rs".to_string()));
        assert_eq!(comments[0].line, Some(10));
        assert_eq!(comments[0].pull_request_review_id, Some(999));

        assert_eq!(comments[1].id, 43);
        assert_eq!(comments[1].path, None);
        assert_eq!(comments[1].line, None);
        assert_eq!(comments[1].pull_request_review_id, None);
    }

    #[test]
    fn api_comments_filter_out_missing_user() {
        let json = r#"[
            {
                "id": 42,
                "user": {"login": "reviewer"},
                "body": "Valid comment",
                "path": "src/main.rs",
                "line": 10,
                "created_at": "2024-01-15T10:30:00Z",
                "pull_request_review_id": 999
            },
            {
                "id": 44,
                "user": null,
                "body": "Missing author",
                "path": null,
                "line": null,
                "created_at": "2024-01-15T10:30:00Z",
                "pull_request_review_id": null
            }
        ]"#;

        let api_comments: Vec<GhApiReviewComment> = serde_json::from_str(json).unwrap();
        let comments: Vec<PrComment> = api_comments
            .into_iter()
            .filter_map(|c| {
                Some(PrComment {
                    id: c.id,
                    author: c.user?.login,
                    body: c.body,
                    path: c.path,
                    line: c.line,
                    created_at: c.created_at,
                    review_id: c.pull_request_review_id,
                })
            })
            .collect();

        assert_eq!(comments.len(), 1);
        assert_eq!(comments[0].id, 42);
        assert_eq!(comments[0].author, "reviewer");
        assert_eq!(comments[0].review_id, Some(999));
    }

    #[test]
    fn deserialize_api_reviews() {
        let json = r#"[
            {
                "id": 999,
                "user": {"login": "reviewer"},
                "body": "LGTM!",
                "state": "APPROVED",
                "submitted_at": "2024-01-15T10:30:00Z"
            },
            {
                "id": 1000,
                "user": {"login": "reviewer2"},
                "body": null,
                "state": "CHANGES_REQUESTED",
                "submitted_at": "2024-01-15T11:00:00Z"
            },
            {
                "id": 1001,
                "user": {"login": "reviewer3"},
                "body": "",
                "state": "PENDING",
                "submitted_at": null
            }
        ]"#;

        let reviews: Vec<GhApiReview> = serde_json::from_str(json).unwrap();
        assert_eq!(reviews.len(), 3);

        assert_eq!(reviews[0].id, 999);
        assert_eq!(reviews[0].user.as_ref().unwrap().login, "reviewer");
        assert_eq!(reviews[0].body, Some("LGTM!".to_string()));
        assert_eq!(reviews[0].state, "APPROVED");
        assert_eq!(
            reviews[0].submitted_at,
            Some("2024-01-15T10:30:00Z".to_string())
        );

        assert_eq!(reviews[1].id, 1000);
        assert_eq!(reviews[1].body, None);
        assert_eq!(reviews[1].state, "CHANGES_REQUESTED");

        assert_eq!(reviews[2].id, 1001);
        assert_eq!(reviews[2].body, Some(String::new()));
        assert_eq!(reviews[2].state, "PENDING");
        assert_eq!(reviews[2].submitted_at, None);
    }

    #[test]
    fn parse_pr_url_valid() {
        let result = parse_pr_url("https://github.com/owner/repo/pull/123");
        assert_eq!(result, Some(("owner", "repo", "123")));
    }

    #[test]
    fn parse_pr_url_invalid() {
        assert!(parse_pr_url("https://github.com/owner/repo").is_none());
        assert!(parse_pr_url("https://gitlab.com/owner/repo/pull/123").is_none());
        assert!(parse_pr_url("not a url").is_none());
    }
}
