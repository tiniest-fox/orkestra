//! Advance a single parent task whose subtasks have all completed.

use crate::workflow::config::WorkflowConfig;
use crate::workflow::domain::Task;
use crate::workflow::iteration::IterationService;
use crate::workflow::ports::{WorkflowError, WorkflowResult, WorkflowStore};
use crate::workflow::runtime::TaskState;

pub fn execute(
    store: &dyn WorkflowStore,
    workflow: &WorkflowConfig,
    iteration_service: &IterationService,
    parent_id: &str,
) -> WorkflowResult<Task> {
    let mut parent = store
        .get_task(parent_id)?
        .ok_or_else(|| WorkflowError::TaskNotFound(parent_id.into()))?;

    if !parent.state.is_waiting_on_children() {
        return Err(WorkflowError::InvalidTransition(format!(
            "Parent {} is not in WaitingOnChildren (state={})",
            parent_id, parent.state
        )));
    }

    let breakdown_stage = find_breakdown_stage(workflow, &parent);

    if let Some(stage) = breakdown_stage {
        // `find_breakdown_stage` found this stage via `stages_in_flow`, so `workflow.stage()`
        // will always return `Some` here. `default_caps` is an unreachable fallback.
        let default_caps = Default::default();
        let caps = workflow
            .stage(&parent.flow, &stage)
            .map_or(&default_caps, |s| &s.capabilities);

        let next_state = if let Some(target) = caps.completion_stage() {
            TaskState::queued(target)
        } else {
            super::finalize_advancement::compute_next_state_on_approve(
                workflow,
                &parent.flow,
                &stage,
            )
        };
        let now = chrono::Utc::now().to_rfc3339();

        if let Some(new_stage) = next_state.stage() {
            iteration_service.create_iteration(&parent.id, new_stage, None)?;
        }
        let is_done = next_state.is_done();
        parent.state = next_state;
        parent.updated_at.clone_from(&now);

        if is_done {
            parent.completed_at = Some(now);
        }
    } else {
        parent.state = TaskState::Done;
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
    workflow
        .stages_in_flow(&task.flow)
        .into_iter()
        .find(|s| s.capabilities.produces_subtasks())
        .map(|s| s.name.clone())
}
