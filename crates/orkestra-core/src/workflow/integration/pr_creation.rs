//! PR creation workflow.
//!
//! TODO: Decompose into interactions with a single entry point:
//! - `interactions/create_pull_request.rs` — commit → push → describe → create PR → record
//!
//! Then `spawn_pr_creation()` and `create_pr_sync()` become thin dispatchers in `service.rs`.
//!
//! Contains the pull request creation pipeline (commit → push → describe → create PR)
//! and the non-blocking wrapper that runs it on a background thread.

use std::sync::{Arc, Mutex};

use crate::pr_description::PrDescriptionGenerator;
use crate::workflow::api::WorkflowApi;
use crate::workflow::domain::Task;
use crate::workflow::ports::{GitService, PrService, WorkflowError, WorkflowResult};

// ============================================================================
// Types
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
pub(crate) fn run_pr_creation(
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
    if let Err(e) = super::commit::commit_worktree_changes(git.as_ref(), &task, "integrating", None)
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
    let diff_summary = super::commit::build_diff_summary(git.as_ref(), &task);

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

// ============================================================================
// Helpers
// ============================================================================

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
