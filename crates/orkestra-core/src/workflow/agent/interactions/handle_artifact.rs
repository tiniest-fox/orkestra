//! Handle artifact output: store artifact, check gate, auto-approve or await review.

use crate::workflow::config::{GateConfig, WorkflowConfig};
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
) -> WorkflowResult<Option<String>> {
    let artifact_name = stage::finalize_advancement::artifact_name_for_stage(
        workflow, &task.flow, stage_name, "artifact",
    );
    task.artifacts
        .set(Artifact::new(&artifact_name, content, stage_name, now));

    // If the stage has an automated (script) gate, transition to AwaitingGate so the
    // orchestrator can spawn and track the script. Agentic gates fall through to
    // auto_advance_or_review, which sets AwaitingApproval for human confirmation.
    if workflow
        .stage(&task.flow, stage_name)
        .and_then(|s| s.gate.as_ref())
        .is_some_and(|g| matches!(g, GateConfig::Automated { .. }))
    {
        task.state = TaskState::awaiting_gate(stage_name);
        task.updated_at = now.to_string();
        return Ok(Some(artifact_name));
    }

    stage::auto_advance_or_review::execute(iteration_service, workflow, task, stage_name, now)?;
    Ok(Some(artifact_name))
}
