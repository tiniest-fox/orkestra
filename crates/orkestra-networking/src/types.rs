//! WebSocket protocol types for client-server communication.

use orkestra_core::workflow::WorkflowError;
use serde::{Deserialize, Serialize};

// ============================================================================
// Auth Types
// ============================================================================

/// Error type for authentication and device pairing operations.
#[derive(Debug)]
pub enum AuthError {
    /// The provided token is invalid, expired, or revoked.
    InvalidToken,
    /// The pairing code is invalid, expired, or already claimed.
    InvalidCode,
    /// A database operation failed.
    Storage(String),
    /// A lock could not be acquired.
    Lock,
}

impl std::fmt::Display for AuthError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            AuthError::InvalidToken => write!(f, "Invalid or revoked token"),
            AuthError::InvalidCode => {
                write!(f, "Invalid, expired, or already claimed pairing code")
            }
            AuthError::Storage(msg) => write!(f, "Storage error: {msg}"),
            AuthError::Lock => write!(f, "Failed to acquire database lock"),
        }
    }
}

/// Information about a paired device.
#[derive(Debug, Clone, Serialize)]
pub struct PairedDevice {
    /// Unique device identifier.
    pub id: String,
    /// Human-readable device name.
    pub device_name: String,
    /// ISO 8601 timestamp when the device was first paired.
    pub created_at: String,
    /// ISO 8601 timestamp of the most recent connection, if any.
    pub last_used_at: Option<String>,
}

// ============================================================================
// PR Status Types
// ============================================================================

/// PR status information from GitHub.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "snake_case")]
pub struct PrStatus {
    pub url: String,
    pub state: String,
    pub checks: Vec<PrCheck>,
    pub reviews: Vec<PrReview>,
    pub comments: Vec<PrComment>,
    pub fetched_at: String,
    pub mergeable: Option<bool>,
    pub merge_state_status: Option<String>,
}

/// A single CI/CD check status.
#[derive(Debug, Clone, Serialize)]
pub struct PrCheck {
    pub name: String,
    pub status: String,
    pub conclusion: Option<String>,
    pub id: Option<i64>,
    pub summary: Option<String>,
}

/// A single review status.
#[derive(Debug, Clone, Serialize)]
pub struct PrReview {
    pub id: i64,
    pub author: String,
    pub state: String,
    pub body: Option<String>,
    pub submitted_at: String,
}

/// A single PR review comment.
#[derive(Debug, Clone, Serialize)]
pub struct PrComment {
    pub id: i64,
    pub author: String,
    pub body: String,
    pub path: Option<String>,
    pub line: Option<u32>,
    pub created_at: String,
    pub review_id: Option<i64>,
    pub outdated: bool,
}

// ============================================================================
// Request / Response
// ============================================================================

/// A request from the client to the server.
#[derive(Debug, Clone, Deserialize)]
pub struct Request {
    /// Correlation ID echoed back in the response.
    pub id: String,
    /// Method name (e.g. `"list_tasks"`, `"approve"`).
    pub method: String,
    /// Method-specific parameters.
    pub params: serde_json::Value,
}

/// A successful response from the server to the client.
#[derive(Debug, Clone, Serialize)]
pub struct Response {
    /// Correlation ID from the originating request.
    pub id: String,
    /// Method result payload.
    pub result: serde_json::Value,
}

/// An error response from the server to the client.
#[derive(Debug, Clone, Serialize)]
pub struct ErrorResponse {
    /// Correlation ID from the originating request.
    pub id: String,
    /// Structured error information.
    pub error: ErrorPayload,
}

// ============================================================================
// Error Payload
// ============================================================================

/// Structured error returned in an `ErrorResponse`.
#[derive(Debug, Clone, Serialize)]
pub struct ErrorPayload {
    /// Machine-readable error code (e.g. `"TASK_NOT_FOUND"`).
    pub code: String,
    /// Human-readable explanation.
    pub message: String,
}

impl ErrorPayload {
    /// Create an `ErrorPayload` with the given code and message.
    pub fn new(code: impl Into<String>, message: impl Into<String>) -> Self {
        Self {
            code: code.into(),
            message: message.into(),
        }
    }

    /// Method not found error.
    pub fn method_not_found(method: &str) -> Self {
        Self::new("METHOD_NOT_FOUND", format!("Unknown method: {method}"))
    }

    /// Lock acquisition failure.
    pub fn lock_error() -> Self {
        Self::new("LOCK_ERROR", "Failed to acquire API lock")
    }

    /// Internal / unexpected error.
    pub fn internal(message: impl Into<String>) -> Self {
        Self::new("INTERNAL_ERROR", message)
    }

    /// Invalid parameters supplied by the client.
    pub fn invalid_params(message: impl Into<String>) -> Self {
        Self::new("INVALID_PARAMS", message)
    }
}

