//! Approve the current stage's artifact or confirm a pending rejection.

use crate::orkestra_debug;
use crate::workflow::config::WorkflowConfig;
use crate::workflow::domain::Task;
use crate::workflow::iteration::IterationService;
use crate::workflow::ports::{WorkflowError, WorkflowResult, WorkflowStore};
use crate::workflow::stage::interactions as stage;

pub fn execute(
    store: &dyn WorkflowStore,
    workflow: &WorkflowConfig,
    iteration_service: &IterationService,
    task_id: &str,
) -> WorkflowResult<Task> {
    let mut task = store
        .get_task(task_id)?
        .ok_or_else(|| WorkflowError::TaskNotFound(task_id.into()))?;

    if !task.is_awaiting_review() {
        return Err(WorkflowError::InvalidTransition(format!(
            "Cannot approve task in state {} (expected awaiting review)",
            task.state
        )));
    }

    let current_stage = task
        .current_stage()
        .ok_or_else(|| WorkflowError::InvalidTransition("Task not in active stage".into()))?
        .to_string();

    // Check for pending rejection review — "approve" means "confirm the rejection"
    if let Some((from_stage, target, feedback)) =
        stage::pending_rejection_review::execute(store, &task.id, &current_stage)?
    {
        orkestra_debug!(
            "action",
            "approve {}: confirming rejection from {} to {}",
            task_id,
            from_stage,
            target
        );
        let now = chrono::Utc::now().to_rfc3339();
        stage::execute_rejection::execute(
            store,
            workflow,
            iteration_service,
            &mut task,
            &from_stage,
            &target,
            &feedback,
            &now,
        )?;
        store.save_task(&task)?;
        return Ok(task);
    }

    orkestra_debug!(
        "action",
        "approve {}: from stage {}",
        task_id,
        current_stage
    );

    // Enter commit pipeline. Actual advancement happens in finalize_stage_advancement after commit.
    let now = chrono::Utc::now().to_rfc3339();
    stage::enter_commit_pipeline::execute(iteration_service, &mut task, &now)?;

    store.save_task(&task)?;
    Ok(task)
}
