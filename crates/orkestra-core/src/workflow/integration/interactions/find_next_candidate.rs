//! Pick the next task to integrate.

use crate::workflow::domain::{TaskHeader, TickSnapshot};

/// Find the next integration candidate from the snapshot.
///
/// Subtasks always auto-merge (they merge into their parent branch, not main).
/// Top-level tasks respect the `auto_merge` config — when false, the user must
/// trigger merge or PR creation explicitly.
///
/// Returns `None` if any task is already integrating or no candidates exist.
pub fn execute(snapshot: &TickSnapshot, auto_merge: bool) -> Option<&TaskHeader> {
    if snapshot.has_integrating {
        return None;
    }

    snapshot
        .idle_done_with_worktree
        .iter()
        .find(|h| h.parent_id.is_some() || auto_merge)
}
