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
/// Priority: explicit `rejection_stage` in config → previous stage in flow.
pub fn resolve_rejection_target(
    workflow: &WorkflowConfig,
    current_stage: &str,
    flow: &str,
) -> WorkflowResult<String> {
    let stage_config = workflow.stage(flow, current_stage).ok_or_else(|| {
        WorkflowError::InvalidTransition(format!("Unknown stage: {current_stage}"))
    })?;

    if let Some(target) = stage_config.capabilities.rejection_stage() {
        return Ok(target.to_string());
    }

    workflow
        .previous_stage(flow, current_stage)
        .map(|s| s.name.clone())
        .ok_or_else(|| {
            WorkflowError::InvalidTransition(format!(
                "Stage {current_stage} has no rejection_stage configured and no previous stage in flow"
            ))
        })
}
