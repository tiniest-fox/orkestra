//! Handle agent execution failure (crash, poll error, spawn failure).

use crate::orkestra_debug;
use crate::workflow::domain::Task;
use crate::workflow::interactions::stage;
use crate::workflow::ports::{WorkflowError, WorkflowResult, WorkflowStore};
use crate::workflow::runtime::{Outcome, Phase, Status};
use crate::workflow::services::IterationService;

pub fn execute(
    store: &dyn WorkflowStore,
    iteration_service: &IterationService,
    task_id: &str,
    error: &str,
) -> WorkflowResult<Task> {
    let mut task = store
        .get_task(task_id)?
        .ok_or_else(|| WorkflowError::TaskNotFound(task_id.into()))?;

    if task.phase != Phase::AgentWorking {
        return Err(WorkflowError::InvalidTransition(format!(
            "Cannot fail agent execution in phase {:?} (expected AgentWorking)",
            task.phase
        )));
    }

    let current_stage = task
        .current_stage()
        .ok_or_else(|| WorkflowError::InvalidTransition("Task not in active stage".into()))?
        .to_string();

    orkestra_debug!(
        "action",
        "fail_agent_execution {}: stage={}, error={}",
        task_id,
        current_stage,
        error
    );

    stage::end_iteration::execute(
        iteration_service,
        &task,
        Outcome::AgentError {
            error: error.to_string(),
        },
    )?;
    task.status = Status::failed(error);
    task.phase = Phase::Idle;
    task.updated_at = chrono::Utc::now().to_rfc3339();

    store.save_task(&task)?;
    Ok(task)
}
