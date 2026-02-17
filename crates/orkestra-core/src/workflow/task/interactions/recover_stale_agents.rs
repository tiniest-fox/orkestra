//! Recover tasks stuck in `AgentWorking` phase from app crash during agent run.

use crate::orkestra_debug;
use crate::workflow::domain::TaskHeader;
use crate::workflow::ports::WorkflowStore;
use crate::workflow::runtime::TaskState;

/// Recover tasks stuck in `AgentWorking` state.
///
/// Resets them to Queued so the orchestrator can respawn the agent.
pub fn execute(store: &dyn WorkflowStore, headers: &[TaskHeader]) {
    for header in headers {
        let stage = match &header.state {
            TaskState::AgentWorking { stage } => stage.clone(),
            _ => continue,
        };

        orkestra_debug!("recovery", "Found stale AgentWorking task: {}", header.id);

        let Ok(Some(mut task)) = store.get_task(&header.id) else {
            orkestra_debug!(
                "recovery",
                "Failed to load task {} for agent recovery",
                header.id
            );
            continue;
        };

        task.state = TaskState::queued(stage);

        if let Err(e) = store.save_task(&task) {
            orkestra_debug!(
                "recovery",
                "Failed to reset stale task {} to Queued: {}",
                task.id,
                e
            );
        }
    }
}
