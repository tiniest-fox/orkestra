//! Record `ProposedExit` output: validate destination, store it, and await approval.

use crate::workflow::config::WorkflowConfig;
use crate::workflow::domain::Task;
use crate::workflow::iteration::IterationService;
use crate::workflow::ports::{WorkflowError, WorkflowResult};
use crate::workflow::runtime::Artifact;
use crate::workflow::stage::interactions as stage;

#[allow(clippy::too_many_arguments)]
pub fn execute(
    workflow: &WorkflowConfig,
    iteration_service: &IterationService,
    task: &mut Task,
    destination: &str,
    _rationale: &str,
    content: Option<&str>,
    current_stage: &str,
    now: &str,
) -> WorkflowResult<Option<String>> {
    // Validate vibe_origin is present
    if task.vibe_origin.is_none() {
        return Err(WorkflowError::InvalidState(
            "ProposedExit received but task is not in vibe mode".into(),
        ));
    }

    // Validate destination: must be a stage name in the origin flow, or "done"
    let valid_destinations = workflow.vibe_valid_destinations(task);
    if !valid_destinations.iter().any(|d| d == destination) {
        return Err(WorkflowError::InvalidTransition(format!(
            "Invalid vibe destination: {destination}"
        )));
    }

    // Store proposed destination
    if let Some(ref mut origin) = task.vibe_origin {
        origin.proposed_destination = Some(destination.to_string());
    }

    // Optionally store content as an artifact
    let artifact_name = if let Some(content) = content {
        let name = "vibe".to_string();
        task.artifacts
            .set(Artifact::new(&name, content, current_stage, now));
        Some(name)
    } else {
        None
    };

    // Pause for human approval (auto_advance_or_review transitions to AwaitingApproval)
    stage::auto_advance_or_review::execute(iteration_service, workflow, task, current_stage, now)?;

    Ok(artifact_name)
}
