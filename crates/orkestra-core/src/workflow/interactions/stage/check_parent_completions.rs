//! Advance parents whose subtasks have all been archived.

use crate::orkestra_debug;
use crate::workflow::domain::TickSnapshot;
use crate::workflow::ports::WorkflowResult;
use crate::workflow::services::WorkflowApi;
use crate::workflow::OrchestratorEvent;

/// Check if any `WaitingOnChildren` parents can advance because all subtasks are archived.
///
/// Uses snapshot data to filter subtasks by `parent_id` (eliminates N+1 query).
pub fn execute(
    api: &WorkflowApi,
    snapshot: &TickSnapshot,
) -> WorkflowResult<Vec<OrchestratorEvent>> {
    if snapshot.waiting_parents.is_empty() {
        return Ok(Vec::new());
    }

    let mut events = Vec::new();

    for parent in &snapshot.waiting_parents {
        // Find subtasks of this parent from the snapshot
        let subtasks: Vec<&_> = snapshot
            .all
            .iter()
            .filter(|t| t.parent_id.as_deref() == Some(&parent.id))
            .collect();

        if subtasks.is_empty() {
            continue;
        }

        // Subtasks must be Archived (merged back to parent branch), not just Done.
        let all_archived = subtasks.iter().all(|t| t.is_archived());

        if all_archived {
            let subtask_count = subtasks.len();

            match api.advance_parent(&parent.id) {
                Ok(_) => {
                    orkestra_debug!(
                        "orchestrator",
                        "Parent {} advanced: all {} subtasks done",
                        parent.id,
                        subtask_count
                    );
                    events.push(OrchestratorEvent::ParentAdvanced {
                        task_id: parent.id.clone(),
                        subtask_count,
                    });
                }
                Err(e) => {
                    orkestra_debug!(
                        "orchestrator",
                        "Failed to advance parent {}: {}",
                        parent.id,
                        e
                    );
                    events.push(OrchestratorEvent::Error {
                        task_id: Some(parent.id.clone()),
                        error: e.to_string(),
                    });
                }
            }
        }
    }

    Ok(events)
}
