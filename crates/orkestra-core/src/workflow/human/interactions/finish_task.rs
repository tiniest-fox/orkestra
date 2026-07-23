//! Finish a task immediately, entering the commit pipeline from any bypassable state.

use crate::orkestra_debug;
use crate::workflow::config::WorkflowConfig;
use crate::workflow::domain::Task;
use crate::workflow::iteration::IterationService;
use crate::workflow::ports::{WorkflowError, WorkflowResult, WorkflowStore};
use crate::workflow::runtime::{Outcome, TaskState};
use crate::workflow::stage::interactions as stage;

pub fn execute(
    store: &dyn WorkflowStore,
    iteration_service: &IterationService,
    workflow: &WorkflowConfig,
    task_id: &str,
) -> WorkflowResult<Task> {
    let mut task = store
        .get_task(task_id)?
        .ok_or_else(|| WorkflowError::TaskNotFound(task_id.into()))?;

    if !task.can_bypass() {
        return Err(WorkflowError::InvalidTransition(format!(
            "Cannot finish task in state {} (expected paused state)",
            task.state
        )));
    }

    if task.vibe_origin.is_some() {
        return Err(WorkflowError::InvalidTransition(
            "Cannot finish a task in vibe mode".into(),
        ));
    }

    let current_stage = super::resolve_current_stage(&task, store, workflow)?;

    orkestra_debug!("action", "finish_task {}: stage={}", task_id, current_stage);

    // End current iteration if one is active
    if iteration_service
        .get_active(task_id, &current_stage)?
        .is_some()
    {
        stage::end_iteration::execute(
            iteration_service,
            &task,
            Outcome::skipped(&current_stage, "finished"),
        )?;
    }

    let now = chrono::Utc::now().to_rfc3339();
    task.state = TaskState::finishing(&current_stage);
    task.updated_at = now;

    store.save_task(&task)?;
    Ok(task)
}
