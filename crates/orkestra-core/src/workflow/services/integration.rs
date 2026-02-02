//! Git integration operations: success/failure handling.

use std::path::Path;

use crate::orkestra_debug;
use crate::workflow::domain::{IterationTrigger, Task};
use crate::workflow::ports::{GitError, WorkflowError, WorkflowResult};
use crate::workflow::runtime::{Outcome, Phase, Status};

use super::{workflow_warn, WorkflowApi};

impl WorkflowApi {
    /// Attempt to integrate a completed task by merging its branch to primary.
    ///
    /// This method orchestrates the full integration process:
    /// 1. Commits any pending changes in the worktree
    /// 2. Rebases the task branch onto primary (conflicts stay on the task branch)
    /// 3. Merges the rebased branch to primary (guaranteed clean fast-forward)
    /// 4. On success: cleans up worktree and branch, records success
    /// 5. On conflict: task branch is restored, moves task back to recovery stage
    ///
    /// If no git service is configured, silently succeeds.
    ///
    /// # Errors
    ///
    /// Returns `InvalidTransition` if the task is not Done.
    pub fn integrate_task(&self, task_id: &str) -> WorkflowResult<Task> {
        let task = self.get_task(task_id)?;

        if !task.is_done() {
            return Err(WorkflowError::InvalidTransition(
                "Cannot integrate task that is not Done".into(),
            ));
        }

        // If no git service, just record success
        let Some(git) = &self.git_service else {
            return self.integration_succeeded(task_id);
        };

        // If no branch, nothing to merge
        let Some(branch_name) = &task.branch_name else {
            orkestra_debug!(
                "integration",
                "integrate_task {}: no branch, marking success",
                task_id
            );
            return self.integration_succeeded(task_id);
        };

        orkestra_debug!(
            "integration",
            "starting {}: branch={}",
            task_id,
            branch_name
        );

        // Commit any pending changes in the worktree
        // If commit fails, we must abort integration to avoid losing changes
        // Skip if the worktree directory no longer exists on disk (e.g., already cleaned up)
        if let Some(worktree_path) = &task.worktree_path {
            let worktree = Path::new(worktree_path);
            if worktree.exists() {
                // Use task title as commit message, falling back to task ID if title is empty
                let commit_message = if task.title.trim().is_empty() {
                    format!("Task {task_id}")
                } else {
                    task.title.clone()
                };
                if let Err(e) = git.commit_pending_changes(worktree, &commit_message) {
                    let error_msg = format!("Failed to commit pending changes: {e}");
                    // Record failure and move task to recovery stage
                    self.integration_failed(task_id, &error_msg, &[])?;
                    // Return error so caller knows integration failed
                    return Err(WorkflowError::IntegrationFailed(error_msg));
                }
            } else {
                orkestra_debug!(
                    "integration",
                    "worktree missing for {}, skipping commit",
                    task_id
                );
            }
        }

        // Target branch is always the task's base_branch (set at creation from UI selection or parent branch).
        if task.base_branch.is_empty() {
            return Err(WorkflowError::InvalidTransition(format!(
                "Task {} has no base_branch set — cannot determine merge target",
                task.id
            )));
        }
        let target_branch = task.base_branch.clone();

        orkestra_debug!(
            "integration",
            "target branch for {}: {}",
            task_id,
            target_branch
        );

        self.rebase_and_merge(&task, git.as_ref(), branch_name, &target_branch)
    }

