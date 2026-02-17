//! End the current active iteration with an outcome.

use crate::workflow::domain::Task;
use crate::workflow::iteration::IterationService;
use crate::workflow::ports::{WorkflowError, WorkflowResult};
use crate::workflow::runtime::Outcome;

pub fn execute(
    iteration_service: &IterationService,
    task: &Task,
    outcome: Outcome,
) -> WorkflowResult<()> {
    let current_stage = task
        .current_stage()
        .ok_or_else(|| WorkflowError::InvalidTransition("Task not in active stage".into()))?;

    iteration_service.end_iteration(&task.id, current_stage, outcome)
}
