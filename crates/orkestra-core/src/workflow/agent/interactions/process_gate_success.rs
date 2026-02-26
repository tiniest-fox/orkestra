//! Handle gate script pass. Enters the commit pipeline.

use crate::orkestra_debug;
use crate::workflow::domain::Task;
use crate::workflow::iteration::IterationService;
use crate::workflow::ports::{WorkflowError, WorkflowResult, WorkflowStore};
use crate::workflow::runtime::TaskState;
use crate::workflow::stage::interactions as stage;

pub fn execute(
    store: &dyn WorkflowStore,
    iteration_service: &IterationService,
    task_id: &str,
) -> WorkflowResult<Task> {
    let mut task = store
        .get_task(task_id)?
        .ok_or_else(|| WorkflowError::TaskNotFound(task_id.into()))?;

    if !matches!(task.state, TaskState::GateRunning { .. }) {
        return Err(WorkflowError::InvalidTransition(format!(
            "Cannot process gate success in state {} (expected GateRunning)",
            task.state
        )));
    }

    let now = chrono::Utc::now().to_rfc3339();

    orkestra_debug!(
        "action",
        "process_gate_success {}: stage={:?}",
        task_id,
        task.current_stage()
    );

    // Gate passed — enter commit pipeline (same as auto-approve path).
    stage::enter_commit_pipeline::execute(iteration_service, &mut task, &now)?;

    store.save_task(&task)?;
    Ok(task)
}
