//! Return to structured work after chatting with the stage agent.

use crate::workflow::domain::{IterationTrigger, Task};
use crate::workflow::iteration::IterationService;
use crate::workflow::ports::{WorkflowError, WorkflowResult, WorkflowStore};
use crate::workflow::runtime::TaskState;
use orkestra_process::{is_process_running, kill_process_tree};

pub fn execute(
    store: &dyn WorkflowStore,
    iteration_service: &IterationService,
    task_id: &str,
    message: Option<String>,
) -> WorkflowResult<Task> {
    let mut task = store
        .get_task(task_id)?
        .ok_or_else(|| WorkflowError::TaskNotFound(task_id.into()))?;

    // Valid from AwaitingApproval or Interrupted
    if !task.can_chat() {
        return Err(WorkflowError::InvalidTransition(format!(
            "Cannot return to work from state {} (expected AwaitingApproval or Interrupted)",
            task.state
        )));
    }

    let stage = task
        .current_stage()
        .ok_or_else(|| WorkflowError::InvalidTransition("No current stage".into()))?
        .to_string();

    let now = chrono::Utc::now().to_rfc3339();

    // Kill running chat agent BEFORE clearing state
    // (exit_chat clears agent_pid, so we must read it first)
    if let Some(mut session) = store.get_stage_session(task_id, &stage)? {
        if let Some(pid) = session.agent_pid {
            if is_process_running(pid) {
                if let Err(e) = kill_process_tree(pid) {
                    crate::orkestra_debug!(
                        "return_to_work",
                        "Failed to kill chat agent (pid={}): {}",
                        pid,
                        e
                    );
                }
            }
        }
        session.exit_chat(&now);
        store.save_stage_session(&session)?;
    }

    // Create new iteration with ReturnToWork trigger
    iteration_service.create_iteration(
        task_id,
        &stage,
        Some(IterationTrigger::ReturnToWork { message }),
    )?;

    // Transition to Queued so orchestrator picks it up
    task.state = TaskState::queued(&stage);
    task.updated_at = now;
    store.save_task(&task)?;

    Ok(task)
}
