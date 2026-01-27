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
    /// 2. Merges the task branch to the primary branch (main/master)
    /// 3. On success: cleans up worktree, records success
    /// 4. On conflict: aborts merge, moves task back to recovery stage
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
        if let Some(worktree_path) = &task.worktree_path {
            if let Err(e) = git.commit_pending_changes(Path::new(worktree_path), &task.title) {
                workflow_warn!("Failed to commit pending changes for {}: {}", task_id, e);
            }
        }

        // Attempt the merge
        match git.merge_to_primary(branch_name) {
            Ok(_merge_result) => {
                orkestra_debug!("integration", "completed {}: merge succeeded", task_id);
                // Cleanup worktree but keep branch for history
                if task.worktree_path.is_some() {
                    if let Err(e) = git.remove_worktree(task_id, false) {
                        workflow_warn!("Failed to remove worktree for {}: {}", task_id, e);
                    }
                }
                self.integration_succeeded(task_id)
            }
            Err(GitError::MergeConflict { conflict_files, .. }) => {
                orkestra_debug!(
                    "integration",
                    "failed {}: merge conflict, {} files",
                    task_id,
                    conflict_files.len()
                );
                // Abort the failed merge
                if let Err(e) = git.abort_merge() {
                    workflow_warn!("Failed to abort merge for {}: {}", task_id, e);
                }
                self.integration_failed(task_id, "Merge conflict", &conflict_files)
            }
            Err(e) => {
                orkestra_debug!("integration", "failed {}: {}", task_id, e);
                // Non-conflict merge error
                if let Err(abort_err) = git.abort_merge() {
                    workflow_warn!("Failed to abort merge for {}: {}", task_id, abort_err);
                }
                self.integration_failed(task_id, &format!("{e}"), &[])
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

        // Determine which stage to return to
        let recovery_stage = self
            .integration_failure_stage()
            .ok_or_else(|| WorkflowError::InvalidTransition("No recovery stage configured".into()))?
            .to_string();

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
            other => panic!("Expected IntegrationFailed outcome, got {:?}", other),
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
