//! Complete stage advancement after the commit pipeline finishes.

use crate::orkestra_debug;
use crate::workflow::config::WorkflowConfig;
use crate::workflow::domain::Task;
use crate::workflow::iteration::IterationService;
use crate::workflow::ports::{WorkflowError, WorkflowResult, WorkflowStore};
use crate::workflow::runtime::{Phase, Status};

pub fn execute(
    store: &dyn WorkflowStore,
    workflow: &WorkflowConfig,
    iteration_service: &IterationService,
    task_id: &str,
) -> WorkflowResult<Task> {
    let mut task = store
        .get_task(task_id)?
        .ok_or_else(|| WorkflowError::TaskNotFound(task_id.into()))?;

    if !matches!(task.phase, Phase::Finishing | Phase::Finished) {
        return Err(WorkflowError::InvalidTransition(format!(
            "Cannot finalize stage advancement in phase {:?} (expected Finishing or Finished)",
            task.phase
        )));
    }

    let stage = task
        .current_stage()
        .ok_or_else(|| WorkflowError::InvalidTransition("Task not in active stage".into()))?
        .to_string();

    let now = chrono::Utc::now().to_rfc3339();

    if stage_has_subtask_data(workflow, &stage, &task) {
        let artifact_name = artifact_name_for_stage(workflow, &stage, "breakdown");
        let created = super::create_subtasks::execute(
            &task,
            workflow,
            store,
            iteration_service,
            &artifact_name,
        )?;

        if created.is_empty() {
            advance_task(workflow, iteration_service, &mut task, &stage, &now)?;
        } else {
            orkestra_debug!(
                "action",
                "finalize_stage_advancement {}: created {} subtasks, WaitingOnChildren",
                task.id,
                created.len()
            );
            let next_stage = compute_next_status_on_approve(workflow, &stage, task.flow.as_deref())
                .stage()
                .unwrap_or(&stage)
                .to_string();
            task.status = Status::waiting_on_children(next_stage);
            task.phase = Phase::Idle;
        }
    } else {
        advance_task(workflow, iteration_service, &mut task, &stage, &now)?;
    }

    task.updated_at = now;
    store.save_task(&task)?;
    Ok(task)
}

// -- Helpers --

/// Advance a task to its next stage after approval.
fn advance_task(
    workflow: &WorkflowConfig,
    iteration_service: &IterationService,
    task: &mut Task,
    stage: &str,
    now: &str,
) -> WorkflowResult<()> {
    let next_status = compute_next_status_on_approve(workflow, stage, task.flow.as_deref());
    task.status = next_status.clone();
    task.phase = Phase::Idle;

    if let Some(new_stage) = next_status.stage() {
        iteration_service.create_iteration(&task.id, new_stage, None)?;
    }
    if task.is_done() {
        task.completed_at = Some(now.to_string());
    }
    Ok(())
}

/// Check if a stage has structured subtask data stored on the task.
fn stage_has_subtask_data(workflow: &WorkflowConfig, stage: &str, task: &Task) -> bool {
    let has_capability = workflow
        .effective_capabilities(stage, task.flow.as_deref())
        .is_some_and(|caps| caps.produces_subtasks());
    if !has_capability {
        return false;
    }
    let artifact_name = artifact_name_for_stage(workflow, stage, "breakdown");
    let structured_key = format!("{artifact_name}_structured");
    task.artifacts.content(&structured_key).is_some()
}

/// Get artifact name for a stage, with fallback default.
pub(crate) fn artifact_name_for_stage(
    workflow: &WorkflowConfig,
    stage: &str,
    default: &str,
) -> String {
    workflow
        .stage(stage)
        .map_or_else(|| default.to_string(), |s| s.artifact.clone())
}

/// Compute the next status after approving the current stage.
pub(crate) fn compute_next_status_on_approve(
    workflow: &WorkflowConfig,
    current_stage: &str,
    flow: Option<&str>,
) -> Status {
    match workflow.next_stage_in_flow(current_stage, flow) {
        Some(stage) => Status::active(&stage.name),
        None => Status::Done,
    }
}
