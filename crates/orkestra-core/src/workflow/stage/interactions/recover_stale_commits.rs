//! Recover tasks stuck in `Committing` phase (background thread died).

use crate::orkestra_debug;
use crate::workflow::domain::TaskHeader;
use crate::workflow::ports::WorkflowStore;
use crate::workflow::runtime::TaskState;

/// Recover tasks stuck in Committing state.
///
/// Reset to Finishing so the next tick re-checks for uncommitted changes
/// and re-spawns the commit thread. The commit is idempotent.
pub fn execute(store: &dyn WorkflowStore, headers: &[TaskHeader]) {
    for header in headers {
        let stage = match &header.state {
            TaskState::Committing { stage } => stage.clone(),
            _ => continue,
        };

        orkestra_debug!("recovery", "Found stale Committing task: {}", header.id);

        let Ok(Some(mut task)) = store.get_task(&header.id) else {
            orkestra_debug!(
                "recovery",
                "Failed to load task {} for committing recovery",
                header.id
            );
            continue;
        };

        task.state = TaskState::finishing(stage);

        if let Err(e) = store.save_task(&task) {
            orkestra_debug!(
                "recovery",
                "Failed to reset stale task {} to Finishing: {}",
                task.id,
                e
            );
        }
    }
}
