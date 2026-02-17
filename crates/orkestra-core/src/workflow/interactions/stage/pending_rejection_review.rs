//! Check if the latest iteration has a pending rejection awaiting human review.

use crate::workflow::ports::{WorkflowResult, WorkflowStore};
use crate::workflow::runtime::Outcome;

/// Returns `Some((from_stage, target, feedback))` if a pending rejection review is found.
pub fn execute(
    store: &dyn WorkflowStore,
    task_id: &str,
    current_stage: &str,
) -> WorkflowResult<Option<(String, String, String)>> {
    let latest = store.get_latest_iteration(task_id, current_stage)?;

    if let Some(iter) = latest {
        if let Some(Outcome::AwaitingRejectionReview {
            from_stage,
            target,
            feedback,
        }) = &iter.outcome
        {
            return Ok(Some((from_stage.clone(), target.clone(), feedback.clone())));
        }
    }

    Ok(None)
}
