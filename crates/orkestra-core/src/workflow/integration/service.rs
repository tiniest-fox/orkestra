//! Integration service — `WorkflowApi` methods and shared types.

use crate::workflow::api::WorkflowApi;
use crate::workflow::domain::Task;
use crate::workflow::ports::{WorkflowError, WorkflowResult};
use crate::workflow::runtime::TaskState;

use super::interactions as integration_interactions;
use crate::workflow::workflow_warn;

// ============================================================================
// Types
// ============================================================================

/// Result of the git-only portion of integration (no API lock needed).
pub(crate) enum IntegrationGitResult {
    /// Merge succeeded — ready to archive.
    Success,
    /// Rebase had merge conflicts.
    RebaseConflict { conflict_files: Vec<String> },
    /// Rebase failed for a non-conflict reason.
    RebaseError(String),
    /// Merge failed for a non-conflict reason.
    MergeError(String),
    /// Commit failed before rebase/merge could start.
    CommitError(String),
}

// ============================================================================
// WorkflowApi integration methods
// ============================================================================

impl WorkflowApi {
    /// Merge a Done task's branch into its base branch (user-triggered).
    pub fn merge_task(&self, task_id: &str) -> WorkflowResult<Task> {
        integration_interactions::merge_task::execute(self.store.as_ref(), task_id)
    }

    /// Begin PR creation for a Done task.
    pub fn begin_pr_creation(&self, task_id: &str) -> WorkflowResult<Task> {
        integration_interactions::begin_pr_creation::execute(
            self.store.as_ref(),
            self.pr_service.is_some(),
            task_id,
        )
    }

    /// Retry PR creation by recovering from Failed state back to Done+Idle.
    pub fn retry_pr_creation(&self, task_id: &str) -> WorkflowResult<Task> {
        integration_interactions::retry_pr_creation::execute(self.store.as_ref(), task_id)
    }

    /// Record successful PR creation.
    pub fn pr_creation_succeeded(&self, task_id: &str, pr_url: &str) -> WorkflowResult<Task> {
        integration_interactions::pr_creation_succeeded::execute(
            self.store.as_ref(),
            task_id,
            pr_url,
        )
    }

    /// Record failed PR creation.
    pub fn pr_creation_failed(&self, task_id: &str, error: &str) -> WorkflowResult<Task> {
        integration_interactions::pr_creation_failed::execute(self.store.as_ref(), task_id, error)
    }

    /// Attempt to integrate a completed task (startup recovery).
    ///
    /// Accepts tasks in both `Done` and `Integrating` states. The `Integrating`
    /// case handles recovery from crashes that occurred mid-integration.
    pub fn integrate_task(&self, task_id: &str) -> WorkflowResult<Task> {
        let task = self.get_task(task_id)?;

        if !task.is_done() && !matches!(task.state, TaskState::Integrating) {
            return Err(WorkflowError::InvalidTransition(
                "Cannot integrate task that is not Done or Integrating".into(),
            ));
        }

        let Some(git) = &self.git_service else {
            return self.integration_succeeded(task_id);
        };

        if task.branch_name.is_none() {
            return self.integration_succeeded(task_id);
        }

        let result = integration_interactions::squash_rebase_merge::execute(
            git.as_ref(),
            &task,
            &self.workflow,
            self.commit_message_generator.as_ref(),
        );
        self.apply_integration_result(task_id, result, task.worktree_path.is_some())
    }

    /// Apply the result of a background git integration.
    pub(crate) fn apply_integration_result(
        &self,
        task_id: &str,
        result: IntegrationGitResult,
        has_worktree: bool,
    ) -> WorkflowResult<Task> {
        match result {
            IntegrationGitResult::Success => {
                let task = self.integration_succeeded(task_id)?;
                if has_worktree {
                    if let Some(git) = &self.git_service {
                        if let Err(e) = git.remove_worktree(task_id, true) {
                            workflow_warn!("Failed to remove worktree for {}: {}", task_id, e);
                        }
                    }
                }
                Ok(task)
            }
            IntegrationGitResult::RebaseConflict { conflict_files } => {
                self.integration_failed(task_id, "Merge conflict", &conflict_files)?;
                Err(WorkflowError::IntegrationFailed("Merge conflict".into()))
            }
            IntegrationGitResult::RebaseError(error_msg) => {
                self.integration_failed(task_id, &error_msg, &[])?;
                Err(WorkflowError::IntegrationFailed(error_msg))
            }
            IntegrationGitResult::MergeError(error_msg) => {
                self.integration_failed(task_id, &error_msg, &[])?;
                Err(WorkflowError::IntegrationFailed(error_msg))
            }
            IntegrationGitResult::CommitError(error_msg) => {
                self.integration_failed(task_id, &error_msg, &[])?;
                Err(WorkflowError::IntegrationFailed(error_msg))
            }
        }
    }

    /// Record successful integration (merge). Archives the task.
    pub fn integration_succeeded(&self, task_id: &str) -> WorkflowResult<Task> {
        integration_interactions::integration_succeeded::execute(self.store.as_ref(), task_id)
    }

    /// Record failed integration. Returns task to recovery stage.
    pub fn integration_failed(
        &self,
        task_id: &str,
        error: &str,
        conflict_files: &[String],
    ) -> WorkflowResult<Task> {
        integration_interactions::integration_failed::execute(
            self.store.as_ref(),
            &self.workflow,
            &self.iteration_service,
            task_id,
            error,
            conflict_files,
        )
    }
}

// ============================================================================
// Tests
// ============================================================================

#[cfg(test)]
mod tests {
    use crate::workflow::config::{IntegrationConfig, StageConfig, WorkflowConfig};
    use crate::workflow::runtime::{Outcome, TaskState};
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
        .with_integration(IntegrationConfig::new("work"))
    }

    fn api_with_done_task() -> (WorkflowApi, Task) {
        let workflow = test_workflow();
        let store = Arc::new(InMemoryWorkflowStore::new());
        let api = WorkflowApi::new(workflow, store);

        let mut task = api.create_task("Test", "Description", None).unwrap();
        task.state = TaskState::Done;
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
        assert!(matches!(result.state, TaskState::Archived));
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
        assert!(matches!(task.state, TaskState::Queued { .. }));
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
