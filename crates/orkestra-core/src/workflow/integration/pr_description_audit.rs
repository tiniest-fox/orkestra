//! PR description audit — thread spawning and lock management.
//!
//! Contains the non-blocking wrapper that runs the PR description audit
//! on a background thread. The actual audit logic lives in
//! `interactions/audit_pr_description.rs`.

use std::sync::{Arc, Mutex};

use crate::pr_description::PrDescriptionGenerator;
use crate::workflow::api::WorkflowApi;
use crate::workflow::domain::Task;
use crate::workflow::ports::{GitService, PrService, WorkflowError, WorkflowResult};

// ============================================================================
// Types
// ============================================================================

/// Inputs gathered while holding the API lock, consumed by the background thread.
struct AuditInputs {
    task: Box<Task>,
    git: Arc<dyn GitService>,
    pr_service: Arc<dyn PrService>,
    pr_description_generator: Arc<dyn PrDescriptionGenerator>,
}

// ============================================================================
// Public API
// ============================================================================

/// Gather inputs under lock, then spawn background audit thread.
///
/// Returns immediately. The audit is best-effort — all failures are logged.
/// If the task is not eligible for audit (no open PR, no branch, etc.),
/// returns silently.
pub fn spawn_pr_description_audit(api: &Arc<Mutex<WorkflowApi>>, task_id: &str) {
    let Ok(inputs) = gather_audit_inputs(api, task_id) else {
        return; // Not eligible for audit — silently skip
    };

    std::thread::spawn(move || {
        run_audit(&inputs);
    });
}

/// Run the audit synchronously (for CLI, where the process would exit
/// before a background thread completes).
pub fn audit_pr_description_sync(api: &Mutex<WorkflowApi>, task_id: &str) {
    let Ok(inputs) = gather_audit_inputs(api, task_id) else {
        return;
    };
    run_audit(&inputs);
}

// ============================================================================
// Helpers
// ============================================================================

fn run_audit(inputs: &AuditInputs) {
    let task_id = inputs.task.id.clone();
    if let Err(reason) = super::interactions::audit_pr_description::execute(
        inputs.git.as_ref(),
        inputs.pr_service.as_ref(),
        inputs.pr_description_generator.as_ref(),
        &inputs.task,
    ) {
        crate::orkestra_debug!(
            "pr_audit",
            "PR description audit skipped for {task_id}: {reason}"
        );
    }
}

fn gather_audit_inputs(api: &Mutex<WorkflowApi>, task_id: &str) -> WorkflowResult<AuditInputs> {
    let api = api.lock().map_err(|_| WorkflowError::Lock)?;

    let task = api.get_task(task_id)?;
    if !task.has_open_pr() {
        return Err(WorkflowError::InvalidTransition(
            "Task has no open PR".into(),
        ));
    }

    let git = api
        .git_service()
        .cloned()
        .ok_or_else(|| WorkflowError::GitError("No git service".into()))?;
    let pr_service = api
        .pr_service
        .clone()
        .ok_or_else(|| WorkflowError::GitError("No PR service".into()))?;
    let pr_description_generator = Arc::clone(&api.pr_description_generator);

    // Lock is dropped when `api` goes out of scope here
    Ok(AuditInputs {
        task: Box::new(task),
        git,
        pr_service,
        pr_description_generator,
    })
}
