//! Interrupt a running agent execution.

use crate::orkestra_debug;
use crate::workflow::domain::Task;
use crate::workflow::interactions::stage;
use crate::workflow::ports::{WorkflowError, WorkflowResult, WorkflowStore};
use crate::workflow::runtime::{Outcome, Phase};
use crate::workflow::services::{AgentKiller, IterationService};

pub fn execute(
    store: &dyn WorkflowStore,
    iteration_service: &IterationService,
    agent_killer: Option<&dyn AgentKiller>,
    task_id: &str,
) -> WorkflowResult<Task> {
    let mut task = store
        .get_task(task_id)?
        .ok_or_else(|| WorkflowError::TaskNotFound(task_id.into()))?;

    if task.phase != Phase::AgentWorking {
        return Err(WorkflowError::InvalidTransition(format!(
            "Cannot interrupt task in phase {:?}",
            task.phase
        )));
    }

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

    // Transition to Interrupted phase
    let now = chrono::Utc::now().to_rfc3339();
    task.phase = Phase::Interrupted;
    task.updated_at = now;

    store.save_task(&task)?;
    Ok(task)
}
