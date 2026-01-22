use thiserror::Error;

/// Orkestra error types providing meaningful error messages for UI and debugging.
#[derive(Error, Debug)]
pub enum OrkestraError {
    #[error("Task not found: {0}")]
    TaskNotFound(String),

    #[error("Invalid status transition: {from} -> {to}")]
    InvalidTransition { from: String, to: String },

    #[error("Task not in expected state: expected {expected}, got {actual}")]
    InvalidState { expected: String, actual: String },

    #[error("Agent definition not found: {0}")]
    AgentNotFound(String),

    #[error("Session not found: {0}")]
    SessionNotFound(String),

    #[error("Process error: {0}")]
    ProcessError(String),

    #[error("Project root not found")]
    ProjectNotFound,

    #[error("IO error: {0}")]
    Io(#[from] std::io::Error),

    #[error("JSON error: {0}")]
    Json(#[from] serde_json::Error),
}

/// Result type alias for Orkestra operations.
pub type Result<T> = std::result::Result<T, OrkestraError>;
