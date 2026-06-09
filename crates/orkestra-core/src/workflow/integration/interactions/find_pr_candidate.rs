//! Pick the next task for automatic PR creation.

use crate::workflow::domain::{TaskHeader, TickSnapshot};

/// Find the next auto-PR candidate from the snapshot.
///
/// Returns a Done task that has `auto_pr=true`, no existing PR, and is not a subtask.
/// Returns `None` if any task is already integrating or no candidates exist.
pub fn execute(snapshot: &TickSnapshot) -> Option<&TaskHeader> {
    if snapshot.has_integrating {
        return None;
    }

    snapshot
        .idle_done_with_worktree
        .iter()
        .find(|h| h.auto_pr && !h.has_open_pr() && h.parent_id.is_none())
}
