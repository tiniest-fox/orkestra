//! Execute a rejection: transition task to the target stage with rejection context.

use crate::orkestra_debug;
use crate::workflow::config::WorkflowConfig;
use crate::workflow::domain::{IterationTrigger, Task};
use crate::workflow::iteration::IterationService;
use crate::workflow::ports::{WorkflowError, WorkflowResult, WorkflowStore};
use crate::workflow::runtime::{Phase, Status};

#[allow(clippy::too_many_arguments)]
pub fn execute(
    store: &dyn WorkflowStore,
    workflow: &WorkflowConfig,
    iteration_service: &IterationService,
    task: &mut Task,
    from_stage: &str,
    target: &str,
    feedback: &str,
    now: &str,
) -> WorkflowResult<()> {
    let effective_caps = workflow
        .effective_capabilities(from_stage, task.flow.as_deref())
        .unwrap_or_default();

    // Supersede target stage session if configured (forces fresh spawn)
    if effective_caps.rejection_resets_session() {
        if let Ok(Some(mut session)) = store.get_stage_session(&task.id, target) {
            session.supersede(now);
            if let Err(e) = store.save_stage_session(&session) {
                orkestra_debug!(
                    "action",
                    "Failed to supersede session for {}/{}: {}",
                    task.id,
                    target,
                    e
                );
            }
        }
    }

    task.status = Status::active(target);
    task.phase = Phase::Idle;
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
    flow: Option<&str>,
) -> WorkflowResult<String> {
    let effective_caps = workflow
        .effective_capabilities(current_stage, flow)
        .ok_or_else(|| {
            WorkflowError::InvalidTransition(format!("Unknown stage: {current_stage}"))
        })?;

    if let Some(target) = effective_caps.rejection_stage() {
        return Ok(target.to_string());
    }

    workflow
        .previous_stage_in_flow(current_stage, flow)
        .map(|s| s.name.clone())
        .ok_or_else(|| {
            WorkflowError::InvalidTransition(format!(
                "Stage {current_stage} has no rejection_stage configured and no previous stage in flow"
            ))
        })
}
