//! Tauri error handling for workflow operations.
//!
//! # Error Codes
//!
//! The following error codes are returned to the frontend:
//!
//! | Code | Description |
//! |------|-------------|
//! | `TASK_NOT_FOUND` | The requested task ID does not exist |
//! | `ITERATION_NOT_FOUND` | The requested iteration ID does not exist |
//! | `INVALID_TRANSITION` | The requested action is not valid for the task's current state |
//! | `STORAGE_ERROR` | Database or persistence error |
//! | `LOCK_ERROR` | Failed to acquire internal lock (should rarely occur) |
//!
//! # Frontend Usage
//!
//! ```typescript
//! try {
//!   const task = await invoke('workflow_approve', { taskId: 'my-task' });
//! } catch (error) {
//!   const { code, message } = JSON.parse(error);
//!   if (code === 'INVALID_TRANSITION') {
//!     // Handle invalid state transition
//!   }
//! }
//! ```

use orkestra_core::workflow::WorkflowError;
use serde::Serialize;

/// Error type returned by Tauri commands.
///
/// Provides structured error information with a code and message
/// that can be handled by the frontend.
///
/// This type implements `Serialize` which allows Tauri to automatically
/// convert it to an `InvokeError` for returning from commands.
#[derive(Debug, Serialize)]
pub struct TauriError {
    /// Error code for programmatic handling (e.g., "TASK_NOT_FOUND")
    pub code: String,
    /// Human-readable error message
    pub message: String,
}

impl TauriError {
    /// Create a new TauriError with the given code and message.
    pub fn new(code: impl Into<String>, message: impl Into<String>) -> Self {
        Self {
            code: code.into(),
            message: message.into(),
        }
    }
}

impl From<WorkflowError> for TauriError {
    fn from(e: WorkflowError) -> Self {
        match e {
            WorkflowError::TaskNotFound(id) => TauriError {
                code: "TASK_NOT_FOUND".into(),
                message: format!("Task not found: {}", id),
            },
            WorkflowError::IterationNotFound(id) => TauriError {
                code: "ITERATION_NOT_FOUND".into(),
                message: format!("Iteration not found: {}", id),
            },
            WorkflowError::InvalidTransition(msg) => TauriError {
                code: "INVALID_TRANSITION".into(),
                message: msg,
            },
            WorkflowError::Storage(msg) => TauriError {
                code: "STORAGE_ERROR".into(),
                message: msg,
            },
            WorkflowError::Lock => TauriError {
                code: "LOCK_ERROR".into(),
                message: "Failed to acquire lock".into(),
            },
        }
    }
}

impl std::fmt::Display for TauriError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "[{}] {}", self.code, self.message)
    }
}

impl std::error::Error for TauriError {}
