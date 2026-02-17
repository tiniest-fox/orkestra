//! Resume an interrupted task, optionally with a message for the agent.

use crate::orkestra_debug;
use crate::workflow::domain::{IterationTrigger, Task};
use crate::workflow::ports::{WorkflowError, WorkflowResult, WorkflowStore};
use crate::workflow::runtime::Phase;
use crate::workflow::services::IterationService;

pub fn execute(
    store: &dyn WorkflowStore,
    iteration_service: &IterationService,
    task_id: &str,
    message: Option<String>,
) -> WorkflowResult<Task> {
    let mut task = store
        .get_task(task_id)?
        .ok_or_else(|| WorkflowError::TaskNotFound(task_id.into()))?;

    if task.phase != Phase::Interrupted {
        return Err(WorkflowError::InvalidTransition(format!(
            "Cannot resume task in phase {:?}",
            task.phase
        )));
    }

    let current_stage = task
        .current_stage()
        .ok_or_else(|| WorkflowError::InvalidTransition("Task not in active stage".into()))?
        .to_string();

    orkestra_debug!(
        "action",
        "resume {}: stage {} with message: {:?}",
        task_id,
        current_stage,
        message.as_deref()
    );

    // Create new iteration with ManualResume trigger
    let trigger = IterationTrigger::ManualResume { message };
    iteration_service.create_iteration(&task.id, &current_stage, Some(trigger))?;

    // Transition to Idle so orchestrator picks it up
    let now = chrono::Utc::now().to_rfc3339();
    task.phase = Phase::Idle;
    task.updated_at = now;

    store.save_task(&task)?;
    Ok(task)
}
