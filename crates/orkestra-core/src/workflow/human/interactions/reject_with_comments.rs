//! Reject an `AwaitingApproval` task with line-level comments, routing to the rejection target stage.

use crate::orkestra_debug;
use crate::workflow::config::WorkflowConfig;
use crate::workflow::domain::{IterationTrigger, PrCommentData, Task};
use crate::workflow::iteration::IterationService;
use crate::workflow::ports::{WorkflowError, WorkflowResult, WorkflowStore};
use crate::workflow::runtime::{Outcome, TaskState};
use crate::workflow::stage::interactions as stage;

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
            "At least one comment must be provided".into(),
        ));
    }

    let mut task = store
        .get_task(task_id)?
        .ok_or_else(|| WorkflowError::TaskNotFound(task_id.into()))?;

    if !matches!(
        task.state,
        TaskState::AwaitingApproval { .. } | TaskState::AwaitingRejectionConfirmation { .. }
    ) {
        return Err(WorkflowError::InvalidTransition(format!(
            "Cannot reject task in state {} (expected awaiting approval or rejection confirmation)",
            task.state
        )));
    }

    let current_stage = task
        .current_stage()
        .ok_or_else(|| WorkflowError::InvalidTransition("Task not in active stage".into()))?
        .to_string();

    // Check for pending rejection review — route comments to the rejection target stage
    if stage::pending_rejection_review::execute(store, &task.id, &current_stage)?.is_some() {
        orkestra_debug!(
            "action",
            "reject_with_comments {}: pending rejection exists, routing to rejection target",
            task_id
        );

        // Don't call end_iteration — it was already ended with AwaitingRejectionReview
        route_to_rejection_target(
            store,
            workflow,
            iteration_service,
            &mut task,
            &current_stage,
            comments,
            guidance,
        )?;
        return Ok(task);
    }

    orkestra_debug!(
        "action",
        "reject_with_comments {}: stage={}, comments={}",
        task_id,
        current_stage,
        comments.len()
    );

    // End current iteration with rejection
    stage::end_iteration::execute(
        iteration_service,
        &task,
        Outcome::rejected(&current_stage, "Rejected with line comments"),
    )?;

    route_to_rejection_target(
        store,
        workflow,
        iteration_service,
        &mut task,
        &current_stage,
        comments,
        guidance,
    )?;
    Ok(task)
}

// -- Helpers --

/// Resolve the rejection target stage, create a new iteration with PR comments context,
/// and save the task in the queued state.
fn route_to_rejection_target(
    store: &dyn WorkflowStore,
    workflow: &WorkflowConfig,
    iteration_service: &IterationService,
    task: &mut Task,
    current_stage: &str,
    comments: Vec<PrCommentData>,
    guidance: Option<String>,
) -> WorkflowResult<()> {
    let target_stage = stage::execute_rejection::resolve_rejection_target(
        workflow,
        current_stage,
        task.flow.as_deref(),
    )?;
    iteration_service.create_iteration(
        &task.id,
        &target_stage,
        Some(IterationTrigger::PrComments { comments, guidance }),
    )?;
    task.state = TaskState::queued(&target_stage);
    task.updated_at = chrono::Utc::now().to_rfc3339();
    store.save_task(task)?;
    Ok(())
}
