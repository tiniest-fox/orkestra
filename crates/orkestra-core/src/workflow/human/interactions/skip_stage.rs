//! Skip the current stage, advancing to the next stage in the pipeline.

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

    let current_stage = super::resolve_current_stage(&task, store, workflow)?;

    let next = workflow.next_stage(&task.flow, &current_stage);

    match next {
        None => {
            // Last stage — skip marks task as Done
            orkestra_debug!(
                "action",
                "skip_stage {}: last stage={}, marking done",
                task_id,
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
                    Outcome::skipped(&current_stage, message),
                )?;
            }

            task.state = TaskState::Done;
            task.completed_at = Some(now.clone());
            task.updated_at = now;

            store.save_task(&task)?;
            Ok(task)
        }
        Some(next_stage) => {
            let next_name = next_stage.name.clone();
            orkestra_debug!(
                "action",
                "skip_stage {}: from={}, advancing to={}",
                task_id,
                current_stage,
                next_name
            );
            super::send_to_stage::execute(
                store,
                workflow,
                iteration_service,
                task_id,
                &next_name,
                message,
            )
        }
    }
}
