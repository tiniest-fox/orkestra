//! Find tasks eligible for auto-resolve monitoring.

use crate::workflow::domain::{TaskHeader, TickSnapshot};

/// Return task headers from the snapshot that are candidates for auto-resolve polling.
///
/// Candidates must be: Done + idle, have a PR URL, have `auto_resolve` enabled, and be top-level.
pub fn execute(snapshot: &TickSnapshot) -> Vec<&TaskHeader> {
    snapshot
        .idle_done_with_worktree
        .iter()
        .filter(|h| h.auto_resolve && h.has_open_pr() && h.parent_id.is_none())
        .collect()
}
