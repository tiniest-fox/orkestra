//! Pick the next task for automatic PR update (push + description audit).

use crate::workflow::domain::{TaskHeader, TickSnapshot};

/// Find a Done task with an open PR that may have unpushed work.
///
/// Returns a candidate from the snapshot. The orchestrator performs
/// the actual git I/O check (pending changes, sync status) before
/// deciding to push — this function stays pure.
pub fn execute(snapshot: &TickSnapshot) -> Option<&TaskHeader> {
    if snapshot.has_integrating {
        return None;
    }

    snapshot
        .idle_done_with_worktree
        .iter()
        .find(|h| h.has_open_pr() && h.parent_id.is_none())
}
