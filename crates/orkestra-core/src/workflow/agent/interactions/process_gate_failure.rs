//! Handle gate script failure. Re-queues the task in the same stage with error context.

use crate::orkestra_debug;
use crate::workflow::domain::{IterationTrigger, Task};
use crate::workflow::iteration::IterationService;
use crate::workflow::ports::{WorkflowError, WorkflowResult, WorkflowStore};
use crate::workflow::runtime::{Outcome, TaskState};
use crate::workflow::stage::interactions as stage;

pub fn execute(
    store: &dyn WorkflowStore,
    iteration_service: &IterationService,
    task_id: &str,
    error: &str,
) -> WorkflowResult<Task> {
    let mut task = store
        .get_task(task_id)?
        .ok_or_else(|| WorkflowError::TaskNotFound(task_id.into()))?;

    if !matches!(task.state, TaskState::GateRunning { .. }) {
        return Err(WorkflowError::InvalidTransition(format!(
            "Cannot process gate failure in state {} (expected GateRunning)",
            task.state
        )));
    }

    let current_stage = task
        .current_stage()
        .ok_or_else(|| WorkflowError::InvalidTransition("Task not in active stage".into()))?
        .to_string();

    let now = chrono::Utc::now().to_rfc3339();
    let clean_error = strip_ansi_codes(error);

    orkestra_debug!(
        "action",
        "process_gate_failure {}: stage={}",
        task_id,
        current_stage
    );

    // End current iteration with gate-failed outcome.
    stage::end_iteration::execute(
        iteration_service,
        &task,
        Outcome::gate_failed(&current_stage, &clean_error),
    )?;

    // Re-queue in the same stage with gate failure context.
    task.state = TaskState::queued(&current_stage);
    task.updated_at = now;

    // Create new iteration with GateFailure trigger so the agent gets the error.
    iteration_service.create_iteration(
        &task.id,
        &current_stage,
        Some(IterationTrigger::GateFailure { error: clean_error }),
    )?;

    store.save_task(&task)?;
    Ok(task)
}

// -- Helpers --

/// Strip ANSI escape codes from a string for clean LLM consumption.
fn strip_ansi_codes(input: &str) -> String {
    let bytes = strip_ansi_escapes::strip(input);
    String::from_utf8_lossy(&bytes).into_owned()
}