impl From<WorkflowError> for ErrorPayload {
    fn from(e: WorkflowError) -> Self {
        match e {
            WorkflowError::TaskNotFound(id) => {
                Self::new("TASK_NOT_FOUND", format!("Task not found: {id}"))
            }
            WorkflowError::IterationNotFound(id) => {
                Self::new("ITERATION_NOT_FOUND", format!("Iteration not found: {id}"))
            }
            WorkflowError::InvalidTransition(msg) => Self::new("INVALID_TRANSITION", msg),
            WorkflowError::Storage(msg) => Self::new("STORAGE_ERROR", msg),
            WorkflowError::Lock => Self::new("LOCK_ERROR", "Failed to acquire lock"),
            WorkflowError::StageSessionNotFound(id) => Self::new(
                "SESSION_NOT_FOUND",
                format!("Stage session not found: {id}"),
            ),
            WorkflowError::InvalidState(msg) => Self::new("INVALID_STATE", msg),
            WorkflowError::IntegrationFailed(msg) => Self::new("INTEGRATION_FAILED", msg),
            WorkflowError::GitError(msg) => Self::new("GIT_ERROR", msg),
        }
    }
}

// ============================================================================
// Events
// ============================================================================

/// A server-initiated event pushed to all connected clients.
#[derive(Debug, Clone, Serialize)]
pub struct Event {
    /// Event type (e.g. `"task_updated"`, `"review_ready"`, `"state_reset"`).
    pub event: String,
    /// Event-specific data payload.
    #[serde(rename = "data")]
    pub payload: serde_json::Value,
}

impl Event {
    /// Construct a new event with a serializable data payload.
    pub fn new(event: impl Into<String>, data: serde_json::Value) -> Self {
        Self {
            event: event.into(),
            payload: data,
        }
    }

    /// `task_updated` event carrying the affected task ID.
    pub fn task_updated(task_id: impl Into<String>) -> Self {
        Self::new(
            "task_updated",
            serde_json::json!({ "task_id": task_id.into() }),
        )
    }

    /// `review_ready` event indicating a task needs human review.
    pub fn review_ready(
        task_id: impl Into<String>,
        parent_id: Option<&str>,
        task_title: &str,
        stage: &str,
        output_type: &str,
    ) -> Self {
        let (notification_title, notification_body) =
            format_review_notification(task_title, stage, output_type);
        Self::new(
            "review_ready",
            serde_json::json!({
                "task_id": task_id.into(),
                "parent_id": parent_id,
                "task_title": task_title,
                "stage": stage,
                "output_type": output_type,
                "notification_title": notification_title,
                "notification_body": notification_body,
            }),
        )
    }

    /// `task_error` event carrying error details for notification.
    pub fn task_error(task_id: impl Into<String>, error: impl Into<String>) -> Self {
        let error = error.into();
        let (notification_title, notification_body) = format_error_notification(&error);
        Self::new(
            "task_error",
            serde_json::json!({
                "task_id": task_id.into(),
                "error": error,
                "notification_title": notification_title,
                "notification_body": notification_body,
            }),
        )
    }

    /// `merge_conflict` event carrying conflict details for notification.
    pub fn merge_conflict(task_id: impl Into<String>, conflict_count: usize) -> Self {
        let task_id = task_id.into();
        let (notification_title, notification_body) =
            format_conflict_notification(&task_id, conflict_count);
        Self::new(
            "merge_conflict",
            serde_json::json!({
                "task_id": task_id,
                "conflict_count": conflict_count,
                "notification_title": notification_title,
                "notification_body": notification_body,
            }),
        )
    }
}

// ============================================================================
// Notification Formatting
// ============================================================================

/// Format notification title and body for a review-ready event.
pub fn format_review_notification(
    task_title: &str,
    stage: &str,
    output_type: &str,
) -> (String, String) {
    match output_type {
        "questions" => (
            "Questions need answers".to_string(),
            format!("{task_title} — {stage} agent has questions"),
        ),
        "subtasks" => (
            "Subtasks need approval".to_string(),
            format!("{task_title} — review proposed subtask breakdown"),
        ),
        "approval" => (
            "Rejection needs review".to_string(),
            format!("{task_title} — reviewer rejected, needs your decision"),
        ),
        _ => (
            "Ready for review".to_string(),
            format!("{task_title} — {stage} stage output ready"),
        ),
    }
}

/// Format notification title and body for a task error event.
pub fn format_error_notification(error: &str) -> (String, String) {
    let body = truncate_at_char_boundary(error, 200);
    ("Task error".to_string(), body.to_string())
}

/// Format notification title and body for a merge conflict event.
pub fn format_conflict_notification(task_id: &str, conflict_count: usize) -> (String, String) {
    (
        "Merge conflict".to_string(),
        format!("{task_id} — {conflict_count} conflicting files"),
    )
}

/// Truncate a string to at most `max_bytes` bytes, landing on a valid UTF-8
/// char boundary. Returns the full string if it's already within the limit.
pub(crate) fn truncate_at_char_boundary(s: &str, max_bytes: usize) -> &str {
    if s.len() <= max_bytes {
        return s;
    }
    let mut end = max_bytes;
    while !s.is_char_boundary(end) {
        end -= 1;
    }
    &s[..end]
}
