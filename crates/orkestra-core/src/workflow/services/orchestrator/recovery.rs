//! Startup recovery for stale tasks and orphaned worktrees.
//!
//! Recovers tasks stuck in transient phases (`SettingUp`, `AgentWorking`,
//! `Committing`, `Integrating`) from app crashes, and cleans up orphaned
//! worktrees from deleted tasks.

use std::collections::HashMap;

use crate::orkestra_debug;
use crate::workflow::domain::{Task, TaskHeader};
use crate::workflow::runtime::Phase;
use crate::workflow::services::WorkflowApi;

use super::{OrchestratorEvent, OrchestratorLoop};

impl OrchestratorLoop {
    /// Recover tasks stuck in Integrating phase (from app crash during merge).
    ///
    /// Tasks that were being integrated when the app crashed will be stuck in Integrating.
    ///
    /// First checks if the branch was already merged into the target. This handles
    /// the common case where the merge succeeded but the app was killed before
    /// the DB was updated to Archived (e.g., merge triggers a rebuild that restarts
    /// the app). In this case, the task is archived directly without re-merging.
    ///
    /// If the branch is NOT merged, falls back to re-attempting the full integration.
    pub(super) fn recover_stale_integrations(
        &self,
        headers: &[TaskHeader],
    ) -> Vec<OrchestratorEvent> {
        let mut events = Vec::new();

        let Ok(api) = self.api.lock() else {
            orkestra_debug!(
                "recovery",
                "Failed to acquire API lock for stale integration recovery"
            );
            return events;
        };

        for header in headers {
            if header.phase == Phase::Integrating && header.is_done() {
                orkestra_debug!("recovery", "Found stale Integrating task: {}", header.id);

                // Load full task for integration recovery (needs artifacts, branch info)
                let Ok(Some(task)) = api.store.get_task(&header.id) else {
                    orkestra_debug!(
                        "recovery",
                        "Failed to load task {} for integration recovery",
                        header.id
                    );
                    continue;
                };
                events.push(Self::recover_stale_task(&api, &task));
            }
        }

        events
    }