    /// Rebase the task branch onto the target, then merge.
    ///
    /// After a successful rebase the merge is a guaranteed clean fast-forward.
    /// On conflict the task is moved to the recovery stage.
    fn rebase_and_merge(
        &self,
        task: &Task,
        git: &dyn crate::workflow::ports::GitService,
        branch_name: &str,
        target_branch: &str,
    ) -> WorkflowResult<Task> {
        let task_id = &task.id;

        if let Some(worktree_path) = &task.worktree_path {
            let worktree = Path::new(worktree_path);
            if worktree.exists() {
                match git.rebase_on_branch(worktree, target_branch) {
                    Ok(()) => {
                        orkestra_debug!(
                            "integration",
                            "rebased {}: branch {} onto {}",
                            task_id,
                            branch_name,
                            target_branch
                        );
                    }
                    Err(GitError::MergeConflict { conflict_files, .. }) => {
                        orkestra_debug!(
                            "integration",
                            "failed {}: rebase conflict, {} files",
                            task_id,
                            conflict_files.len()
                        );
                        self.integration_failed(task_id, "Merge conflict", &conflict_files)?;
                        return Err(WorkflowError::IntegrationFailed("Merge conflict".into()));
                    }
                    Err(e) => {
                        orkestra_debug!("integration", "failed {}: rebase error: {}", task_id, e);
                        let error_msg = format!("Failed to rebase branch on {target_branch}: {e}");
                        self.integration_failed(task_id, &error_msg, &[])?;
                        return Err(WorkflowError::IntegrationFailed(error_msg));
                    }
                }
            } else {
                orkestra_debug!(
                    "integration",
                    "worktree missing for {}, skipping rebase",
                    task_id
                );
            }
        }

        match git.merge_to_branch(branch_name, target_branch) {
            Ok(_merge_result) => {
                orkestra_debug!("integration", "completed {}: merge succeeded", task_id);
                // Update DB FIRST — this is the critical state change.
                // If we crash after this, the task is correctly Archived.
                let result = self.integration_succeeded(task_id);
                // Then clean up worktree (non-critical). If this fails or the app
                // crashes here, cleanup_orphaned_worktrees() handles it on next startup.
                if task.worktree_path.is_some() {
                    if let Err(e) = git.remove_worktree(task_id, true) {
                        workflow_warn!("Failed to remove worktree for {}: {}", task_id, e);
                    }
                }
                result
            }
            Err(GitError::MergeConflict { conflict_files, .. }) => {
                orkestra_debug!(
                    "integration",
                    "failed {}: merge conflict, {} files",
                    task_id,
                    conflict_files.len()
                );
                if let Err(e) = git.abort_merge() {
                    workflow_warn!("Failed to abort merge for {}: {}", task_id, e);
                }
                self.integration_failed(task_id, "Merge conflict", &conflict_files)?;
                Err(WorkflowError::IntegrationFailed("Merge conflict".into()))
            }
            Err(e) => {
                orkestra_debug!("integration", "failed {}: {}", task_id, e);
                if let Err(abort_err) = git.abort_merge() {
                    workflow_warn!("Failed to abort merge for {}: {}", task_id, abort_err);
                }
                let error_msg = format!("{e}");
                self.integration_failed(task_id, &error_msg, &[])?;
                Err(WorkflowError::IntegrationFailed(error_msg))
            }
        }
    }

    /// Record successful integration (merge).
    ///
    /// This moves the task from Done to Archived after its branch has been merged.
    /// The `worktree_path` is preserved for log access even though the physical
    /// worktree has been removed.
    ///
    /// # Errors
    ///
    /// Returns `InvalidTransition` if the task is not Done.
    pub fn integration_succeeded(&self, task_id: &str) -> WorkflowResult<Task> {
        let mut task = self.get_task(task_id)?;

        if !task.is_done() {
            return Err(WorkflowError::InvalidTransition(
                "Cannot integrate task that is not Done".into(),
            ));
        }

        // Transition from Done to Archived
        // Keep worktree_path for log access even though physical worktree is removed
        task.status = Status::Archived;
        task.phase = Phase::Idle;
        task.updated_at = chrono::Utc::now().to_rfc3339();
        self.store.save_task(&task)?;

        Ok(task)
    }

    /// Record failed integration (merge conflict). Returns task to recovery stage.
    ///
    /// The task is moved back to the stage configured in `integration.on_failure`
    /// (defaults to the last non-optional stage, typically "work").
    ///
    /// # Arguments
    ///
    /// * `task_id` - The task ID
    /// * `error` - Error message describing the integration failure
    /// * `conflict_files` - List of files with merge conflicts
    ///
    /// # Errors
    ///
    /// Returns `InvalidTransition` if the task is not Done.
    pub fn integration_failed(
        &self,
        task_id: &str,
        error: &str,
        conflict_files: &[String],
    ) -> WorkflowResult<Task> {
        let mut task = self.get_task(task_id)?;

        if !task.is_done() {
            return Err(WorkflowError::InvalidTransition(
                "Can only fail integration on Done task".into(),
            ));
        }

        // Record integration failure via IterationService
        // Use "integration" as a pseudo-stage to track the failure
        self.iteration_service
            .create_iteration(&task.id, "integration", None)?;
        self.iteration_service.end_iteration(
            &task.id,
            "integration",
            Outcome::IntegrationFailed {
                error: error.to_string(),
                conflict_files: conflict_files.to_vec(),
            },
        )?;

        // Determine which stage to return to (flow-aware for subtasks)
        let recovery_stage = self
            .integration_failure_stage(task.flow.as_deref())
            .ok_or_else(|| WorkflowError::InvalidTransition("No recovery stage configured".into()))?;

        // Move task back to recovery stage
        let now = chrono::Utc::now().to_rfc3339();
        task.status = Status::active(&recovery_stage);
        task.phase = Phase::Idle;
        task.completed_at = None;
        task.updated_at = now;

        // Create new iteration in recovery stage with integration error context via IterationService
        self.iteration_service.create_iteration(
            &task.id,
            &recovery_stage,
            Some(IterationTrigger::Integration {
                message: error.to_string(),
                conflict_files: conflict_files.to_vec(),
            }),
        )?;

        self.store.save_task(&task)?;
        Ok(task)
    }
}

