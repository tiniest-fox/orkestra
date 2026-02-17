//! Advance tasks in Finished phase to the next stage.

use crate::orkestra_debug;
use crate::workflow::api::WorkflowApi;
use crate::workflow::ports::{WorkflowResult, WorkflowStore};
use crate::workflow::runtime::TaskState;
use crate::workflow::OrchestratorEvent;

/// Advance tasks whose commit pipeline has completed (Queued after Committing).
///
/// The output was already processed inline (during `handle_execution_complete`
/// or human approval). The commit pipeline just committed the worktree changes.
/// Now we complete the stage advancement.
///
/// After a successful commit, `commit_succeeded` transitions the task to
/// `Queued` with a `_committed` marker in the stage name suffix (same stage).
/// This interaction picks those up and finalizes advancement.
pub fn execute(
    api: &WorkflowApi,
    store: &dyn WorkflowStore,
) -> WorkflowResult<Vec<OrchestratorEvent>> {
    // Query DB directly (not snapshot) because commit pipeline may have
    // created committed tasks after the snapshot was built.
    let finished: Vec<_> = store
        .list_task_headers()?
        .into_iter()
        .filter(|h| matches!(&h.state, TaskState::Finishing { .. }))
        .collect();

    if finished.is_empty() {
        return Ok(Vec::new());
    }

    let mut events = Vec::new();

    for header in &finished {
        let task_id = header.id.clone();
        let stage = header.current_stage().unwrap_or("unknown").to_string();

        orkestra_debug!(
            "orchestrator",
            "advance_committed_stages {}/{}: advancing stage",
            task_id,
            stage,
        );

        match api.finalize_stage_advancement(&task_id) {
            Ok(updated) => {
                let output_type = if updated.is_done() {
                    "done"
                } else if updated.state.is_waiting_on_children() {
                    "subtasks"
                } else {
                    "advanced"
                };
                events.push(OrchestratorEvent::OutputProcessed {
                    task_id,
                    stage,
                    output_type: output_type.to_string(),
                });
            }
            Err(e) => {
                events.push(OrchestratorEvent::Error {
                    task_id: Some(task_id),
                    error: e.to_string(),
                });
            }
        }
    }

    Ok(events)
}