    /// Recover tasks stuck in `SettingUp` phase (from app crash during setup).
    ///
    /// Tasks stuck in `SettingUp` from a previous crash are transitioned back to
    /// `AwaitingSetup`. The orchestrator will pick them up on the next tick.
    /// Cleans up any partial worktree/branch before transitioning.
    pub(super) fn recover_stale_setup_tasks(&self, headers: &[TaskHeader]) {
        let Ok(api) = self.api.lock() else {
            orkestra_debug!(
                "recovery",
                "Failed to acquire API lock for stale setup recovery"
            );
            return;
        };

        for header in headers {
            if header.phase != Phase::SettingUp {
                continue;
            }

            orkestra_debug!("recovery", "Recovering stale setup task: {}", header.id);

            // Clean up any partial worktree/branch from interrupted setup
            if let Some(ref git) = api.git_service {
                if let Err(e) = git.remove_worktree(&header.id, true) {
                    // Expected if worktree wasn't created yet
                    if !e.to_string().contains("not found")
                        && !e.to_string().contains("does not exist")
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
            let Ok(Some(mut task)) = api.store.get_task(&header.id) else {
                orkestra_debug!(
                    "recovery",
                    "Failed to load task {} for setup recovery",
                    header.id
                );
                continue;
            };

            // Transition back to AwaitingSetup - orchestrator will re-trigger
            task.phase = Phase::AwaitingSetup;
            task.worktree_path = None;
            task.branch_name = None;
            if let Err(e) = api.store.save_task(&task) {
                orkestra_debug!(
                    "recovery",
                    "Failed to transition task {} to AwaitingSetup: {}",
                    task.id,
                    e
                );
            }
        }
    }

    /// Recover tasks stuck in `AgentWorking` phase (from app crash during agent run).
    ///
    /// Tasks that had an agent running when the app crashed will be stuck in `AgentWorking`.
    /// We reset them to Idle so the orchestrator can respawn the agent.
    pub(super) fn recover_stale_agent_working_tasks(&self, headers: &[TaskHeader]) {
        let Ok(api) = self.api.lock() else {
            orkestra_debug!(
                "recovery",
                "Failed to acquire API lock for stale agent recovery"
            );
            return;
        };

        for header in headers {
            if header.phase == Phase::AgentWorking {
                orkestra_debug!("recovery", "Found stale AgentWorking task: {}", header.id);

                // Load full task to modify and save
                let Ok(Some(mut task)) = api.store.get_task(&header.id) else {
                    orkestra_debug!(
                        "recovery",
                        "Failed to load task {} for agent recovery",
                        header.id
                    );
                    continue;
                };

                task.phase = Phase::Idle;
                // Keep same status - orchestrator will respawn agent

                if let Err(e) = api.store.save_task(&task) {
                    orkestra_debug!(
                        "recovery",
                        "Failed to reset stale task {} to Idle: {}",
                        task.id,
                        e
                    );
                }
            }
        }
    }

    /// Recover tasks stuck in Committing phase (background thread died).
    ///
    /// Reset to Finishing so the next tick re-checks for uncommitted changes
    /// and re-spawns the commit thread. The commit is idempotent.
    pub(super) fn recover_stale_committing_tasks(&self, headers: &[TaskHeader]) {
        let Ok(api) = self.api.lock() else {
            orkestra_debug!(
                "recovery",
                "Failed to acquire API lock for stale committing recovery"
            );
            return;
        };

        for header in headers {
            if header.phase == Phase::Committing {
                orkestra_debug!("recovery", "Found stale Committing task: {}", header.id);

                // Load full task to modify and save
                let Ok(Some(mut task)) = api.store.get_task(&header.id) else {
                    orkestra_debug!(
                        "recovery",
                        "Failed to load task {} for committing recovery",
                        header.id
                    );
                    continue;
                };

                task.phase = Phase::Finishing;

                if let Err(e) = api.store.save_task(&task) {
                    orkestra_debug!(
                        "recovery",
                        "Failed to reset stale task {} to Finishing: {}",
                        task.id,
                        e
                    );
                }
            }
        }
    }

    /// Clean up worktrees that are no longer needed.
    ///
    /// Removes worktrees in two cases:
    /// 1. **Orphaned**: The task was deleted from the DB but the worktree remains on disk.
    /// 2. **Archived**: The task was integrated but crashed before worktree cleanup.
    ///
    /// Other terminal states (Done, Failed, Blocked) keep their worktrees:
    /// Done tasks still need theirs for integration, and Failed/Blocked tasks
    /// can be retried.
    pub(super) fn cleanup_orphaned_worktrees(&self) {
        let Ok(api) = self.api.lock() else {
            orkestra_debug!(
                "recovery",
                "Failed to acquire API lock for orphaned worktree cleanup"
            );
            return;
        };

        let Some(ref git) = api.git_service else {
            return; // No git service configured
        };

        let worktree_names = match git.list_worktree_names() {
            Ok(names) => names,
            Err(e) => {
                orkestra_debug!("recovery", "Failed to list worktree dirs: {}", e);
                return;
            }
        };

        if worktree_names.is_empty() {
            return;
        }

        let Ok(all_headers) = api.store.list_task_headers() else {
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
                if let Err(e) = git.remove_worktree(name, true) {
                    orkestra_debug!("recovery", "Failed to clean up worktree {name}: {}", e);
                }
            }
        }
    }

    // -- Helpers --

    /// Attempt to recover a single task stuck in `Integrating` phase.
    fn recover_stale_task(api: &WorkflowApi, task: &Task) -> OrchestratorEvent {
        // First check if the branch is already merged (handles both regular merges and PRs)
        if Self::is_branch_already_merged(api, task) {
            return Self::archive_already_merged_task(api, task);
        }

        // auto_merge disabled — return to choice point for user to retry.
        // Covers both failed PR creation and failed manual merge attempts.
        if !api.workflow.integration.auto_merge {
            orkestra_debug!(
                "recovery",
                "Task {} stuck in Integrating (auto_merge=false) — resetting to Done+Idle for retry",
                task.id
            );
            let mut reset_task = task.clone();
            reset_task.phase = Phase::Idle;
            if let Err(e) = api.store.save_task(&reset_task) {
                orkestra_debug!(
                    "recovery",
                    "Failed to reset task {} to Idle: {}",
                    task.id,
                    e
                );
            }
            return OrchestratorEvent::Error {
                task_id: Some(task.id.clone()),
                error: "Task was stuck in Integrating phase — reset to Done+Idle".into(),
            };
        }

        // Otherwise, this is a regular merge attempt - retry integration
        Self::reattempt_integration(api, task)
    }

    /// Archive a task whose branch is already merged into the target.
    fn archive_already_merged_task(api: &WorkflowApi, task: &Task) -> OrchestratorEvent {
        orkestra_debug!(
            "recovery",
            "Branch already merged for {}, archiving directly",
            task.id
        );

        // Clean up worktree if it still exists on disk
        if task.worktree_path.is_some() {
            if let Some(ref git) = api.git_service {
                if let Err(e) = git.remove_worktree(&task.id, true) {
                    orkestra_debug!(
                        "recovery",
                        "Failed to remove worktree for {} (non-critical): {}",
                        task.id,
                        e
                    );
                }
            }
        }

        match api.integration_succeeded(&task.id) {
            Ok(_) => {
                orkestra_debug!("recovery", "Archived already-merged task {}", task.id);
                OrchestratorEvent::IntegrationCompleted {
                    task_id: task.id.clone(),
                }
            }
            Err(e) => {
                orkestra_debug!(
                    "recovery",
                    "Failed to archive already-merged task {}: {}",
                    task.id,
                    e
                );
                OrchestratorEvent::IntegrationFailed {
                    task_id: task.id.clone(),
                    error: e.to_string(),
                    conflict_files: vec![],
                }
            }
        }
    }

    /// Re-attempt full integration for a task whose branch is not yet merged.
    fn reattempt_integration(api: &WorkflowApi, task: &Task) -> OrchestratorEvent {
        match api.integrate_task(&task.id) {
            Ok(_) => {
                orkestra_debug!(
                    "recovery",
                    "Successfully recovered integration for {}",
                    task.id
                );
                OrchestratorEvent::IntegrationCompleted {
                    task_id: task.id.clone(),
                }
            }
            Err(e) => {
                orkestra_debug!("recovery", "Integration failed for {}: {}", task.id, e);

                // integration_failed() should have moved task to recovery stage.
                // Verify the task is no longer stuck in Integrating phase.
                if let Ok(updated_task) = api.get_task(&task.id) {
                    if updated_task.phase == Phase::Integrating {
                        // Fallback: reset phase to Idle so orchestrator can retry later
                        orkestra_debug!(
                            "recovery",
                            "Task {} still in Integrating phase, resetting to Idle",
                            task.id
                        );
                        let mut reset_task = updated_task;
                        reset_task.phase = Phase::Idle;
                        if let Err(e) = api.store.save_task(&reset_task) {
                            orkestra_debug!(
                                "integration",
                                "Failed to reset task {} phase: {}",
                                task.id,
                                e
                            );
                        }
                    }
                }

                OrchestratorEvent::IntegrationFailed {
                    task_id: task.id.clone(),
                    error: e.to_string(),
                    conflict_files: vec![],
                }
            }
        }
    }

    /// Check if a task's branch is already merged into its target branch.
    ///
    /// Returns `true` if:
    /// - No git service configured (nothing to merge)
    /// - No branch name on the task (nothing to merge)
    /// - The branch no longer exists (already cleaned up after merge)
    /// - The branch's commits are all reachable from the target
    ///
    /// Returns `false` if the branch has unmerged commits or if the check fails.
    fn is_branch_already_merged(api: &WorkflowApi, task: &Task) -> bool {
        let Some(ref git) = api.git_service else {
            return true; // No git = nothing to merge
        };

        let Some(ref branch_name) = task.branch_name else {
            return true; // No branch = nothing to merge
        };

        if task.base_branch.is_empty() {
            // No base_branch means we can't determine the merge target.
            // Treat as not merged so integration can surface the error.
            return false;
        }

        match git.is_branch_merged(branch_name, &task.base_branch) {
            Ok(merged) => merged,
            Err(e) => {
                orkestra_debug!(
                    "recovery",
                    "Failed to check merge status for {}: {}, assuming not merged",
                    task.id,
                    e
                );
                false // Err on side of caution: attempt re-integration
            }
        }
    }
}
