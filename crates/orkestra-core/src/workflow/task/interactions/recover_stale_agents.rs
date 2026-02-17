//! Recover tasks stuck in `AgentWorking` phase from app crash during agent run.

use crate::orkestra_debug;
use crate::workflow::domain::TaskHeader;
use crate::workflow::ports::WorkflowStore;
use crate::workflow::runtime::Phase;

/// Recover tasks stuck in `AgentWorking` phase.
///
/// Resets them to Idle so the orchestrator can respawn the agent.
pub fn execute(store: &dyn WorkflowStore, headers: &[TaskHeader]) {
    for header in headers {
        if header.phase != Phase::AgentWorking {
            continue;
        }

        orkestra_debug!("recovery", "Found stale AgentWorking task: {}", header.id);

        let Ok(Some(mut task)) = store.get_task(&header.id) else {
            orkestra_debug!(
                "recovery",
                "Failed to load task {} for agent recovery",
                header.id
            );
            continue;
        };

        task.phase = Phase::Idle;

        if let Err(e) = store.save_task(&task) {
            orkestra_debug!(
                "recovery",
                "Failed to reset stale task {} to Idle: {}",
                task.id,
                e
            );
        }
    }
}
