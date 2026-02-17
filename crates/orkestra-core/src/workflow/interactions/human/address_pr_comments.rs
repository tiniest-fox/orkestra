//! Address PR comments by returning to a recovery stage.

use crate::orkestra_debug;
use crate::workflow::config::WorkflowConfig;
use crate::workflow::domain::{IterationTrigger, PrCommentData, Task};
use crate::workflow::ports::{WorkflowError, WorkflowResult, WorkflowStore};
use crate::workflow::runtime::{Phase, Status};
use crate::workflow::services::IterationService;

pub fn execute(
    store: &dyn WorkflowStore,
    workflow: &WorkflowConfig,
    iteration_service: &IterationService,
    task_id: &str,
    comments: Vec<PrCommentData>,
    guidance: Option<String>,
) -> WorkflowResult<Task> {
    // Validate at least one comment is provided
    if comments.is_empty() {
        return Err(WorkflowError::InvalidTransition(
            "At least one comment must be selected".into(),
        ));
    }

    let mut task = store
        .get_task(task_id)?
        .ok_or_else(|| WorkflowError::TaskNotFound(task_id.into()))?;

    let recovery_stage = resolve_recovery_stage(workflow, task.flow.as_deref())?;

    // Validate task state
    if !task.is_done() {
        return Err(WorkflowError::InvalidTransition(format!(
            "Task {task_id} is not done, cannot address PR comments"
        )));
    }
    if task.phase != Phase::Idle {
        return Err(WorkflowError::InvalidTransition(format!(
            "Task {task_id} is not idle, cannot address PR comments"
        )));
    }

    orkestra_debug!(
        "action",
        "address_pr_comments {}: returning to {} stage with {} comments",
        task_id,
        recovery_stage,
        comments.len()
    );

    // Create new iteration with PR comments trigger
    iteration_service.create_iteration(
        task_id,
        &recovery_stage,
        Some(IterationTrigger::PrComments { comments, guidance }),
    )?;

    // Update task to recovery stage in Idle phase
    let now = chrono::Utc::now().to_rfc3339();
    task.status = Status::active(&recovery_stage);
    task.phase = Phase::Idle;
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
