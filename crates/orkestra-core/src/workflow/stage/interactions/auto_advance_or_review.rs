//! Auto-approve and advance if the stage/task allows it, otherwise pause for review.

use crate::workflow::config::WorkflowConfig;
use crate::workflow::domain::Task;
use crate::workflow::iteration::IterationService;
use crate::workflow::ports::WorkflowResult;
use crate::workflow::runtime::Phase;

pub fn execute(
    iteration_service: &IterationService,
    workflow: &WorkflowConfig,
    task: &mut Task,
    stage: &str,
    now: &str,
) -> WorkflowResult<()> {
    if should_auto_advance(task, stage, workflow) {
        super::enter_commit_pipeline::execute(iteration_service, task, now)?;
    } else {
        task.phase = Phase::AwaitingReview;
        task.updated_at = now.to_string();
    }
    Ok(())
}

// -- Helpers --

fn should_auto_advance(task: &Task, stage: &str, workflow: &WorkflowConfig) -> bool {
    task.auto_mode || workflow.stage(stage).is_some_and(|s| s.is_automated)
}
