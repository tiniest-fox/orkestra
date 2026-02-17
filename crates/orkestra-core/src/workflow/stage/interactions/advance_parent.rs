//! Advance a single parent task whose subtasks have all completed.

use crate::workflow::config::WorkflowConfig;
use crate::workflow::domain::Task;
use crate::workflow::iteration::IterationService;
use crate::workflow::ports::{WorkflowError, WorkflowResult, WorkflowStore};
use crate::workflow::runtime::{Phase, Status};

pub fn execute(
    store: &dyn WorkflowStore,
    workflow: &WorkflowConfig,
    iteration_service: &IterationService,
    parent_id: &str,
) -> WorkflowResult<Task> {
    let mut parent = store
        .get_task(parent_id)?
        .ok_or_else(|| WorkflowError::TaskNotFound(parent_id.into()))?;

    if !parent.status.is_waiting_on_children() || parent.phase != Phase::Idle {
        return Err(WorkflowError::InvalidTransition(format!(
            "Parent {} is not in WaitingOnChildren/Idle (status={:?}, phase={:?})",
            parent_id, parent.status, parent.phase
        )));
    }

    let breakdown_stage = find_breakdown_stage(workflow, &parent);

    if let Some(stage) = breakdown_stage {
        let effective_caps = workflow
            .effective_capabilities(&stage, parent.flow.as_deref())
            .unwrap_or_default();

        let next_status = if let Some(target) = effective_caps.completion_stage() {
            Status::active(target)
        } else {
            super::finalize_advancement::compute_next_status_on_approve(
                workflow,
                &stage,
                parent.flow.as_deref(),
            )
        };
        let now = chrono::Utc::now().to_rfc3339();

        parent.status = next_status.clone();
        parent.phase = Phase::Idle;
        parent.updated_at.clone_from(&now);

        if let Some(new_stage) = next_status.stage() {
            iteration_service.create_iteration(&parent.id, new_stage, None)?;
        }
        if parent.is_done() {
            parent.completed_at = Some(now);
        }
    } else {
        parent.status = Status::Done;
        parent.phase = Phase::Idle;
        let now = chrono::Utc::now().to_rfc3339();
        parent.updated_at.clone_from(&now);
        parent.completed_at = Some(now);
    }

    store.save_task(&parent)?;
    Ok(parent)
}

// -- Helpers --

/// Find the name of the breakdown stage (the stage with subtask capabilities).
pub(crate) fn find_breakdown_stage(workflow: &WorkflowConfig, task: &Task) -> Option<String> {
    for stage in &workflow.stages {
        let effective_caps = workflow
            .effective_capabilities(&stage.name, task.flow.as_deref())
            .unwrap_or_default();
        if effective_caps.produces_subtasks() {
            return Some(stage.name.clone());
        }
    }
    None
}
