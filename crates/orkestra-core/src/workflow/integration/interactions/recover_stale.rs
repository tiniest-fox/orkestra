//! Recover tasks stuck in `Integrating` phase from app crash during merge.

use std::sync::Arc;

use crate::orkestra_debug;
use crate::workflow::api::WorkflowApi;
use crate::workflow::domain::{Task, TaskHeader};
use crate::workflow::ports::GitService;
use crate::workflow::runtime::TaskState;
use crate::workflow::OrchestratorEvent;

/// Recover all tasks stuck in Integrating phase.
///
/// First checks if the branch was already merged into the target. This handles
/// the common case where the merge succeeded but the app was killed before
/// the DB was updated to Archived.
///
/// If not merged, falls back to re-attempting integration or resetting phase.
pub fn execute(api: &WorkflowApi, headers: &[TaskHeader]) -> Vec<OrchestratorEvent> {
    let mut events = Vec::new();

    for header in headers {
        if matches!(header.state, TaskState::Integrating) {
            orkestra_debug!("recovery", "Found stale Integrating task: {}", header.id);

            let Ok(Some(task)) = api.store.get_task(&header.id) else {
                orkestra_debug!(
                    "recovery",
                    "Failed to load task {} for integration recovery",
                    header.id
                );
                continue;
            };
            events.push(recover_stale_task(api, &task));
        }
    }

    events
}

// -- Helpers --

/// Attempt to recover a single task stuck in `Integrating` phase.
fn recover_stale_task(api: &WorkflowApi, task: &Task) -> OrchestratorEvent {
    if is_branch_already_merged(api.git_service.as_ref(), task) {
        return archive_already_merged_task(api, task);
    }

    // auto_merge disabled — return to choice point for user to retry.
    if !api.workflow.integration.auto_merge {
        orkestra_debug!(
            "recovery",
            "Task {} stuck in Integrating (auto_merge=false) — resetting to Done for retry",
            task.id
        );
        let mut reset_task = task.clone();
        reset_task.state = TaskState::Done;
        if let Err(e) = api.store.save_task(&reset_task) {
            orkestra_debug!(
                "recovery",
                "Failed to reset task {} to Done: {}",
                task.id,
                e
            );
        }
        return OrchestratorEvent::Error {
            task_id: Some(task.id.clone()),
            error: "Task was stuck in Integrating state — reset to Done".into(),
        };
    }

    // Regular merge attempt — retry integration
    reattempt_integration(api, task)
}

/// Archive a task whose branch is already merged into the target.
fn archive_already_merged_task(api: &WorkflowApi, task: &Task) -> OrchestratorEvent {
    orkestra_debug!(
        "recovery",
        "Branch already merged for {}, archiving directly",
        task.id
    );

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

            if let Ok(updated_task) = api.get_task(&task.id) {
                if matches!(updated_task.state, TaskState::Integrating) {
                    orkestra_debug!(
                        "recovery",
                        "Task {} still in Integrating state, resetting to Done",
                        task.id
                    );
                    let mut reset_task = updated_task;
                    reset_task.state = TaskState::Done;
                    if let Err(e) = api.store.save_task(&reset_task) {
                        orkestra_debug!(
                            "integration",
                            "Failed to reset task {} state: {}",
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
fn is_branch_already_merged(git_service: Option<&Arc<dyn GitService>>, task: &Task) -> bool {
    let Some(git) = git_service else {
        return true;
    };

    let Some(ref branch_name) = task.branch_name else {
        return true;
    };

    if task.base_branch.is_empty() {
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
            false
        }
    }
}
