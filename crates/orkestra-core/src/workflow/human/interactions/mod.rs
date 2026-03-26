//! Human-triggered action interactions.
//!
//! Each interaction validates preconditions, executes the action,
//! and saves the result. Called by thin `WorkflowApi` dispatchers.

pub mod address_pr_conflicts;
pub mod address_pr_feedback;
pub mod answer_questions;
pub mod approve;
pub mod archive;
pub mod enter_interactive;
pub mod exit_interactive;
pub mod interrupt;
pub mod reject;
pub mod reject_with_comments;
pub mod request_update;
pub mod restart_stage;
pub mod resume;
pub mod retry;
pub mod return_to_work;
pub mod send_to_stage;
pub mod set_auto_mode;
pub mod skip_stage;

use crate::workflow::config::WorkflowConfig;
use crate::workflow::domain::Task;
use crate::workflow::ports::{WorkflowResult, WorkflowStore};

/// Resolve the current stage name for a task, handling old data without a stage.
///
/// Returns `task.current_stage()` if set. Otherwise falls back to the last
/// iteration's stage, then to the first stage in the task's flow.
pub(super) fn resolve_current_stage(
    task: &Task,
    store: &dyn WorkflowStore,
    workflow: &WorkflowConfig,
) -> WorkflowResult<String> {
    if let Some(s) = task.current_stage() {
        return Ok(s.to_string());
    }
    // Fallback for Failed/Blocked without stage (old data)
    let iterations = store.get_iterations(&task.id)?;
    Ok(iterations.last().map_or_else(
        || {
            workflow
                .first_stage_in_flow(task.flow.as_deref())
                .map_or_else(|| "planning".to_string(), |s| s.name.clone())
        },
        |i| i.stage.clone(),
    ))
}
