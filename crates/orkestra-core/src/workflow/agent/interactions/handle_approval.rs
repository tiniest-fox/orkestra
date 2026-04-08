//! Handle approval output: approve stores artifact and advances, reject sends to rejection target.

use crate::workflow::config::WorkflowConfig;
use crate::workflow::domain::Task;
use crate::workflow::iteration::IterationService;
use crate::workflow::ports::{WorkflowError, WorkflowResult};
use crate::workflow::runtime::{Artifact, Outcome, TaskState};
use crate::workflow::stage::interactions as stage;

pub fn execute(
    workflow: &WorkflowConfig,
    iteration_service: &IterationService,
    task: &mut Task,
    current_stage: &str,
    decision: &str,
    content: &str,
    now: &str,
) -> WorkflowResult<()> {
    // Verify stage has approval capability
    let stage_config = workflow.stage(&task.flow, current_stage).ok_or_else(|| {
        WorkflowError::InvalidTransition(format!("Unknown stage: {current_stage}"))
    })?;
    let effective_caps = &stage_config.capabilities;

    if !effective_caps.has_approval() {
        return Err(WorkflowError::InvalidTransition(format!(
            "Stage {current_stage} does not have approval capability"
        )));
    }

    match decision {
        "approve" => {
            // Store content as artifact, then auto-advance or review (same as artifact flow)
            super::handle_artifact::execute(
                workflow,
                iteration_service,
                task,
                content,
                current_stage,
                now,
            )
        }
        "reject" => {
            // Store rejection content as artifact (same name as approvals, overwrite semantics)
            let artifact_name = stage::finalize_advancement::artifact_name_for_stage(
                workflow,
                &task.flow,
                current_stage,
                "artifact",
            );
            task.artifacts
                .set(Artifact::new(&artifact_name, content, current_stage, now));

            // Resolve rejection target: explicit config → previous stage in flow
            let target = stage::execute_rejection::resolve_rejection_target(
                workflow,
                current_stage,
                &task.flow,
            )?;

            if task.auto_mode
                || workflow
                    .stage(&task.flow, current_stage)
                    .is_some_and(|s| s.is_automated)
            {
                // Auto-advance: execute rejection immediately (existing behavior)
                stage::end_iteration::execute(
                    iteration_service,
                    task,
                    Outcome::rejection(current_stage, &target, content),
                )?;
                stage::execute_rejection::execute(
                    iteration_service,
                    task,
                    current_stage,
                    &target,
                    content,
                    now,
                )?;
            } else {
                // Pause for human review before executing rejection
                stage::end_iteration::execute(
                    iteration_service,
                    task,
                    Outcome::awaiting_rejection_review(current_stage, &target, content),
                )?;
                task.state = TaskState::awaiting_rejection_confirmation(current_stage.to_string());
                task.updated_at = now.to_string();
            }
            Ok(())
        }
        _ => Err(WorkflowError::InvalidTransition(format!(
            "Invalid approval decision: {decision}"
        ))),
    }
}
