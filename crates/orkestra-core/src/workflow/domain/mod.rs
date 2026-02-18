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
