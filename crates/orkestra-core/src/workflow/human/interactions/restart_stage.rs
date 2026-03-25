//! Restart the current stage with a fresh agent session.

use crate::orkestra_debug;
use crate::workflow::config::WorkflowConfig;
use crate::workflow::domain::{IterationTrigger, Task};
use crate::workflow::iteration::IterationService;
use crate::workflow::ports::{WorkflowError, WorkflowResult, WorkflowStore};
use crate::workflow::runtime::{Outcome, TaskState};
use crate::workflow::stage::interactions as stage;

pub fn execute(
    store: &dyn WorkflowStore,
    workflow: &WorkflowConfig,
    iteration_service: &IterationService,
    task_id: &str,
    message: &str,
) -> WorkflowResult<Task> {
    let mut task = store
        .get_task(task_id)?
        .ok_or_else(|| WorkflowError::TaskNotFound(task_id.into()))?;

    if !task.can_bypass() {
        return Err(WorkflowError::InvalidTransition(format!(
            "Cannot bypass task in state {} (expected paused state)",
            task.state
        )));
    }

    let current_stage = if let Some(s) = task.current_stage() {
        s.to_string()
    } else {
        // Fallback for Failed/Blocked without stage (old data or edge cases)
        let iterations = store.get_iterations(&task.id)?;
        iterations.last().map_or_else(
            || {
                workflow
                    .first_stage_in_flow(task.flow.as_deref())
                    .map_or_else(|| "planning".to_string(), |s| s.name.clone())
            },
            |i| i.stage.clone(),
        )
    };

    orkestra_debug!(
        "action",
        "restart_stage {}: stage={}, message_len={}",
        task_id,
        current_stage,
        message.len()
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
            Outcome::skipped(&current_stage, message),
        )?;
    }

    // Create new iteration at the same stage with Restart trigger
    iteration_service.create_iteration(
        task_id,
        &current_stage,
        Some(IterationTrigger::Restart {
            message: message.to_string(),
        }),
    )?;

    task.state = TaskState::queued(&current_stage);
    task.updated_at = now;

    store.save_task(&task)?;
    Ok(task)
}
