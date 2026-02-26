//! Handle gate script pass. Respects `auto_mode` and `is_automated` like non-gate stages.

use crate::orkestra_debug;
use crate::workflow::config::WorkflowConfig;
use crate::workflow::domain::Task;
use crate::workflow::iteration::IterationService;
use crate::workflow::ports::{WorkflowError, WorkflowResult, WorkflowStore};
use crate::workflow::runtime::TaskState;
use crate::workflow::stage::interactions as stage;

pub fn execute(
    store: &dyn WorkflowStore,
    iteration_service: &IterationService,
    workflow: &WorkflowConfig,
    task_id: &str,
) -> WorkflowResult<Task> {
    let mut task = store
        .get_task(task_id)?
        .ok_or_else(|| WorkflowError::TaskNotFound(task_id.into()))?;

    let TaskState::GateRunning { stage } = &task.state else {
        return Err(WorkflowError::InvalidTransition(format!(
            "Cannot process gate success in state {} (expected GateRunning)",
            task.state
        )));
    };
    let stage_name = stage.clone();

    let now = chrono::Utc::now().to_rfc3339();

    orkestra_debug!(
        "action",
        "process_gate_success {}: stage={:?}",
        task_id,
        task.current_stage()
    );

    // Gate passed — respect auto_mode and is_automated, same as non-gate stages.
    stage::auto_advance_or_review::execute(
        iteration_service,
        workflow,
        &mut task,
        &stage_name,
        &now,
    )?;

    store.save_task(&task)?;
    Ok(task)
}
