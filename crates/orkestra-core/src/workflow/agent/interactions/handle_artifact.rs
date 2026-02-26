//! Handle artifact output: store artifact, check gate, auto-approve or await review.

use crate::workflow::config::WorkflowConfig;
use crate::workflow::domain::Task;
use crate::workflow::iteration::IterationService;
use crate::workflow::ports::WorkflowResult;
use crate::workflow::runtime::{Artifact, TaskState};
use crate::workflow::stage::interactions as stage;

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

    // If the stage has a gate configured, transition to AwaitingGate instead of
    // entering the commit pipeline or awaiting review. The orchestrator will spawn
    // the gate script and handle the pass/fail outcome.
    if workflow
        .effective_gate_config(stage_name, task.flow.as_deref())
        .is_some()
    {
        task.state = TaskState::awaiting_gate(stage_name);
        task.updated_at = now.to_string();
        return Ok(());
    }

    stage::auto_advance_or_review::execute(iteration_service, workflow, task, stage_name, now)
}
