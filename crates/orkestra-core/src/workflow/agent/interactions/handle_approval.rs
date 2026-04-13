//! Handle approval output: approve stores artifact and advances, reject sends to rejection target.

use crate::workflow::config::WorkflowConfig;
use crate::workflow::domain::{ArtifactSnapshot, Task};
use crate::workflow::iteration::IterationService;
use crate::workflow::ports::{WorkflowError, WorkflowResult};
use crate::workflow::runtime::{Artifact, Outcome, TaskState};
use crate::workflow::stage::interactions as stage;

#[allow(clippy::too_many_arguments)]
pub fn execute(
    workflow: &WorkflowConfig,
    iteration_service: &IterationService,
    task: &mut Task,
    current_stage: &str,
    decision: &str,
    content: &str,
    route_to: Option<&str>,
    now: &str,
) -> WorkflowResult<()> {
    // Verify stage has approval capability
    let stage_config = workflow.stage(&task.flow, current_stage).ok_or_else(|| {
        WorkflowError::InvalidTransition(format!("Unknown stage: {current_stage}"))
    })?;

    if !stage_config.has_agentic_gate() {
        return Err(WorkflowError::InvalidTransition(format!(
            "Stage {current_stage} does not have approval capability"
        )));
    }

    match decision {
        "approve" => {
            // Store the reviewer's approval content as artifact, then auto-advance
            // or pause for human review based on auto_mode.
            let artifact_name = stage::finalize_advancement::artifact_name_for_stage(
                workflow,
                &task.flow,
                current_stage,
                "artifact",
            );
            task.artifacts
                .set(Artifact::new(&artifact_name, content, current_stage, now));
            iteration_service.set_artifact_snapshot(
                &task.id,
                current_stage,
                ArtifactSnapshot {
                    name: artifact_name,
                    content: content.to_string(),
                },
            )?;
            stage::auto_advance_or_review::execute(
                iteration_service,
                workflow,
                task,
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

            // Snapshot rejection content on iteration before any state transition
            iteration_service.set_artifact_snapshot(
                &task.id,
                current_stage,
                ArtifactSnapshot {
                    name: artifact_name.clone(),
                    content: content.to_string(),
                },
            )?;

            // Resolve rejection target: agent route_to → previous stage in flow
            let target = stage::execute_rejection::resolve_rejection_target(
                workflow,
                current_stage,
                &task.flow,
                route_to,
            )?;

            if task.auto_mode {
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
