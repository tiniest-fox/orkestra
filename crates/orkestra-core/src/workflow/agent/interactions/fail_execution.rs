//! Handle agent execution failure (crash, poll error, spawn failure).

use crate::orkestra_debug;
use crate::workflow::domain::Task;
use crate::workflow::iteration::IterationService;
use crate::workflow::ports::{WorkflowError, WorkflowResult, WorkflowStore};
use crate::workflow::runtime::{Outcome, TaskState};
use crate::workflow::stage::interactions as stage;

pub fn execute(
    store: &dyn WorkflowStore,
    iteration_service: &IterationService,
    task_id: &str,
    error: &str,
) -> WorkflowResult<Task> {
    let mut task = store
        .get_task(task_id)?
        .ok_or_else(|| WorkflowError::TaskNotFound(task_id.into()))?;

    if !matches!(task.state, TaskState::AgentWorking { .. }) {
        return Err(WorkflowError::InvalidTransition(format!(
            "Cannot fail agent execution in state {} (expected AgentWorking)",
            task.state
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
    task.state = TaskState::failed_at(&current_stage, error);
    task.updated_at = chrono::Utc::now().to_rfc3339();

    store.save_task(&task)?;
    Ok(task)
}
