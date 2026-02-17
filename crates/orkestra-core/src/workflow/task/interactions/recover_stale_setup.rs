//! Recover tasks stuck in `SettingUp` phase from app crash during setup.

use crate::orkestra_debug;
use crate::workflow::domain::TaskHeader;
use crate::workflow::ports::{GitService, WorkflowStore};
use crate::workflow::runtime::Phase;

/// Recover tasks stuck in `SettingUp` phase.
///
/// Transitions them back to `AwaitingSetup`. The orchestrator will pick them
/// up on the next tick. Cleans up any partial worktree/branch before transitioning.
pub fn execute(
    store: &dyn WorkflowStore,
    git_service: Option<&dyn GitService>,
    headers: &[TaskHeader],
) {
    for header in headers {
        if header.phase != Phase::SettingUp {
            continue;
        }

        orkestra_debug!("recovery", "Recovering stale setup task: {}", header.id);

        // Clean up any partial worktree/branch from interrupted setup
        if let Some(git) = git_service {
            if let Err(e) = git.remove_worktree(&header.id, true) {
                if !e.to_string().contains("not found") && !e.to_string().contains("does not exist")
                {
                    orkestra_debug!(
                        "recovery",
                        "WARNING: Failed to clean up partial worktree for {}: {}",
                        header.id,
                        e
                    );
                }
            }
        }

        // Load full task to modify and save
        let Ok(Some(mut task)) = store.get_task(&header.id) else {
            orkestra_debug!(
                "recovery",
                "Failed to load task {} for setup recovery",
                header.id
            );
            continue;
        };

        task.phase = Phase::AwaitingSetup;
        task.worktree_path = None;
        task.branch_name = None;
        if let Err(e) = store.save_task(&task) {
            orkestra_debug!(
                "recovery",
                "Failed to transition task {} to AwaitingSetup: {}",
                task.id,
                e
            );
        }
    }
}
