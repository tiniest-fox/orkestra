//! Advance tasks in Finished phase to the next stage.

use crate::orkestra_debug;
use crate::workflow::ports::{WorkflowResult, WorkflowStore};
use crate::workflow::runtime::Phase;
use crate::workflow::services::WorkflowApi;
use crate::workflow::OrchestratorEvent;

/// Advance tasks in Finished phase to the next stage.
///
/// The output was already processed inline (during `handle_execution_complete`
/// or human approval). The commit pipeline just committed the worktree changes.
/// Now we complete the stage advancement.
pub fn execute(
    api: &WorkflowApi,
    store: &dyn WorkflowStore,
) -> WorkflowResult<Vec<OrchestratorEvent>> {
    // Query DB directly (not snapshot) because commit pipeline may have
    // created Finished tasks after the snapshot was built.
    let finished: Vec<_> = store
        .list_task_headers()?
        .into_iter()
        .filter(|h| h.phase == Phase::Finished)
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
                } else if updated.status.is_waiting_on_children() {
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
