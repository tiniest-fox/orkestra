//! Execute a rejection: transition task to the target stage with rejection context.

use crate::workflow::config::WorkflowConfig;
use crate::workflow::domain::{IterationTrigger, Task};
use crate::workflow::iteration::IterationService;
use crate::workflow::ports::{WorkflowError, WorkflowResult};
use crate::workflow::runtime::TaskState;

pub fn execute(
    iteration_service: &IterationService,
    task: &mut Task,
    from_stage: &str,
    target: &str,
    feedback: &str,
    now: &str,
) -> WorkflowResult<()> {
    task.state = TaskState::queued(target);
    task.updated_at = now.to_string();

    iteration_service.create_iteration(
        &task.id,
        target,
        Some(IterationTrigger::Rejection {
            from_stage: from_stage.to_string(),
            feedback: feedback.to_string(),
        }),
    )?;
    Ok(())
}

/// Resolve the rejection target for a stage with approval capability.
///
/// Priority: agent-provided `route_to` → previous stage in flow.
pub fn resolve_rejection_target(
    workflow: &WorkflowConfig,
    current_stage: &str,
    flow: &str,
    route_to: Option<&str>,
) -> WorkflowResult<String> {
    if let Some(target) = route_to {
        if workflow.has_stage(flow, target) {
            return Ok(target.to_string());
        }
        return Err(WorkflowError::InvalidTransition(format!(
            "Agent specified route_to=\"{target}\" but stage does not exist in flow \"{flow}\""
        )));
    }
    workflow
        .previous_stage(flow, current_stage)
        .map(|s| s.name.clone())
        .ok_or_else(|| {
            WorkflowError::InvalidTransition(format!(
                "Stage {current_stage} has no previous stage in flow and agent did not specify route_to"
            ))
        })
}
