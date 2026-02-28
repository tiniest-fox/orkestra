//! Address PR feedback (comments and/or failed checks) by returning to a recovery stage.

use crate::orkestra_debug;
use crate::workflow::config::WorkflowConfig;
use crate::workflow::domain::{IterationTrigger, PrCheckData, PrCommentData, Task};
use crate::workflow::iteration::IterationService;
use crate::workflow::ports::{WorkflowError, WorkflowResult, WorkflowStore};
use crate::workflow::runtime::TaskState;

pub fn execute(
    store: &dyn WorkflowStore,
    workflow: &WorkflowConfig,
    iteration_service: &IterationService,
    task_id: &str,
    comments: Vec<PrCommentData>,
    checks: Vec<PrCheckData>,
    guidance: Option<String>,
) -> WorkflowResult<Task> {
    // Validate at least one comment or check is provided
    if comments.is_empty() && checks.is_empty() {
        return Err(WorkflowError::InvalidTransition(
            "At least one comment or check must be selected".into(),
        ));
    }

    let mut task = store
        .get_task(task_id)?
        .ok_or_else(|| WorkflowError::TaskNotFound(task_id.into()))?;

    let recovery_stage = resolve_recovery_stage(workflow, task.flow.as_deref())?;

    // Validate task state
    if !task.is_done() {
        return Err(WorkflowError::InvalidTransition(format!(
            "Task {task_id} is not done, cannot address PR feedback"
        )));
    }

    orkestra_debug!(
        "action",
        "address_pr_feedback {}: returning to {} stage with {} comments and {} checks",
        task_id,
        recovery_stage,
        comments.len(),
        checks.len()
    );

    // Create new iteration with PR feedback trigger
    iteration_service.create_iteration(
        task_id,
        &recovery_stage,
        Some(IterationTrigger::PrFeedback {
            comments,
            checks,
            guidance,
        }),
    )?;

    // Update task to recovery stage in Queued state
    let now = chrono::Utc::now().to_rfc3339();
    task.state = TaskState::queued(&recovery_stage);
    task.completed_at = None;
    task.updated_at = now;

    store.save_task(&task)?;
    Ok(task)
}

// -- Helpers --

fn resolve_recovery_stage(workflow: &WorkflowConfig, flow: Option<&str>) -> WorkflowResult<String> {
    let configured = workflow.effective_integration_on_failure(flow);
    if workflow.stage_in_flow(configured, flow) {
        return Ok(configured.to_string());
    }
    workflow
        .first_stage_in_flow(flow)
        .map(|s| s.name.clone())
        .ok_or_else(|| WorkflowError::InvalidTransition("No recovery stage configured".into()))
}
