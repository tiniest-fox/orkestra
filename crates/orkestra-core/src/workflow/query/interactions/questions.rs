//! Query pending questions for a task.

use crate::workflow::domain::Question;
use crate::workflow::ports::{WorkflowError, WorkflowResult, WorkflowStore};
use crate::workflow::runtime::Outcome;

/// Get pending questions from the latest iteration's outcome.
pub fn get_pending(store: &dyn WorkflowStore, task_id: &str) -> WorkflowResult<Vec<Question>> {
    let task = store
        .get_task(task_id)?
        .ok_or_else(|| WorkflowError::TaskNotFound(task_id.into()))?;

    if let Some(stage) = task.current_stage() {
        if let Some(iter) = store.get_latest_iteration(task_id, stage)? {
            if let Some(Outcome::AwaitingAnswers { questions, .. }) = &iter.outcome {
                return Ok(questions.clone());
            }
        }
    }

    Ok(vec![])
}

/// Check if a task has pending questions.
pub fn has_pending(store: &dyn WorkflowStore, task_id: &str) -> WorkflowResult<bool> {
    let questions = get_pending(store, task_id)?;
    Ok(!questions.is_empty())
}
