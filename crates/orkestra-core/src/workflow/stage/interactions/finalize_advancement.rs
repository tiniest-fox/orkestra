//! Complete stage advancement after the commit pipeline finishes.

use crate::orkestra_debug;
use crate::workflow::config::WorkflowConfig;
use crate::workflow::domain::Task;
use crate::workflow::iteration::IterationService;
use crate::workflow::ports::{WorkflowError, WorkflowResult, WorkflowStore};
use crate::workflow::runtime::TaskState;

pub fn execute(
    store: &dyn WorkflowStore,
    workflow: &WorkflowConfig,
    iteration_service: &IterationService,
    task_id: &str,
) -> WorkflowResult<Task> {
    let mut task = store
        .get_task(task_id)?
        .ok_or_else(|| WorkflowError::TaskNotFound(task_id.into()))?;

    if !matches!(task.state, TaskState::Committed { .. }) {
        return Err(WorkflowError::InvalidTransition(format!(
            "Cannot finalize stage advancement in state {} (expected Committed)",
            task.state
        )));
    }

    let stage = task
        .current_stage()
        .ok_or_else(|| WorkflowError::InvalidTransition("Task not in active stage".into()))?
        .to_string();

    let now = chrono::Utc::now().to_rfc3339();

    if stage_has_subtask_data(workflow, &stage, &task) {
        let artifact_name = artifact_name_for_stage(workflow, &task.flow, &stage, "breakdown");
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
            let next_stage = compute_next_state_on_approve(workflow, &task.flow, &stage)
                .stage()
                .unwrap_or(&stage)
                .to_string();
            task.state = TaskState::waiting_on_children(next_stage);
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
    let next_state = compute_next_state_on_approve(workflow, &task.flow, stage);

    if let Some(new_stage) = next_state.stage() {
        iteration_service.create_iteration(&task.id, new_stage, None)?;
    }
    let is_done = next_state.is_done();
    task.state = next_state;

    if is_done {
        task.completed_at = Some(now.to_string());
    }
    Ok(())
}

/// Check if a stage has structured subtask data stored on the task.
fn stage_has_subtask_data(workflow: &WorkflowConfig, stage: &str, task: &Task) -> bool {
    let has_capability = workflow
        .stage(&task.flow, stage)
        .is_some_and(|s| s.capabilities.produces_subtasks());
    if !has_capability {
        return false;
    }
    let artifact_name = artifact_name_for_stage(workflow, &task.flow, stage, "breakdown");
    let structured_key = format!("{artifact_name}_structured");
    task.artifacts.content(&structured_key).is_some()
}

/// Get artifact name for a stage, with fallback default.
pub(crate) fn artifact_name_for_stage(
    workflow: &WorkflowConfig,
    flow: &str,
    stage: &str,
    default: &str,
) -> String {
    workflow
        .stage(flow, stage)
        .map_or_else(|| default.to_string(), |s| s.artifact_name().to_string())
}

/// Compute the next state after approving the current stage.
pub(crate) fn compute_next_state_on_approve(
    workflow: &WorkflowConfig,
    flow: &str,
    current_stage: &str,
) -> TaskState {
    match workflow.next_stage(flow, current_stage) {
        Some(stage) => TaskState::queued(&stage.name),
        None => TaskState::Done,
    }
}
