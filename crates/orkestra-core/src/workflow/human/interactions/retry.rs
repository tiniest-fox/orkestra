//! Retry a failed or blocked task by resuming from its last active stage.

use crate::orkestra_debug;
use crate::workflow::config::WorkflowConfig;
use crate::workflow::domain::{IterationTrigger, Task};
use crate::workflow::iteration::IterationService;
use crate::workflow::ports::{WorkflowError, WorkflowResult, WorkflowStore};
use crate::workflow::runtime::TaskState;

pub fn execute(
    store: &dyn WorkflowStore,
    workflow: &WorkflowConfig,
    iteration_service: &IterationService,
    task_id: &str,
    instructions: Option<&str>,
) -> WorkflowResult<Task> {
    let mut task = store
        .get_task(task_id)?
        .ok_or_else(|| WorkflowError::TaskNotFound(task_id.into()))?;

    // Verify task is in a retryable state (failed or blocked)
    let was_failed = task.is_failed();
    let was_blocked = task.is_blocked();
    if !was_failed && !was_blocked {
        return Err(WorkflowError::InvalidTransition(format!(
            "Cannot retry task {task_id} - not in failed or blocked state"
        )));
    }

    orkestra_debug!(
        "action",
        "retry {}: recovering from {} state",
        task_id,
        task.state
    );

    // Get the last stage from the most recent iteration
    let iterations = store.get_iterations(&task.id)?;
    let last_stage = match iterations.last() {
        Some(i) => i.stage.clone(),
        None => workflow
            .first_stage(&task.flow)
            .map(|s| s.name.clone())
            .ok_or_else(|| {
                WorkflowError::InvalidTransition(format!(
                    "Flow '{}' not found or has no stages",
                    task.flow
                ))
            })?,
    };

    let now = chrono::Utc::now().to_rfc3339();

    // Transition task back to its last stage
    if task.worktree_path.is_none() {
        task.state = TaskState::awaiting_setup(&last_stage);
        orkestra_debug!(
            "action",
            "retry {}: no worktree_path, setting state to AwaitingSetup",
            task_id
        );
    } else {
        task.state = TaskState::queued(&last_stage);
    }

    task.updated_at.clone_from(&now);

    // Create new iteration with trigger that reflects the retry context
    let trimmed = instructions.map(str::trim).filter(|s| !s.is_empty());
    let trigger = if was_failed {
        IterationTrigger::RetryFailed {
            instructions: trimmed.map(String::from),
        }
    } else {
        IterationTrigger::RetryBlocked {
            instructions: trimmed.map(String::from),
        }
    };
    iteration_service.create_iteration(&task.id, &last_stage, Some(trigger))?;

    store.save_task(&task)?;

    orkestra_debug!(
        "action",
        "retry {}: resumed in stage {}, state={}",
        task_id,
        last_stage,
        task.state
    );

    Ok(task)
}
