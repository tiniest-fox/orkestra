//! Mark an iteration's trigger as delivered to the agent.

use crate::orkestra_debug;
use crate::workflow::ports::{WorkflowResult, WorkflowStore};

/// Mark the iteration's trigger as delivered to the agent.
///
/// Called after a successful resume spawn so that if the agent crashes again,
/// the next resume uses "Your session was interrupted" instead of replaying
/// the original trigger (e.g., script failure details the agent already received).
pub(crate) fn execute(store: &dyn WorkflowStore, task_id: &str, stage: &str) -> WorkflowResult<()> {
    if let Some(mut iter) = store.get_active_iteration(task_id, stage)? {
        if !iter.trigger_delivered && iter.incoming_context.is_some() {
            orkestra_debug!(
                "session",
                "mark_trigger_delivered {}/{}: marking trigger as delivered",
                task_id,
                stage
            );
            iter.trigger_delivered = true;
            store.save_iteration(&iter)?;
        }
    }
    Ok(())
}
