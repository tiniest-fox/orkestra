//! Pick the next task to integrate.

use crate::workflow::config::WorkflowConfig;
use crate::workflow::domain::{TaskHeader, TickSnapshot};

/// Find the next integration candidate from the snapshot.
///
/// Subtasks always auto-merge (they merge into their parent branch, not main).
/// Top-level tasks respect their flow's `auto_merge` config — resolved per-candidate
/// so tasks on different flows get the correct setting.
///
/// Returns `None` if any task is already integrating or no candidates exist.
pub fn execute<'a>(
    snapshot: &'a TickSnapshot,
    workflow: &WorkflowConfig,
) -> Option<&'a TaskHeader> {
    if snapshot.has_integrating {
        return None;
    }

    snapshot.idle_done_with_worktree.iter().find(|h| {
        h.parent_id.is_some()
            || workflow
                .flow(&h.flow)
                .is_some_and(|f| f.integration.auto_merge)
    })
}
