//! Reject the current stage's artifact with feedback.

use crate::orkestra_debug;
use crate::workflow::domain::{IterationTrigger, Task};
use crate::workflow::iteration::IterationService;
use crate::workflow::ports::{WorkflowError, WorkflowResult, WorkflowStore};
use crate::workflow::runtime::{Outcome, Phase};
use crate::workflow::stage::interactions as stage;

pub fn execute(
    store: &dyn WorkflowStore,
    iteration_service: &IterationService,
    task_id: &str,
    feedback: &str,
) -> WorkflowResult<Task> {
    let mut task = store
        .get_task(task_id)?
        .ok_or_else(|| WorkflowError::TaskNotFound(task_id.into()))?;

    if task.phase != Phase::AwaitingReview {
        return Err(WorkflowError::InvalidTransition(format!(
            "Cannot reject task in phase {:?}",
            task.phase
        )));
    }

    let current_stage = task
        .current_stage()
        .ok_or_else(|| WorkflowError::InvalidTransition("Task not in active stage".into()))?
        .to_string();

    // Check for pending rejection review — "reject" means "override, request new verdict"
    if stage::pending_rejection_review::execute(store, &task.id, &current_stage)?.is_some() {
        orkestra_debug!(
            "action",
            "reject {}: overriding rejection, requesting new verdict in {}",
            task_id,
            current_stage
        );

        let now = chrono::Utc::now().to_rfc3339();

        // Don't call end_iteration — it was already ended with AwaitingRejectionReview
        // Create new iteration in the same review stage with human's feedback
        iteration_service.create_iteration(
            &task.id,
            &current_stage,
            Some(IterationTrigger::Feedback {
                feedback: feedback.to_string(),
            }),
        )?;

        task.phase = Phase::Idle;
        task.updated_at = now;

        store.save_task(&task)?;
        return Ok(task);
    }

    orkestra_debug!(
        "action",
        "reject {}: stage={}, feedback_len={}",
        task_id,
        current_stage,
        feedback.len()
    );

    let now = chrono::Utc::now().to_rfc3339();

    // End current iteration with rejection
    stage::end_iteration::execute(
        iteration_service,
        &task,
        Outcome::rejected(&current_stage, feedback),
    )?;

    // Stay in same stage, go back to Idle
    task.phase = Phase::Idle;
    task.updated_at.clone_from(&now);

    // Create new iteration in same stage with feedback context
    iteration_service.create_iteration(
        &task.id,
        &current_stage,
        Some(IterationTrigger::Feedback {
            feedback: feedback.to_string(),
        }),
    )?;

    store.save_task(&task)?;
    Ok(task)
}
