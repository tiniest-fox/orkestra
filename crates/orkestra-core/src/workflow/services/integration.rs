//! Git integration operations: success/failure handling.

use std::path::{Path, PathBuf};

use crate::orkestra_debug;
use crate::workflow::domain::{IterationTrigger, Task};
use crate::workflow::ports::{GitError, GitService, WorkflowError, WorkflowResult};
use crate::workflow::runtime::{Outcome, Phase, Status};

use super::{workflow_warn, WorkflowApi};

// ============================================================================
// Validation helpers
// ============================================================================

/// Validate that the task doesn't already have an open PR.
fn validate_no_open_pr(task: &Task) -> WorkflowResult<()> {
    if task.has_open_pr() {
        return Err(WorkflowError::InvalidTransition(
            "Task already has an open PR".into(),
        ));
    }
    Ok(())
}

// ============================================================================
// Standalone integration types and function
// ============================================================================

/// Parameters needed to perform git integration without holding the API lock.
pub struct IntegrationParams {
    pub task_id: String,
    pub branch_name: String,
    pub target_branch: String,
    pub worktree_path: Option<PathBuf>,
}

/// Result of the git-only portion of integration (no API lock needed).
pub enum IntegrationGitResult {
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

/// Perform the git work for integration without holding the API lock.
///
/// Rebases onto the target branch and merges. Committing is handled by the
/// caller (the Finishing → Committing → Finished pipeline commits worktree
/// changes before integration starts; a safety-net commit in
/// `run_background_integration` catches any stragglers).
///
/// The caller is responsible for recording the result via `apply_integration_result`.
pub fn perform_git_integration(
    git: &dyn GitService,
    params: &IntegrationParams,
) -> IntegrationGitResult {
    // Rebase onto target branch
    if let Some(worktree_path) = &params.worktree_path {
        let worktree = Path::new(worktree_path);
        if worktree.exists() {
            match git.rebase_on_branch(worktree, &params.target_branch) {
                Ok(()) => {
                    orkestra_debug!(
                        "integration",
                        "rebased {}: branch {} onto {}",
                        params.task_id,
                        params.branch_name,
                        params.target_branch
                    );
                }
                Err(GitError::MergeConflict { conflict_files, .. }) => {
                    orkestra_debug!(
                        "integration",
                        "failed {}: rebase conflict, {} files",
                        params.task_id,
                        conflict_files.len()
                    );
                    return IntegrationGitResult::RebaseConflict { conflict_files };
                }
                Err(e) => {
                    orkestra_debug!(
                        "integration",
                        "failed {}: rebase error: {}",
                        params.task_id,
                        e
                    );
                    return IntegrationGitResult::RebaseError(format!(
                        "Failed to rebase branch on {}: {e}",
                        params.target_branch
                    ));
                }
            }
        } else {
            orkestra_debug!(
                "integration",
                "worktree missing for {}, skipping rebase",
                params.task_id
            );
        }
    }

    // Fast-forward merge to target branch
    match git.merge_to_branch(&params.branch_name, &params.target_branch) {
        Ok(_merge_result) => {
            orkestra_debug!(
                "integration",
                "completed {}: merge succeeded",
                params.task_id
            );
            IntegrationGitResult::Success
        }
        Err(e) => {
            orkestra_debug!("integration", "failed {}: {}", params.task_id, e);
            IntegrationGitResult::MergeError(format!("{e}"))
        }
    }
}

impl WorkflowApi {
    /// Merge a Done task's branch into its base branch (user-triggered).
    ///
    /// This is the explicit merge path when `auto_merge` is disabled.
    /// Delegates to existing `integrate_task()` after validation.
    pub fn merge_task(&self, task_id: &str) -> WorkflowResult<Task> {
        let task = self.get_task(task_id)?;
        if !task.is_done() {
            return Err(WorkflowError::InvalidTransition(
                "Can only merge Done tasks".into(),
            ));
        }
        if task.phase != Phase::Idle {
            return Err(WorkflowError::InvalidTransition(format!(
                "Task must be Idle to merge, but is {:?}",
                task.phase
            )));
        }
        validate_no_open_pr(&task)?;
        self.integrate_task(task_id)
    }

    /// Begin PR creation for a Done task.
    ///
    /// Marks the task as Integrating and returns it. The caller is responsible for
    /// spawning the background PR creation thread.
    pub fn begin_pr_creation(&self, task_id: &str) -> WorkflowResult<Task> {
        // Fail fast if no PR service configured
        if self.pr_service.is_none() {
            return Err(WorkflowError::GitError(
                "No PR service configured — cannot create PR".into(),
            ));
        }

        let task = self.get_task(task_id)?;
        if !task.is_done() {
            return Err(WorkflowError::InvalidTransition(
                "Can only open PR for Done tasks".into(),
            ));
        }
        if task.phase != Phase::Idle {
            return Err(WorkflowError::InvalidTransition(format!(
                "Task must be Idle to open PR, but is {:?}",
                task.phase
            )));
        }
        validate_no_open_pr(&task)?;
        self.mark_integrating(task_id)
    }

