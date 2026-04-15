//! Auto-retry malformed agent output. Re-queues the task with a corrective prompt.

use crate::orkestra_debug;
use crate::workflow::domain::{IterationTrigger, Task};
use crate::workflow::iteration::IterationService;
use crate::workflow::ports::{WorkflowError, WorkflowResult, WorkflowStore};
use crate::workflow::runtime::{Outcome, TaskState};
use crate::workflow::stage::interactions as stage;

const MAX_MALFORMED_RETRIES: usize = 3;

pub fn execute(
    store: &dyn WorkflowStore,
    iteration_service: &IterationService,
    task_id: &str,
    error: &str,
) -> WorkflowResult<Task> {
    let mut task = store
        .get_task(task_id)?
        .ok_or_else(|| WorkflowError::TaskNotFound(task_id.into()))?;

    if !matches!(task.state, TaskState::AgentWorking { .. }) {
        return Err(WorkflowError::InvalidTransition(format!(
            "Cannot auto-retry malformed output in state {} (expected AgentWorking)",
            task.state
        )));
    }

    let current_stage = task
        .current_stage()
        .ok_or_else(|| WorkflowError::InvalidTransition("Task not in active stage".into()))?
        .to_string();

    // Count existing MalformedOutput iterations for this stage (completed retries).
    let iterations = store.get_iterations(task_id)?;
    let malformed_count = iterations
        .iter()
        .filter(|i| i.stage == current_stage)
        .filter(|i| {
            matches!(
                i.incoming_context,
                Some(IterationTrigger::MalformedOutput { .. })
            )
        })
        .count();

    orkestra_debug!(
        "action",
        "auto_retry_malformed {}: stage={}, malformed_count={}, max={}",
        task_id,
        current_stage,
        malformed_count,
        MAX_MALFORMED_RETRIES
    );

    if malformed_count >= MAX_MALFORMED_RETRIES {
        // Budget exhausted — delegate to fail_execution.
        return super::fail_execution::execute(store, iteration_service, task_id, error);
    }

    let now = chrono::Utc::now().to_rfc3339();

    // End current iteration with agent error outcome.
    stage::end_iteration::execute(
        iteration_service,
        &task,
        Outcome::AgentError {
            error: error.to_string(),
        },
    )?;

    // Re-queue in the same stage with corrective prompt context.
    task.state = TaskState::queued(&current_stage);
    task.updated_at = now;

    // Create new iteration with MalformedOutput trigger so the agent gets the corrective prompt.
    // The attempt count is 1-indexed (malformed_count = existing retries before this one).
    #[allow(clippy::cast_possible_truncation)]
    let attempt = (malformed_count + 1) as u32;
    iteration_service.create_iteration(
        &task.id,
        &current_stage,
        Some(IterationTrigger::MalformedOutput {
            error: error.to_string(),
            attempt,
        }),
    )?;

    store.save_task(&task)?;
    Ok(task)
}
