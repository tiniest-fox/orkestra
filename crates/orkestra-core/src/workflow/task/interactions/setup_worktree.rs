//! Create and configure a task's git worktree.

use std::sync::Arc;

use crate::workflow::ports::{GitService, WorkflowStore};

/// Create a task's worktree: sync base branch, create worktree, save info, run setup script.
///
/// The worktree is created in phases:
/// 1. Sync base branch from remote (warn-and-continue on failure)
/// 2. `ensure_worktree` — creates branch + worktree (fast, rarely fails)
/// 3. Save worktree info to DB immediately (so retry can skip step 2)
/// 4. `run_setup_script` — runs project-specific setup (may fail)
///
/// This split ensures that if the setup script fails, the worktree info is
/// already saved, allowing retry to skip branch/worktree creation.
pub(crate) fn execute(
    store: &Arc<dyn WorkflowStore>,
    git: Option<&Arc<dyn GitService>>,
    task_id: &str,
    base_branch: &str,
) -> Result<(), String> {
    // Sync base branch from remote (warn-and-continue on failure)
    // Skip for task/* branches (subtask branches are never on origin)
    if let Some(git) = git {
        if !base_branch.is_empty() && !base_branch.starts_with("task/") {
            if let Err(e) = git.sync_base_branch(base_branch) {
                crate::orkestra_debug!(
                    "setup",
                    "WARNING: Failed to sync {} from origin: {}. Proceeding with local state.",
                    base_branch,
                    e
                );
            }
        }
    }

    // Phase 1: Create/ensure worktree exists (no setup script yet)
    let worktree_result = if let Some(git) = git {
        let branch = if base_branch.is_empty() {
            None
        } else {
            Some(base_branch)
        };
        git.ensure_worktree(task_id, branch)
            .map(Some)
            .map_err(|e| format!("Worktree creation failed: {e}"))
    } else {
        Ok(None)
    };

    // Phase 2: IMMEDIATELY save worktree info (before setup script)
    // This ensures retry can skip worktree creation if setup script fails
    if let Ok(Some(ref wt)) = worktree_result {
        if let Ok(Some(mut task)) = store.get_task(task_id) {
            task.branch_name = Some(wt.branch_name.clone());
            task.worktree_path = Some(wt.worktree_path.to_string_lossy().to_string());
            task.base_commit.clone_from(&wt.base_commit);
            if let Err(e) = store.save_task(&task) {
                crate::orkestra_debug!(
                    "setup",
                    "WARNING: Failed to save worktree info for {task_id}: {e}"
                );
            }
        }
    }

    // Phase 3: Run setup script (after worktree info is saved)
    match worktree_result {
        Ok(Some(ref wt)) => {
            if let Some(git) = git {
                git.run_setup_script(&wt.worktree_path)
                    .map_err(|e| format!("Setup script failed: {e}"))
            } else {
                Ok(())
            }
        }
        Ok(None) => Ok(()), // No git service, nothing to do
        Err(e) => Err(e),   // Propagate worktree creation error
    }
}