    /// Retry PR creation by recovering from Failed state back to Done+Idle.
    ///
    /// Unlike `retry()` (which restores to Active { `last_stage` }), this restores
    /// to Done+Idle — the integration choice point — so the user can attempt
    /// "Open PR" or "Merge" again.
    pub fn retry_pr_creation(&self, task_id: &str) -> WorkflowResult<Task> {
        let mut task = self.get_task(task_id)?;
        if !matches!(task.status, Status::Failed { .. }) {
            return Err(WorkflowError::InvalidTransition(
                "Can only retry PR creation for Failed tasks".into(),
            ));
        }
        task.status = Status::Done;
        task.phase = Phase::Idle;
        task.updated_at = chrono::Utc::now().to_rfc3339();
        self.store.save_task(&task)?;
        Ok(task)
    }

    /// Record successful PR creation.
    pub fn pr_creation_succeeded(&self, task_id: &str, pr_url: &str) -> WorkflowResult<Task> {
        let mut task = self.get_task(task_id)?;
        task.pr_url = Some(pr_url.to_string());
        task.phase = Phase::Idle; // Back to Idle — task stays Done with PR link
        task.updated_at = chrono::Utc::now().to_rfc3339();
        self.store.save_task(&task)?;
        Ok(task)
    }

    /// Record failed PR creation. Task transitions to Failed with error message.
    pub fn pr_creation_failed(&self, task_id: &str, error: &str) -> WorkflowResult<Task> {
        let mut task = self.get_task(task_id)?;
        task.status = Status::failed(format!("PR creation failed: {error}"));
        task.phase = Phase::Idle;
        task.updated_at = chrono::Utc::now().to_rfc3339();
        self.store.save_task(&task)?;
        Ok(task)
    }

    /// Attempt to integrate a completed task by merging its branch to primary.
    ///
    /// This method orchestrates the full integration process:
    /// 1. Commits any pending changes in the worktree
    /// 2. Rebases the task branch onto primary (conflicts stay on the task branch)
    /// 3. Fast-forward merges the rebased branch to primary
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

        // Safety-net commit — the Finishing → Committing → Finished pipeline normally
        // commits worktree changes before integration starts. This catches edge cases
        // from direct `integrate_task` calls (e.g., manual recovery, tests).
        // No-op if the worktree is already clean.
        if let Err(e) = super::commit_worktree::commit_worktree_changes(
            git.as_ref(),
            &task,
            "integrating",
            None,
        ) {
            let error_msg = format!("Failed to commit pending changes: {e}");
            self.integration_failed(task_id, &error_msg, &[])?;
            return Err(WorkflowError::IntegrationFailed(error_msg));
        }

        // Squash commits for top-level tasks (subtasks keep individual commits).
        if task.parent_id.is_none() {
            if let Some(worktree_path) = &task.worktree_path {
                let squash_message = super::commit_worktree::generate_squash_commit_message(
                    git.as_ref(),
                    &task,
                    &self.workflow,
                    self.commit_message_generator.as_ref(),
                );
                if let Err(e) =
                    git.squash_commits(Path::new(worktree_path), &task.base_branch, &squash_message)
                {
                    let error_msg = format!("Failed to squash commits: {e}");
                    self.integration_failed(task_id, &error_msg, &[])?;
                    return Err(WorkflowError::IntegrationFailed(error_msg));
                }
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

        let params = IntegrationParams {
            task_id: task.id.clone(),
            branch_name: branch_name.clone(),
            target_branch,
            worktree_path: task.worktree_path.as_ref().map(PathBuf::from),
        };
        let result = perform_git_integration(git.as_ref(), &params);
        self.apply_integration_result(task_id, result, task.worktree_path.is_some())
    }

    /// Apply the result of a background git integration.
    ///
    /// Called from the background thread after `perform_git_integration` completes.
    /// Records success (archive + worktree cleanup) or failure (recovery stage).
    pub fn apply_integration_result(
        &self,
        task_id: &str,
        result: IntegrationGitResult,
        has_worktree: bool,
    ) -> WorkflowResult<Task> {
        match result {
            IntegrationGitResult::Success => {
                // Update DB FIRST — critical state change.
                let task = self.integration_succeeded(task_id)?;
                // Then clean up worktree (non-critical).
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
            .ok_or_else(|| {
                WorkflowError::InvalidTransition("No recovery stage configured".into())
            })?;

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
