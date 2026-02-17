//! End current iteration with Approved and enter the commit pipeline.

use crate::workflow::domain::Task;
use crate::workflow::ports::WorkflowResult;
use crate::workflow::runtime::{Outcome, Phase};
use crate::workflow::services::IterationService;

pub fn execute(
    iteration_service: &IterationService,
    task: &mut Task,
    now: &str,
) -> WorkflowResult<()> {
    super::end_iteration::execute(iteration_service, task, Outcome::Approved)?;
    task.phase = Phase::Finishing;
    task.updated_at = now.to_string();
    Ok(())
}
