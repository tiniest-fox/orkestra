//! Merge integration workflow — thread spawning and lock management.
//!
//! Contains the non-blocking wrappers that run the git integration pipeline
//! on background threads. The actual git work lives in
//! `interactions/squash_rebase_merge.rs`.

use std::sync::{Arc, Mutex};

use crate::workflow::api::WorkflowApi;
use crate::workflow::config::WorkflowConfig;
use crate::workflow::domain::Task;
use crate::workflow::ports::{WorkflowError, WorkflowResult};
use crate::CommitMessageGenerator;

use super::service::IntegrationGitResult;
use crate::workflow::workflow_warn;

// ============================================================================
// Types
// ============================================================================

/// Result of [`prepare_merge_integration`]: either the inputs needed for git
/// work, or the already-finalized task (when no git service or no branch).
enum MergePreparation {
    /// Git work is needed — extracted inputs for the background/inline pipeline.
    NeedsGitWork {
        task: Box<Task>,
        git: Arc<dyn crate::workflow::ports::GitService>,
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
/// `on_complete` is called after the background thread finishes (success or failure).
#[allow(clippy::needless_pass_by_value)]
pub fn spawn_merge_integration(
    api: Arc<Mutex<WorkflowApi>>,
    task_id: &str,
    on_complete: impl FnOnce() + Send + 'static,
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
        on_complete();
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

/// Run the integration pipeline on a background thread and record the result.
///
/// Called from both the orchestrator (auto-merge) and user-triggered merge
/// (`spawn_merge_integration`). Delegates to the `squash_rebase_merge`
/// interaction for the actual git work.
#[allow(clippy::needless_pass_by_value)]
pub(crate) fn run_integration(
    git: Arc<dyn crate::workflow::ports::GitService>,
    api: Arc<Mutex<WorkflowApi>>,
    commit_message_generator: Arc<dyn CommitMessageGenerator>,
    task: Task,
    workflow: WorkflowConfig,
) {
    let task_id = task.id.clone();
    let has_worktree = task.worktree_path.is_some();
    let result = super::interactions::squash_rebase_merge::execute(
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
