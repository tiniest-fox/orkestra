//! Read-only query commands.

use crate::{error::TauriError, project_registry::ProjectRegistry};
use chrono::Utc;
use orkestra_core::workflow::{
    Artifact, AutoTaskTemplate, Iteration, LogEntry, Question, WorkflowConfig,
};
use serde::{Deserialize, Serialize};
use std::process::Command;
use tauri::{State, Window};

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
        let api = state.api()?;

        let Some(git) = api.git_service() else {
            return Ok(BranchList {
                branches: vec![],
                current: None,
                latest_commit_message: None,
            });
        };

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

/// Get stages that have logs for a task.
///
/// Returns the names of stages that have log entries in the database.
/// Used by the UI to show tabs for each stage that has been executed.
#[tauri::command]
pub fn workflow_get_stages_with_logs(
    registry: State<ProjectRegistry>,
    window: Window,
    task_id: String,
) -> Result<Vec<String>, TauriError> {
    registry.with_project(window.label(), |state| {
        state
            .api()?
            .get_stages_with_logs(&task_id)
            .map_err(Into::into)
    })
}

/// Get log entries for a task's stage.
///
/// Reads log entries from the database for the task's current (or specified)
/// stage session.
///
/// # Arguments
/// * `task_id` - The task ID
/// * `stage` - Optional stage name. If None, uses the task's current stage.
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
) -> Result<Vec<LogEntry>, TauriError> {
    registry.with_project(window.label(), |state| {
        state
            .api()?
            .get_task_logs(&task_id, stage.as_deref())
            .map_err(Into::into)
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
}

/// A single review status.
#[derive(Serialize)]
pub struct PrReview {
    /// GitHub username of the reviewer.
    pub author: String,
    /// Review state: "APPROVED", "`CHANGES_REQUESTED`", "COMMENTED", or "PENDING".
    pub state: String,
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
}

/// Raw JSON response from `gh pr view --json`.
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct GhPrResponse {
    url: String,
    state: String,
    #[serde(default)]
    status_check_rollup: Vec<GhStatusCheck>,
    #[serde(default)]
    reviews: Vec<GhReview>,
    #[serde(default)]
    review_comments: Vec<GhComment>,
}

#[derive(Deserialize)]
struct GhStatusCheck {
    name: String,
    status: Option<String>,
    conclusion: Option<String>,
}

#[derive(Deserialize)]
struct GhReview {
    author: GhAuthor,
    state: String,
}

#[derive(Deserialize)]
struct GhAuthor {
    login: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct GhComment {
    #[serde(default)]
    database_id: Option<i64>,
    author: Option<GhAuthor>,
    body: String,
    path: Option<String>,
    #[serde(default)]
    line: Option<u32>,
    created_at: String,
}

/// Convert GitHub's PR state to our normalized format.
fn normalize_pr_state(state: &str) -> &'static str {
    match state.to_uppercase().as_str() {
        "MERGED" => "merged",
        "CLOSED" => "closed",
        _ => "open", // OPEN or unknown states default to open
    }
}

/// Convert GitHub's check status to our normalized format.
fn normalize_check_status(status: Option<&str>, conclusion: Option<&str>) -> &'static str {
    match status.map(str::to_uppercase).as_deref() {
        Some("COMPLETED") => match conclusion.map(str::to_uppercase).as_deref() {
            Some("SUCCESS") => "success",
            Some("FAILURE" | "TIMED_OUT" | "CANCELLED" | "ACTION_REQUIRED") => "failure",
            Some("SKIPPED" | "NEUTRAL") => "skipped",
            _ => "pending",
        },
        Some("SKIPPED") => "skipped",
        _ => "pending", // QUEUED, IN_PROGRESS, WAITING, PENDING, REQUESTED, None, or unknown
    }
}

/// Get PR status from GitHub.
///
/// Calls `gh pr view` to fetch the current state of a pull request,
/// including CI checks and review status.
///
/// # Arguments
/// * `pr_url` - The full GitHub PR URL (e.g., `https://github.com/owner/repo/pull/123`)
///
/// # Returns
/// `PrStatus` with state, checks, and reviews.
///
/// # Errors
/// Returns error if `gh` CLI is not installed or the PR URL is invalid.
#[tauri::command]
pub fn workflow_get_pr_status(pr_url: String) -> Result<PrStatus, TauriError> {
    let output = Command::new("gh")
        .args([
            "pr",
            "view",
            &pr_url,
            "--json",
            "state,statusCheckRollup,reviews,url,reviewComments",
        ])
        .output()
        .map_err(|e| {
            if e.kind() == std::io::ErrorKind::NotFound {
                TauriError::new(
                    "GH_CLI_NOT_FOUND",
                    "GitHub CLI (gh) is not installed or not in PATH",
                )
            } else {
                TauriError::new("GH_CLI_ERROR", format!("Failed to run gh pr view: {e}"))
            }
        })?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        return Err(TauriError::new(
            "GH_CLI_ERROR",
            format!("gh pr view failed: {stderr}"),
        ));
    }

    let stdout = String::from_utf8_lossy(&output.stdout);
    let response: GhPrResponse = serde_json::from_str(&stdout).map_err(|e| {
        TauriError::new(
            "GH_PARSE_ERROR",
            format!("Failed to parse gh output: {e}\nRaw output: {stdout}"),
        )
    })?;

    let checks: Vec<PrCheck> = response
        .status_check_rollup
        .iter()
        .map(|check| PrCheck {
            name: check.name.clone(),
            status: normalize_check_status(check.status.as_deref(), check.conclusion.as_deref())
                .to_string(),
            conclusion: check.conclusion.clone(),
        })
        .collect();

    let reviews: Vec<PrReview> = response
        .reviews
        .iter()
        .map(|review| PrReview {
            author: review.author.login.clone(),
            state: review.state.clone(),
        })
        .collect();

    let comments: Vec<PrComment> = response
        .review_comments
        .iter()
        .filter_map(|c| {
            Some(PrComment {
                id: c.database_id?,
                author: c.author.as_ref()?.login.clone(),
                body: c.body.clone(),
                path: c.path.clone(),
                line: c.line,
                created_at: c.created_at.clone(),
            })
        })
        .collect();

    Ok(PrStatus {
        url: response.url,
        state: normalize_pr_state(&response.state).to_string(),
        checks,
        reviews,
        comments,
        fetched_at: Utc::now().to_rfc3339(),
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
    fn normalize_check_status_handles_completed_success() {
        assert_eq!(
            normalize_check_status(Some("COMPLETED"), Some("SUCCESS")),
            "success"
        );
        assert_eq!(
            normalize_check_status(Some("completed"), Some("success")),
            "success"
        );
    }

    #[test]
    fn normalize_check_status_handles_completed_failure() {
        assert_eq!(
            normalize_check_status(Some("COMPLETED"), Some("FAILURE")),
            "failure"
        );
        assert_eq!(
            normalize_check_status(Some("COMPLETED"), Some("TIMED_OUT")),
            "failure"
        );
        assert_eq!(
            normalize_check_status(Some("COMPLETED"), Some("CANCELLED")),
            "failure"
        );
        assert_eq!(
            normalize_check_status(Some("COMPLETED"), Some("ACTION_REQUIRED")),
            "failure"
        );
    }

    #[test]
    fn normalize_check_status_handles_skipped() {
        assert_eq!(
            normalize_check_status(Some("COMPLETED"), Some("SKIPPED")),
            "skipped"
        );
        assert_eq!(
            normalize_check_status(Some("COMPLETED"), Some("NEUTRAL")),
            "skipped"
        );
        assert_eq!(normalize_check_status(Some("SKIPPED"), None), "skipped");
    }

    #[test]
    fn normalize_check_status_handles_pending_states() {
        assert_eq!(normalize_check_status(Some("QUEUED"), None), "pending");
        assert_eq!(normalize_check_status(Some("IN_PROGRESS"), None), "pending");
        assert_eq!(normalize_check_status(Some("WAITING"), None), "pending");
        assert_eq!(normalize_check_status(Some("PENDING"), None), "pending");
        assert_eq!(normalize_check_status(Some("REQUESTED"), None), "pending");
        assert_eq!(normalize_check_status(None, None), "pending");
    }

    #[test]
    fn normalize_check_status_handles_completed_with_unknown_conclusion() {
        assert_eq!(
            normalize_check_status(Some("COMPLETED"), Some("UNKNOWN")),
            "pending"
        );
        assert_eq!(normalize_check_status(Some("COMPLETED"), None), "pending");
    }

    #[test]
    fn deserialize_gh_response_with_comments() {
        let json = r#"{
            "url": "https://github.com/owner/repo/pull/123",
            "state": "OPEN",
            "statusCheckRollup": [],
            "reviews": [],
            "reviewComments": [
                {
                    "databaseId": 42,
                    "author": {"login": "reviewer"},
                    "body": "Please fix this",
                    "path": "src/main.rs",
                    "line": 10,
                    "createdAt": "2024-01-15T10:30:00Z"
                },
                {
                    "databaseId": 43,
                    "author": {"login": "reviewer2"},
                    "body": "General comment",
                    "path": null,
                    "line": null,
                    "createdAt": "2024-01-15T11:00:00Z"
                }
            ]
        }"#;

        let response: GhPrResponse = serde_json::from_str(json).unwrap();
        assert_eq!(response.review_comments.len(), 2);

        let first = &response.review_comments[0];
        assert_eq!(first.database_id, Some(42));
        assert_eq!(first.author.as_ref().unwrap().login, "reviewer");
        assert_eq!(first.body, "Please fix this");
        assert_eq!(first.path, Some("src/main.rs".to_string()));
        assert_eq!(first.line, Some(10));
        assert_eq!(first.created_at, "2024-01-15T10:30:00Z");

        let second = &response.review_comments[1];
        assert_eq!(second.path, None);
        assert_eq!(second.line, None);
    }

    #[test]
    fn deserialize_gh_response_with_empty_comments() {
        let json = r#"{
            "url": "https://github.com/owner/repo/pull/123",
            "state": "OPEN",
            "statusCheckRollup": [],
            "reviews": []
        }"#;

        let response: GhPrResponse = serde_json::from_str(json).unwrap();
        assert!(response.review_comments.is_empty());
    }

    #[test]
    fn comments_filter_out_incomplete_data() {
        let json = r#"{
            "url": "https://github.com/owner/repo/pull/123",
            "state": "OPEN",
            "statusCheckRollup": [],
            "reviews": [],
            "reviewComments": [
                {
                    "databaseId": 42,
                    "author": {"login": "reviewer"},
                    "body": "Valid comment",
                    "path": "src/main.rs",
                    "line": 10,
                    "createdAt": "2024-01-15T10:30:00Z"
                },
                {
                    "databaseId": null,
                    "author": {"login": "reviewer"},
                    "body": "Missing ID",
                    "path": null,
                    "line": null,
                    "createdAt": "2024-01-15T10:30:00Z"
                },
                {
                    "databaseId": 44,
                    "author": null,
                    "body": "Missing author",
                    "path": null,
                    "line": null,
                    "createdAt": "2024-01-15T10:30:00Z"
                }
            ]
        }"#;

        let response: GhPrResponse = serde_json::from_str(json).unwrap();
        assert_eq!(response.review_comments.len(), 3);

        // Map comments using the same filter_map logic as the command
        let comments: Vec<PrComment> = response
            .review_comments
            .iter()
            .filter_map(|c| {
                Some(PrComment {
                    id: c.database_id?,
                    author: c.author.as_ref()?.login.clone(),
                    body: c.body.clone(),
                    path: c.path.clone(),
                    line: c.line,
                    created_at: c.created_at.clone(),
                })
            })
            .collect();

        // Only the valid comment should remain
        assert_eq!(comments.len(), 1);
        assert_eq!(comments[0].id, 42);
        assert_eq!(comments[0].author, "reviewer");
    }
}
