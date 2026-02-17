//! End current iteration with Approved and enter the commit pipeline.

use crate::workflow::domain::Task;
use crate::workflow::iteration::IterationService;
use crate::workflow::ports::WorkflowResult;
use crate::workflow::runtime::{Outcome, TaskState};

pub fn execute(
    iteration_service: &IterationService,
    task: &mut Task,
    now: &str,
) -> WorkflowResult<()> {
    let stage = task.current_stage().unwrap_or("unknown").to_string();
    super::end_iteration::execute(iteration_service, task, Outcome::Approved)?;
    task.state = TaskState::finishing(stage);
    task.updated_at = now.to_string();
    Ok(())
}
