//! Remove worktrees that are no longer needed.

use std::collections::HashMap;

use crate::orkestra_debug;
use crate::workflow::domain::TaskHeader;
use crate::workflow::ports::{GitService, WorkflowStore};
use crate::workflow::runtime::Phase;

/// Clean up worktrees that are no longer needed.
///
/// Removes worktrees in two cases:
/// 1. **Orphaned**: The task was deleted from the DB but the worktree remains on disk.
/// 2. **Archived**: The task was integrated but crashed before worktree cleanup.
///
/// Other terminal states (Done, Failed, Blocked) keep their worktrees.
pub fn execute(store: &dyn WorkflowStore, git_service: &dyn GitService) {
    let worktree_names = match git_service.list_worktree_names() {
        Ok(names) => names,
        Err(e) => {
            orkestra_debug!("recovery", "Failed to list worktree dirs: {}", e);
            return;
        }
    };

    if worktree_names.is_empty() {
        return;
    }

    let Ok(all_headers) = store.list_task_headers() else {
        orkestra_debug!(
            "recovery",
            "Failed to list task headers for orphaned worktree cleanup"
        );
        return;
    };

    let headers_by_id: HashMap<&str, &TaskHeader> =
        all_headers.iter().map(|h| (h.id.as_str(), h)).collect();

    for name in &worktree_names {
        let should_remove = match headers_by_id.get(name.as_str()) {
            None => {
                orkestra_debug!("recovery", "Cleaning up orphaned worktree: {name}");
                true
            }
            Some(header) if header.status.is_archived() && header.phase == Phase::Idle => {
                orkestra_debug!("recovery", "Cleaning up worktree for archived task: {name}");
                true
            }
            _ => false,
        };

        if should_remove {
            if let Err(e) = git_service.remove_worktree(name, true) {
                orkestra_debug!("recovery", "Failed to clean up worktree {name}: {}", e);
            }
        }
    }
}
