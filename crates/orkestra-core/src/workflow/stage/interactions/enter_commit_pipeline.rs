//! End current iteration with Approved and enter the commit pipeline.

use crate::workflow::domain::Task;
use crate::workflow::iteration::IterationService;
use crate::workflow::ports::{WorkflowError, WorkflowResult};
use crate::workflow::runtime::{Outcome, TaskState};

pub fn execute(
    iteration_service: &IterationService,
    task: &mut Task,
    now: &str,
) -> WorkflowResult<()> {
    // Vibe tasks must have a proposed_destination set before entering the commit pipeline.
    // Without it, finalize_advancement takes the vibe branch and fails permanently, leaving
    // the task stuck in Committed with no recovery. This guard protects all callers at once.
    if task
        .vibe_origin
        .as_ref()
        .is_some_and(|o| o.proposed_destination.is_none())
    {
        return Err(WorkflowError::InvalidTransition(
            "Cannot enter commit pipeline for a vibe task without a proposed destination; use confirm-vibe-exit with a destination"
                .into(),
        ));
    }

    let stage = task.current_stage().unwrap_or("unknown").to_string();
    super::end_iteration::execute(iteration_service, task, Outcome::Approved)?;
    task.state = TaskState::finishing(stage);
    task.updated_at = now.to_string();
    Ok(())
}
