//! Recover tasks stuck in `AgentWorking` or `GateRunning` phase from app crash.

use crate::orkestra_debug;
use crate::workflow::domain::TaskHeader;
use crate::workflow::ports::WorkflowStore;
use crate::workflow::runtime::TaskState;

/// Recover tasks stuck in `AgentWorking` or `GateRunning` state.
///
/// - `AgentWorking` → `Queued`: respawn the agent.
/// - `GateRunning` → `AwaitingGate`: re-spawn the gate on the next tick.
pub fn execute(store: &dyn WorkflowStore, headers: &[TaskHeader]) {
    for header in headers {
        match &header.state {
            TaskState::AgentWorking { stage } => {
                let stage = stage.clone();
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
                        "Failed to reset stale AgentWorking task {} to Queued: {}",
                        task.id,
                        e
                    );
                }
            }
            TaskState::GateRunning { stage } => {
                let stage = stage.clone();
                orkestra_debug!("recovery", "Found stale GateRunning task: {}", header.id);

                let Ok(Some(mut task)) = store.get_task(&header.id) else {
                    orkestra_debug!(
                        "recovery",
                        "Failed to load task {} for gate recovery",
                        header.id
                    );
                    continue;
                };

                task.state = TaskState::awaiting_gate(stage);

                if let Err(e) = store.save_task(&task) {
                    orkestra_debug!(
                        "recovery",
                        "Failed to reset stale GateRunning task {} to AwaitingGate: {}",
                        task.id,
                        e
                    );
                }
            }
            _ => {}
        }
    }
}