#[cfg(test)]
mod tests {
    use crate::workflow::config::{StageConfig, WorkflowConfig};
    use crate::workflow::InMemoryWorkflowStore;
    use std::sync::Arc;

    use super::*;

    fn test_workflow() -> WorkflowConfig {
        WorkflowConfig::new(vec![
            StageConfig::new("planning", "plan"),
            StageConfig::new("work", "summary").with_inputs(vec!["plan".into()]),
            StageConfig::new("review", "verdict")
                .with_inputs(vec!["summary".into()])
                .automated(),
        ])
    }

    fn api_with_done_task() -> (WorkflowApi, Task) {
        let workflow = test_workflow();
        let store = Arc::new(InMemoryWorkflowStore::new());
        let api = WorkflowApi::new(workflow, store);

        let mut task = api.create_task("Test", "Description", None).unwrap();
        task.status = Status::Done;
        task.completed_at = Some(chrono::Utc::now().to_rfc3339());
        api.store.save_task(&task).unwrap();

        (api, task)
    }

    #[test]
    fn test_integration_succeeded() {
        let (api, task) = api_with_done_task();

        let result = api.integration_succeeded(&task.id).unwrap();
        assert!(result.is_archived());
        assert!(!result.is_done());
        assert_eq!(result.phase, Phase::Idle);
    }

    #[test]
    fn test_integration_succeeded_not_done() {
        let workflow = test_workflow();
        let store = Arc::new(InMemoryWorkflowStore::new());
        let api = WorkflowApi::new(workflow, store);

        let task = api.create_task("Test", "Description", None).unwrap();

        let result = api.integration_succeeded(&task.id);
        assert!(matches!(result, Err(WorkflowError::InvalidTransition(_))));
    }

    #[test]
    fn test_integration_failed_returns_to_recovery_stage() {
        let (api, task) = api_with_done_task();

        let task = api
            .integration_failed(&task.id, "Merge conflict", &["src/main.rs".to_string()])
            .unwrap();

        // Should return to configured on_failure stage (default: "work")
        assert_eq!(task.current_stage(), Some("work"));
        assert_eq!(task.phase, Phase::Idle);
        assert!(task.completed_at.is_none());
    }

    #[test]
    fn test_integration_failed_creates_iteration() {
        let (api, task) = api_with_done_task();

        let _ = api
            .integration_failed(&task.id, "Merge conflict", &["src/main.rs".to_string()])
            .unwrap();

        let iterations = api.get_iterations(&task.id).unwrap();

        // Should have: initial + integration failure + recovery
        assert!(iterations.len() >= 2);

        // Find the integration failure iteration
        let integration_iter = iterations
            .iter()
            .find(|i| i.stage == "integration")
            .expect("Should have integration iteration");

        match &integration_iter.outcome {
            Some(Outcome::IntegrationFailed {
                error,
                conflict_files,
            }) => {
                assert_eq!(error, "Merge conflict");
                assert_eq!(conflict_files, &vec!["src/main.rs".to_string()]);
            }
            other => panic!("Expected IntegrationFailed outcome, got {other:?}"),
        }
    }

    #[test]
    fn test_integration_failed_not_done() {
        let workflow = test_workflow();
        let store = Arc::new(InMemoryWorkflowStore::new());
        let api = WorkflowApi::new(workflow, store);

        let task = api.create_task("Test", "Description", None).unwrap();

        let result = api.integration_failed(&task.id, "Error", &[]);
        assert!(matches!(result, Err(WorkflowError::InvalidTransition(_))));
    }
}
