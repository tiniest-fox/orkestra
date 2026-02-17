//! Merge integration workflow.
//!
//! TODO: Decompose into interactions with a single entry point:
//! - `interactions/squash_rebase_merge.rs` — the pure git pipeline
//! - `interactions/prepare_merge.rs` — validate + extract params
//!
//! Then `spawn_merge_integration()` and `merge_task_sync()` become thin
//! dispatchers in `service.rs`.
//!
//! Contains the git merge pipeline (commit → squash → rebase → merge) and
//! the non-blocking wrapper that runs it on a background thread.

use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};

use crate::orkestra_debug;
use crate::workflow::api::WorkflowApi;
use crate::workflow::config::WorkflowConfig;
use crate::workflow::domain::Task;
use crate::workflow::ports::{GitError, GitService, WorkflowError, WorkflowResult};
use crate::CommitMessageGenerator;

use super::service::IntegrationGitResult;
use crate::workflow::workflow_warn;

// ============================================================================
// Types
// ============================================================================

/// Parameters needed to perform git integration without holding the API lock.
struct IntegrationParams {
    task_id: String,
    branch_name: String,
    target_branch: String,
    worktree_path: Option<PathBuf>,
}

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

// ============================================================================
// Public API
// ============================================================================

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
pub(super) fn commit_squash_rebase_merge(
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
    if let Err(e) = super::commit::commit_worktree_changes(git, task, "integrating", None) {
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
            let squash_message = super::commit::generate_squash_commit_message(
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

// ============================================================================
// Helpers
// ============================================================================

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
