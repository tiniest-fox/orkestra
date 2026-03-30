//! Enter interactive mode — user will direct work turn-by-turn in the task's worktree.

use crate::orkestra_debug;
use crate::workflow::config::WorkflowConfig;
use crate::workflow::domain::Task;
use crate::workflow::iteration::IterationService;
use crate::workflow::ports::{WorkflowError, WorkflowResult, WorkflowStore};
use crate::workflow::runtime::{Outcome, TaskState};
use crate::workflow::stage::interactions as stage;

pub fn execute(
    store: &dyn WorkflowStore,
    workflow: &WorkflowConfig,
    iteration_service: &IterationService,
    task_id: &str,
) -> WorkflowResult<Task> {
    let mut task = store
        .get_task(task_id)?
        .ok_or_else(|| WorkflowError::TaskNotFound(task_id.into()))?;

    if !task.can_bypass() && !task.is_done() {
        return Err(WorkflowError::InvalidTransition(format!(
            "Cannot enter interactive mode from state {} (expected paused or done state)",
            task.state
        )));
    }

    let current_stage = super::resolve_current_stage(&task, store, workflow)?;

    orkestra_debug!(
        "action",
        "enter_interactive {}: from state={}, stage={}",
        task_id,
        task.state,
        current_stage
    );

    let now = chrono::Utc::now().to_rfc3339();

    // End current iteration if one is active
    if iteration_service
        .get_active(task_id, &current_stage)?
        .is_some()
    {
        stage::end_iteration::execute(
            iteration_service,
            &task,
            Outcome::skipped(&current_stage, "Entered interactive mode"),
        )?;
    }

    task.state = TaskState::interactive(&current_stage);
    task.updated_at = now;

    store.save_task(&task)?;
    Ok(task)
}
