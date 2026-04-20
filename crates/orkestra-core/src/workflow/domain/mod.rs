//! Domain types for workflow tasks.
//!
//! These types represent the runtime state of tasks in the workflow system.
//! They use the stage-agnostic primitives from `workflow::runtime`.

pub(crate) mod task_view;

// Re-export all domain types from orkestra-types
pub use orkestra_types::domain::*;

pub use task_view::{
    DerivedTaskState, DifferentialTaskResponse, PendingRejection, SessionLogInfo, StageLogInfo,
    SubtaskProgress, TaskView,
};

// ============================================================================
// Log Notification
// ============================================================================

/// Lightweight notification that a log entry was appended.
///
/// Carries identifiers plus a human-readable summary of the last summarizable
/// entry in the batch. Consumers can display the summary immediately and use
/// the identifiers to fetch the full entry content via a cursor-based fetch.
#[derive(Debug, Clone)]
pub struct LogNotification {
    /// ID of the task whose log was updated.
    pub task_id: String,
    /// ID of the stage session that received the new entry.
    pub session_id: String,
    /// Human-readable summary of the last log entry in the batch.
    /// None if no entry in the batch was summarizable.
    pub last_entry_summary: Option<String>,
    /// When true, the stage completed from chat — listeners should also emit `task_updated`.
    pub stage_completed: bool,
}
