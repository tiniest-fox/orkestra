//! Startup recovery for stale tasks and orphaned worktrees.
//!
//! Delegates to domain-specific recovery interactions. This module is a thin
//! orchestration layer that gathers inputs and dispatches to the right interaction.

use crate::orkestra_debug;
use crate::workflow::interactions;

use super::{OrchestratorEvent, OrchestratorLoop};

impl OrchestratorLoop {
    /// Recover all tasks stuck in transient phases from app crashes.
    ///
    /// Called once at startup before the tick loop begins. Each recovery
    /// domain is handled by its own interaction.
    pub fn run_startup_recovery(&self) -> Vec<OrchestratorEvent> {
        let Ok(api) = self.api.lock() else {
            orkestra_debug!(
                "recovery",
                "Failed to acquire API lock for startup recovery"
            );
            return vec![OrchestratorEvent::Error {
                task_id: None,
                error: "Failed to acquire API lock for startup recovery".into(),
            }];
        };

        let Ok(headers) = api.store.list_task_headers() else {
            orkestra_debug!(
                "recovery",
                "Failed to list task headers for startup recovery"
            );
            return Vec::new();
        };

        let git_service = api.git_service.as_deref();

        // Recover tasks stuck in transient phases
        interactions::task::recover_stale_setup::execute(api.store.as_ref(), git_service, &headers);
        interactions::task::recover_stale_agents::execute(api.store.as_ref(), &headers);
        interactions::stage::recover_stale_commits::execute(api.store.as_ref(), &headers);

        // Recover stale integrations (returns events)
        let events = interactions::integration::recover_stale::execute(&api, &headers);

        // Clean up orphaned worktrees
        if let Some(ref git) = api.git_service {
            interactions::task::cleanup_orphaned_worktrees::execute(
                api.store.as_ref(),
                git.as_ref(),
            );
        }

        events
    }
}
