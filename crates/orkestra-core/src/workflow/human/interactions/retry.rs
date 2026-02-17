//! Retry a failed or blocked task by resuming from its last active stage.

use crate::orkestra_debug;
use crate::workflow::config::WorkflowConfig;
use crate::workflow::domain::{IterationTrigger, Task};
use crate::workflow::iteration::IterationService;
use crate::workflow::ports::{WorkflowError, WorkflowResult, WorkflowStore};
use crate::workflow::runtime::{Phase, Status};

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
    let was_failed = matches!(task.status, Status::Failed { .. });
    let was_blocked = matches!(task.status, Status::Blocked { .. });
    if !was_failed && !was_blocked {
        return Err(WorkflowError::InvalidTransition(format!(
            "Cannot retry task {task_id} - not in failed or blocked state"
        )));
    }

    orkestra_debug!(
        "action",
        "retry {}: recovering from {} state",
        task_id,
        task.status
    );

    // Get the last stage from the most recent iteration
    let iterations = store.get_iterations(&task.id)?;
    let last_stage = iterations.last().map_or_else(
        || {
            workflow
                .first_stage_in_flow(task.flow.as_deref())
                .map_or_else(|| "planning".to_string(), |s| s.name.clone())
        },
        |i| i.stage.clone(),
    );

    let now = chrono::Utc::now().to_rfc3339();

    // Transition task back to its last stage
    task.status = Status::active(&last_stage);

    // If worktree setup never completed, go back to AwaitingSetup
    if task.worktree_path.is_none() {
        task.phase = Phase::AwaitingSetup;
        orkestra_debug!(
            "action",
            "retry {}: no worktree_path, setting phase to AwaitingSetup",
            task_id
        );
    } else {
        task.phase = Phase::Idle;
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
        "retry {}: resumed in stage {}, phase={:?}",
        task_id,
        last_stage,
        task.phase
    );

    Ok(task)
}
