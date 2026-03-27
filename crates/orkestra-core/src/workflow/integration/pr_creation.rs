//! PR creation workflow — thread spawning and lock management.
//!
//! Contains the non-blocking wrappers that run the PR creation pipeline
//! on background threads. The actual pipeline logic lives in
//! `interactions/create_pull_request.rs`.

use std::sync::{Arc, Mutex};

use crate::pr_description::{PrArtifact, PrDescriptionGenerator};
use crate::workflow::api::WorkflowApi;
use crate::workflow::domain::Task;
use crate::workflow::ports::{GitService, PrService, WorkflowError, WorkflowResult};

// ============================================================================
// Types
// ============================================================================

/// Result of [`prepare_pr_creation`]: the inputs needed for background PR work.
enum PrPreparation {
    /// PR work is needed — extracted inputs for the background/inline pipeline.
    NeedsPrWork {
        task: Box<Task>,
        git: Arc<dyn GitService>,
        pr_service: Arc<dyn PrService>,
        pr_description_generator: Arc<dyn PrDescriptionGenerator>,
        model_names: Vec<String>,
        artifacts: Vec<PrArtifact>,
    },
}

// ============================================================================
// Public API
// ============================================================================

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
        artifacts,
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
            artifacts,
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
        artifacts,
    } = prepare_pr_creation(&api, task_id)?;

    run_pr_creation(
        git,
        pr_service,
        pr_description_generator,
        Arc::clone(&api),
        *task,
        model_names,
        artifacts,
    );

    // Re-read the task from the store to return the correct final state
    let api = api.lock().map_err(|_| WorkflowError::Lock)?;
    api.get_task(task_id)
}

/// Run the PR creation interaction and record the result.
///
/// Acquires the API lock only briefly to record success/failure.
#[allow(clippy::needless_pass_by_value)]
pub(crate) fn run_pr_creation(
    git: Arc<dyn GitService>,
    pr_service: Arc<dyn PrService>,
    pr_description_generator: Arc<dyn PrDescriptionGenerator>,
    api: Arc<Mutex<WorkflowApi>>,
    task: Task,
    model_names: Vec<String>,
    artifacts: Vec<PrArtifact>,
) {
    let task_id = task.id.clone();

    match super::interactions::create_pull_request::execute(
        git.as_ref(),
        pr_service.as_ref(),
        pr_description_generator.as_ref(),
        &task,
        &model_names,
        &artifacts,
    ) {
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

// ============================================================================
// Helpers
// ============================================================================

/// Validate, mark as integrating, and extract everything needed for PR creation.
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

    // Collect artifacts with descriptions while holding the lock (workflow is available here).
    let artifacts = super::interactions::collect_pr_artifacts::execute(&api.workflow, &task);

    Ok(PrPreparation::NeedsPrWork {
        task: Box::new(task),
        git,
        pr_service,
        pr_description_generator,
        model_names,
        artifacts,
    })
}
