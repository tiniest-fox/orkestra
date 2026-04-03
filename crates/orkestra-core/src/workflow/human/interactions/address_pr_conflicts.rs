//! Address PR merge conflicts by returning to a recovery stage.

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
    base_branch: &str,
) -> WorkflowResult<Task> {
    let mut task = store
        .get_task(task_id)?
        .ok_or_else(|| WorkflowError::TaskNotFound(task_id.into()))?;

    let recovery_stage = workflow
        .recovery_stage(&task.flow)
        .ok_or_else(|| WorkflowError::InvalidTransition("No recovery stage configured".into()))?;

    // Validate task state
    if !task.is_done() {
        return Err(WorkflowError::InvalidTransition(format!(
            "Task {task_id} is not done, cannot address PR conflicts"
        )));
    }

    orkestra_debug!(
        "action",
        "address_pr_conflicts {}: returning to {} stage to resolve conflicts with {}",
        task_id,
        recovery_stage,
        base_branch
    );

    // Create new iteration with Integration trigger (reuses existing variant)
    iteration_service.create_iteration(
        task_id,
        &recovery_stage,
        Some(IterationTrigger::Integration {
            message: format!("PR has merge conflicts with {base_branch}"),
            conflict_files: vec![], // GitHub doesn't expose file list; agent discovers on rebase
        }),
    )?;

    // Update task to recovery stage in Queued state
    let now = chrono::Utc::now().to_rfc3339();
    task.state = TaskState::queued(&recovery_stage);
    task.completed_at = None;
    task.updated_at = now;

    store.save_task(&task)?;
    Ok(task)
}
