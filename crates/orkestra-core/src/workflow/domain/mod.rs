//! Domain types for workflow tasks.
//!
//! These types represent the runtime state of tasks in the workflow system.
//! They use the stage-agnostic primitives from `workflow::runtime`.

pub(crate) mod task_view;

// Re-export all domain types from orkestra-types
pub use orkestra_types::domain::*;

pub use task_view::{
    DerivedTaskState, PendingRejection, SessionLogInfo, StageLogInfo, SubtaskProgress, TaskView,
};

// ============================================================================
// Log Notification
// ============================================================================

/// Lightweight notification that a log entry was appended.
///
/// Carries only identifiers — no log content. Consumers use these identifiers
/// to trigger a cursor-based fetch for the actual new entries.
#[derive(Debug, Clone)]
pub struct LogNotification {
    /// ID of the task whose log was updated.
    pub task_id: String,
    /// ID of the stage session that received the new entry.
    pub session_id: String,
}
