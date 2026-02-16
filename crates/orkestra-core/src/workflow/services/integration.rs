//! Git integration operations: success/failure handling.

use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};

use crate::orkestra_debug;
use crate::pr_description::PrDescriptionGenerator;
use crate::workflow::config::WorkflowConfig;
use crate::workflow::domain::{IterationTrigger, Task};
use crate::workflow::ports::{GitError, GitService, PrService, WorkflowError, WorkflowResult};
use crate::workflow::runtime::{Outcome, Phase, Status};
use crate::CommitMessageGenerator;

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
struct IntegrationParams {
    task_id: String,
    branch_name: String,
    target_branch: String,
    worktree_path: Option<PathBuf>,
}

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

/// Perform the git work for integration without holding the API lock.
///
/// Rebases onto the target branch and merges. Committing is handled by the
/// caller (the Finishing → Committing → Finished pipeline commits worktree
/// changes before integration starts; a safety-net commit in
/// `run_background_integration` catches any stragglers).
///
/// The caller is responsible for recording the result via `apply_integration_result`.
fn perform_git_integration(
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

            // Push updated base branch to remote (skip for subtask branches)
            if !params.target_branch.starts_with("task/") {
                if let Err(e) = git.push_branch(&params.target_branch) {
                    orkestra_debug!(
                        "integration",
                        "failed to push {} after merge for {}: {} (continuing anyway)",
                        params.target_branch,
                        params.task_id,
                        e
                    );
                } else {
                    orkestra_debug!(
                        "integration",
                        "pushed {} to remote after merge for {}",
                        params.target_branch,
                        params.task_id
                    );
                }
            }

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
    /// Validates preconditions and marks the task as `Integrating`.
    /// The actual git work (squash, rebase, merge) runs on a background thread
    /// via [`spawn_merge_integration`].
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
        self.mark_integrating(task_id)
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
    /// Runs the full commit → squash → rebase → merge pipeline synchronously
    /// while holding the API lock. Used for startup recovery of stuck tasks.
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

        let Some(git) = &self.git_service else {
            return self.integration_succeeded(task_id);
        };

        if task.branch_name.is_none() {
            return self.integration_succeeded(task_id);
        }

        let result = commit_squash_rebase_merge(
            git.as_ref(),
            &task,
            &self.workflow,
            self.commit_message_generator.as_ref(),
        );
        self.apply_integration_result(task_id, result, task.worktree_path.is_some())
    }

    /// Apply the result of a background git integration.
    ///
    /// Called from the background thread after `perform_git_integration` completes.
    /// Records success (archive + worktree cleanup) or failure (recovery stage).
    pub(crate) fn apply_integration_result(
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

// ============================================================================
// Non-blocking merge integration
// ============================================================================

/// Result of [`prepare_merge_integration`]: either the inputs needed for git
/// work, or the already-finalized task (when no git service or no branch).
enum MergePreparation {
    /// Git work is needed — extracted inputs for the background/inline pipeline.
    NeedsGitWork {
        task: Box<Task>,
        git: Arc<dyn GitService>,
        workflow: WorkflowConfig,
        commit_gen: Arc<dyn CommitMessageGenerator>,
    },
    /// No git work needed — task is already in its final state.
    AlreadyComplete,
}

/// Validate, mark as integrating, and extract everything needed for git work.
///
/// Shared setup logic for both `spawn_merge_integration` (async) and
/// `merge_task_sync` (inline). Returns [`MergePreparation::NeedsGitWork`]
/// with the extracted dependencies, or [`MergePreparation::AlreadyComplete`]
/// if no git work is needed.
fn prepare_merge_integration(
    api: &Mutex<WorkflowApi>,
    task_id: &str,
) -> WorkflowResult<MergePreparation> {
    let api = api.lock().map_err(|_| WorkflowError::Lock)?;
    let task = api.merge_task(task_id)?;

    let Some(git) = api.git_service() else {
        api.integration_succeeded(task_id)?;
        return Ok(MergePreparation::AlreadyComplete);
    };
    let git = Arc::clone(git);

    if task.branch_name.is_none() {
        api.integration_succeeded(task_id)?;
        return Ok(MergePreparation::AlreadyComplete);
    }

    let workflow = api.workflow().clone();
    let commit_gen = Arc::clone(api.commit_message_generator());
    Ok(MergePreparation::NeedsGitWork {
        task: Box::new(task),
        git,
        workflow,
        commit_gen,
    })
}

/// Validate, mark as integrating, then run git work on a background thread.
///
/// Returns the task in `Done + Integrating` state. The actual squash/rebase/merge
/// runs on a spawned thread so the caller (Tauri UI) is not blocked.
#[allow(clippy::needless_pass_by_value)]
pub fn spawn_merge_integration(
    api: Arc<Mutex<WorkflowApi>>,
    task_id: &str,
) -> WorkflowResult<Task> {
    let MergePreparation::NeedsGitWork {
        task,
        git,
        workflow,
        commit_gen,
    } = prepare_merge_integration(&api, task_id)?
    else {
        // Already complete (no git service or no branch) — re-read final state
        let api = api.lock().map_err(|_| WorkflowError::Lock)?;
        return api.get_task(task_id);
    };

    let result_task = (*task).clone();
    let api_for_thread = Arc::clone(&api);

    std::thread::spawn(move || {
        run_integration(git, api_for_thread, commit_gen, *task, workflow);
    });

    Ok(result_task)
}

/// Validate, mark as integrating, run the full git pipeline inline, and return
/// the final task state (re-read from the store).
///
/// Used by tests and the CLI where synchronous execution is needed.
#[allow(clippy::needless_pass_by_value)]
pub fn merge_task_sync(api: Arc<Mutex<WorkflowApi>>, task_id: &str) -> WorkflowResult<Task> {
    let MergePreparation::NeedsGitWork {
        task,
        git,
        workflow,
        commit_gen,
    } = prepare_merge_integration(&api, task_id)?
    else {
        // Already complete (no git service or no branch) — re-read final state
        let api = api.lock().map_err(|_| WorkflowError::Lock)?;
        return api.get_task(task_id);
    };

    run_integration(git, Arc::clone(&api), commit_gen, *task, workflow);

    // Re-read the task from the store to return the correct final state
    let api = api.lock().map_err(|_| WorkflowError::Lock)?;
    api.get_task(task_id)
}

/// Safety-net commit → squash (top-level only) → rebase → merge.
///
/// Pure git work — no API lock needed. Returns an `IntegrationGitResult` that
/// the caller records via `apply_integration_result` (sync) or `record_result` (background).
fn commit_squash_rebase_merge(
    git: &dyn GitService,
    task: &Task,
    workflow: &WorkflowConfig,
    commit_message_generator: &dyn CommitMessageGenerator,
) -> IntegrationGitResult {
    let task_id = &task.id;

    if task.base_branch.is_empty() {
        return IntegrationGitResult::CommitError(format!(
            "Task {} has no base_branch set — cannot determine merge target",
            task.id
        ));
    }

    // Safety-net commit — should be a no-op after the Finishing pipeline,
    // but catches stragglers from manual recovery or direct API calls.
    if let Err(e) = super::commit_worktree::commit_worktree_changes(git, task, "integrating", None)
    {
        let error_msg = format!("Failed to commit pending changes: {e}");
        orkestra_debug!(
            "integration",
            "safety-net commit failed for {}: {}",
            task_id,
            error_msg
        );
        return IntegrationGitResult::CommitError(error_msg);
    }

    // Squash commits for top-level tasks (subtasks keep individual commits).
    if task.parent_id.is_none() {
        if let Some(worktree_path) = &task.worktree_path {
            let squash_message = super::commit_worktree::generate_squash_commit_message(
                git,
                task,
                workflow,
                commit_message_generator,
            );
            match git.squash_commits(Path::new(worktree_path), &task.base_branch, &squash_message) {
                Ok(squashed) => {
                    if squashed {
                        orkestra_debug!("integration", "squashed commits for task {}", task_id);
                    }
                }
                Err(e) => {
                    let error_msg = format!("Failed to squash commits: {e}");
                    orkestra_debug!(
                        "integration",
                        "squash failed for {}: {}",
                        task_id,
                        error_msg
                    );
                    return IntegrationGitResult::CommitError(error_msg);
                }
            }
        }
    }

    let Some(branch_name) = task.branch_name.clone() else {
        return IntegrationGitResult::CommitError(format!(
            "Task {} has no branch_name — cannot integrate",
            task.id
        ));
    };

    // Sync base branch from remote (skip for subtask branches on parent's local branch)
    if !task.base_branch.starts_with("task/") {
        if let Err(e) = git.sync_base_branch(&task.base_branch) {
            orkestra_debug!(
                "integration",
                "failed to sync {} before rebase for {}: {} (continuing anyway)",
                task.base_branch,
                task_id,
                e
            );
        } else {
            orkestra_debug!(
                "integration",
                "synced {} from remote before rebase for {}",
                task.base_branch,
                task_id
            );
        }
    }

    let params = IntegrationParams {
        task_id: task_id.clone(),
        branch_name,
        target_branch: task.base_branch.clone(),
        worktree_path: task.worktree_path.as_ref().map(PathBuf::from),
    };

    perform_git_integration(git, &params)
}

/// Run the integration pipeline on a background thread and record the result.
///
/// Called from both the orchestrator (auto-merge) and user-triggered merge
/// (`spawn_merge_integration`). Delegates to [`commit_squash_rebase_merge`]
/// for the actual git work.
#[allow(clippy::needless_pass_by_value)]
pub(crate) fn run_integration(
    git: Arc<dyn GitService>,
    api: Arc<Mutex<WorkflowApi>>,
    commit_message_generator: Arc<dyn CommitMessageGenerator>,
    task: Task,
    workflow: WorkflowConfig,
) {
    let task_id = task.id.clone();
    let has_worktree = task.worktree_path.is_some();
    let result = commit_squash_rebase_merge(
        git.as_ref(),
        &task,
        &workflow,
        commit_message_generator.as_ref(),
    );
    record_result(&api, &task_id, result, has_worktree);
}

/// Record an integration result (success or failure) by acquiring the API lock.
fn record_result(
    api: &Arc<Mutex<WorkflowApi>>,
    task_id: &str,
    git_result: IntegrationGitResult,
    has_worktree: bool,
) {
    match api.lock() {
        Ok(api) => {
            if let Err(e) = api.apply_integration_result(task_id, git_result, has_worktree) {
                workflow_warn!("integration failed for {}: {}", task_id, e);
            }
        }
        Err(_) => {
            workflow_warn!(
                "API lock poisoned after git work for {} — task stuck in Integrating, will be recovered on restart",
                task_id
            );
        }
    }
}

// ============================================================================
// Non-blocking PR creation
// ============================================================================

/// Result of [`prepare_pr_creation`]: either the inputs needed for background
/// PR work, or an error (no PR service, task not eligible).
enum PrPreparation {
    /// PR work is needed — extracted inputs for the background/inline pipeline.
    NeedsPrWork {
        task: Box<Task>,
        git: Arc<dyn GitService>,
        pr_service: Arc<dyn PrService>,
        pr_description_generator: Arc<dyn PrDescriptionGenerator>,
        model_names: Vec<String>,
    },
}

/// Validate, mark as integrating, and extract everything needed for PR creation.
///
/// Shared setup logic for both `spawn_pr_creation` (async) and
/// `create_pr_sync` (inline).
fn prepare_pr_creation(api: &Mutex<WorkflowApi>, task_id: &str) -> WorkflowResult<PrPreparation> {
    let api = api.lock().map_err(|_| WorkflowError::Lock)?;
    let task = api.begin_pr_creation(task_id)?;

    let git = api
        .git_service()
        .cloned()
        .ok_or_else(|| WorkflowError::GitError("No git service configured".into()))?;
    let pr_service = api
        .pr_service
        .clone()
        .ok_or_else(|| WorkflowError::GitError("No PR service configured".into()))?;
    let pr_description_generator = Arc::clone(&api.pr_description_generator);

    // Collect model names for attribution footer
    let model_names =
        crate::commit_message::collect_model_names(&api.workflow, task.flow.as_deref());

    Ok(PrPreparation::NeedsPrWork {
        task: Box::new(task),
        git,
        pr_service,
        pr_description_generator,
        model_names,
    })
}

/// Validate, mark as integrating, then run PR creation on a background thread.
///
/// Returns the task in `Done + Integrating` state. The actual commit/push/PR
/// runs on a spawned thread so the caller (Tauri UI) is not blocked.
#[allow(clippy::needless_pass_by_value)]
pub fn spawn_pr_creation(api: Arc<Mutex<WorkflowApi>>, task_id: &str) -> WorkflowResult<Task> {
    let PrPreparation::NeedsPrWork {
        task,
        git,
        pr_service,
        pr_description_generator,
        model_names,
    } = prepare_pr_creation(&api, task_id)?;

    let result_task = (*task).clone();
    let api_for_thread = Arc::clone(&api);

    std::thread::spawn(move || {
        run_pr_creation(
            git,
            pr_service,
            pr_description_generator,
            api_for_thread,
            *task,
            model_names,
        );
    });

    Ok(result_task)
}

/// Validate, mark as integrating, run the full PR pipeline inline, and return
/// the final task state (re-read from the store).
///
/// Used by the CLI where synchronous execution is needed.
#[allow(clippy::needless_pass_by_value)]
pub fn create_pr_sync(api: Arc<Mutex<WorkflowApi>>, task_id: &str) -> WorkflowResult<Task> {
    let PrPreparation::NeedsPrWork {
        task,
        git,
        pr_service,
        pr_description_generator,
        model_names,
    } = prepare_pr_creation(&api, task_id)?;

    run_pr_creation(
        git,
        pr_service,
        pr_description_generator,
        Arc::clone(&api),
        *task,
        model_names,
    );

    // Re-read the task from the store to return the correct final state
    let api = api.lock().map_err(|_| WorkflowError::Lock)?;
    api.get_task(task_id)
}

/// Perform commit, push, and PR creation, then record the result.
///
/// Pure background work — acquires the API lock only briefly to record success/failure.
#[allow(clippy::needless_pass_by_value)]
fn run_pr_creation(
    git: Arc<dyn GitService>,
    pr_service: Arc<dyn PrService>,
    pr_description_generator: Arc<dyn PrDescriptionGenerator>,
    api: Arc<Mutex<WorkflowApi>>,
    task: Task,
    model_names: Vec<String>,
) {
    let task_id = task.id.clone();
    let branch = task.branch_name.clone().unwrap_or_default();
    let base_branch = task.base_branch.clone();

    // 1. Safety-net commit
    if let Err(e) =
        super::commit_worktree::commit_worktree_changes(git.as_ref(), &task, "integrating", None)
    {
        if let Ok(api) = api.lock() {
            let _ = api.pr_creation_failed(&task_id, &format!("Commit failed: {e}"));
        }
        return;
    }

    // 2. Push branch
    if let Err(e) = git.push_branch(&branch) {
        if let Ok(api) = api.lock() {
            let _ = api.pr_creation_failed(&task_id, &e.to_string());
        }
        return;
    }

    // 3. Generate PR description (with fallback on failure)
    let diff_summary = super::commit_worktree::build_diff_summary(git.as_ref(), &task);

    // Get plan artifact if available for richer PR body
    let plan_artifact = task.artifacts.get("plan").map(|a| a.content.as_str());

    let (pr_title, pr_body) = pr_description_generator
        .generate_pr_description(
            &task.title,
            &task.description,
            plan_artifact,
            &diff_summary,
            &base_branch,
            &model_names,
        )
        .unwrap_or_else(|_| {
            // Fallback: use task title and basic body with new format + footer
            let body = format!(
                "## Summary\n\n{}\n\n## Decisions\n\n_AI generation failed_\n\n## Verification\n\n_Manual verification required_{}",
                task.description,
                crate::pr_description::format_pr_footer(&model_names)
            );
            (task.title.clone(), body)
        });

    // 4. Create PR (idempotent — checks for existing PR first)
    let repo_root = task
        .worktree_path
        .as_deref()
        .map_or_else(|| std::path::Path::new("."), std::path::Path::new);
    match pr_service.create_pull_request(repo_root, &branch, &base_branch, &pr_title, &pr_body) {
        Ok(pr_url) => {
            if let Ok(api) = api.lock() {
                let _ = api.pr_creation_succeeded(&task_id, &pr_url);
            }
        }
        Err(e) => {
            if let Ok(api) = api.lock() {
                let _ = api.pr_creation_failed(&task_id, &e.to_string());
            }
        }
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
