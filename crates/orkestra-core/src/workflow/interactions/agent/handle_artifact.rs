//! Handle artifact output: store artifact, auto-approve or await review.

use crate::workflow::config::WorkflowConfig;
use crate::workflow::domain::Task;
use crate::workflow::interactions::stage;
use crate::workflow::ports::WorkflowResult;
use crate::workflow::runtime::Artifact;
use crate::workflow::services::IterationService;

pub fn execute(
    workflow: &WorkflowConfig,
    iteration_service: &IterationService,
    task: &mut Task,
    content: &str,
    stage_name: &str,
    now: &str,
) -> WorkflowResult<()> {
    let artifact_name =
        stage::finalize_advancement::artifact_name_for_stage(workflow, stage_name, "artifact");
    task.artifacts
        .set(Artifact::new(&artifact_name, content, stage_name, now));
    stage::auto_advance_or_review::execute(iteration_service, workflow, task, stage_name, now)
}
