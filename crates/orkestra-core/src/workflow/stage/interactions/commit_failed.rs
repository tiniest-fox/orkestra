//! Record a failed commit and mark the task as failed.

use crate::workflow::domain::Task;
use crate::workflow::iteration::IterationService;
use crate::workflow::ports::{WorkflowError, WorkflowResult, WorkflowStore};
use crate::workflow::runtime::{Outcome, Phase, Status};

/// Record a commit failure, create a `CommitFailed` iteration, and mark the task as failed.
pub fn execute(
    store: &dyn WorkflowStore,
    iteration_service: &IterationService,
    task_id: &str,
    error: &str,
) -> WorkflowResult<Task> {
    let mut task = store
        .get_task(task_id)?
        .ok_or_else(|| WorkflowError::TaskNotFound(task_id.into()))?;

    if task.phase != Phase::Committing {
        return Err(WorkflowError::InvalidTransition(format!(
            "Cannot mark commit failed in phase {:?} (expected Committing)",
            task.phase
        )));
    }

    // Read current stage BEFORE changing status (stage is lost after Status::failed)
    let stage_name = task.current_stage().map(String::from);

    // Record failure via iteration (create + end, matching integration_failed pattern)
    if let Some(ref stage_name) = stage_name {
        iteration_service.create_iteration(task_id, stage_name, None)?;
        iteration_service.end_iteration(
            task_id,
            stage_name,
            Outcome::CommitFailed {
                error: error.to_string(),
            },
        )?;
    }

    task.status = Status::failed(error);
    task.phase = Phase::Idle;
    task.updated_at = chrono::Utc::now().to_rfc3339();
    store.save_task(&task)?;
    Ok(task)
}
