//! Query iteration history and rejection feedback.

use crate::workflow::domain::Iteration;
use crate::workflow::ports::{WorkflowError, WorkflowResult, WorkflowStore};
use crate::workflow::runtime::Outcome;

/// Get all iterations for a task.
pub fn get_all(store: &dyn WorkflowStore, task_id: &str) -> WorkflowResult<Vec<Iteration>> {
    store.get_iterations(task_id)
}

/// Get the latest iteration for a specific stage.
pub fn get_latest(
    store: &dyn WorkflowStore,
    task_id: &str,
    stage: &str,
) -> WorkflowResult<Option<Iteration>> {
    store.get_latest_iteration(task_id, stage)
}

/// Get feedback from the last rejection or restart for the current stage.
///
/// Checks iterations in reverse order, returning:
/// - `Outcome::Rejected/Rejection.feedback` — set by reviewer agent rejection
/// - `IterationTrigger::Restart.message` — set by human restart (replaces old `reject()`)
pub fn get_rejection_feedback(
    store: &dyn WorkflowStore,
    task_id: &str,
) -> WorkflowResult<Option<String>> {
    use crate::workflow::domain::IterationTrigger;

    let task = store
        .get_task(task_id)?
        .ok_or_else(|| WorkflowError::TaskNotFound(task_id.into()))?;

    let Some(current_stage) = task.current_stage() else {
        return Ok(None);
    };

    let iterations = store.get_iterations_for_stage(task_id, current_stage)?;

    for iteration in iterations.into_iter().rev() {
        if let Some(Outcome::Rejected { feedback, .. } | Outcome::Rejection { feedback, .. }) =
            &iteration.outcome
        {
            return Ok(Some(feedback.clone()));
        }
        if let Some(IterationTrigger::Restart { message }) = &iteration.incoming_context {
            return Ok(Some(message.clone()));
        }
    }

    Ok(None)
}
