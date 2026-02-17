//! Mark agent as started on a task.

use crate::orkestra_debug;
use crate::workflow::domain::Task;
use crate::workflow::ports::{WorkflowError, WorkflowResult, WorkflowStore};
use crate::workflow::runtime::Phase;

pub fn execute(store: &dyn WorkflowStore, task_id: &str) -> WorkflowResult<Task> {
    let mut task = store
        .get_task(task_id)?
        .ok_or_else(|| WorkflowError::TaskNotFound(task_id.into()))?;

    if task.phase != Phase::Idle {
        return Err(WorkflowError::InvalidTransition(format!(
            "Agent cannot start in phase {:?}",
            task.phase
        )));
    }

    task.phase = Phase::AgentWorking;
    task.updated_at = chrono::Utc::now().to_rfc3339();

    orkestra_debug!(
        "action",
        "agent_started {}: phase={:?}, stage={:?}",
        task_id,
        task.phase,
        task.current_stage()
    );

    store.save_task(&task)?;
    Ok(task)
}
