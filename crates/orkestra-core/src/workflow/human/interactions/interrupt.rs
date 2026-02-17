//! Interrupt a running agent execution.

use crate::orkestra_debug;
use crate::workflow::api::AgentKiller;
use crate::workflow::domain::Task;
use crate::workflow::iteration::IterationService;
use crate::workflow::ports::{WorkflowError, WorkflowResult, WorkflowStore};
use crate::workflow::runtime::{Outcome, TaskState};
use crate::workflow::stage::interactions as stage;

pub fn execute(
    store: &dyn WorkflowStore,
    iteration_service: &IterationService,
    agent_killer: Option<&dyn AgentKiller>,
    task_id: &str,
) -> WorkflowResult<Task> {
    let mut task = store
        .get_task(task_id)?
        .ok_or_else(|| WorkflowError::TaskNotFound(task_id.into()))?;

    let stage = match &task.state {
        TaskState::AgentWorking { stage } => stage.clone(),
        _ => {
            return Err(WorkflowError::InvalidTransition(format!(
                "Cannot interrupt task in state {} (expected AgentWorking)",
                task.state
            )));
        }
    };

    // Kill agent if configured
    if let Some(killer) = agent_killer {
        let pid = killer.kill_agent(task_id);
        orkestra_debug!(
            "action",
            "interrupt {}: killed agent (pid: {:?})",
            task_id,
            pid
        );
    } else {
        orkestra_debug!(
            "action",
            "interrupt {}: no agent killer configured, transitioning only",
            task_id
        );
    }

    // End current iteration with Interrupted outcome
    stage::end_iteration::execute(iteration_service, &task, Outcome::Interrupted)?;

    // Transition to Interrupted state
    let now = chrono::Utc::now().to_rfc3339();
    task.state = TaskState::interrupted(stage);
    task.updated_at = now;

    store.save_task(&task)?;
    Ok(task)
}
