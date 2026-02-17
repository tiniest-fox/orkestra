//! Record successful integration by archiving the task.

use crate::workflow::domain::Task;
use crate::workflow::ports::{WorkflowError, WorkflowResult, WorkflowStore};
use crate::workflow::runtime::{Phase, Status};

pub fn execute(store: &dyn WorkflowStore, task_id: &str) -> WorkflowResult<Task> {
    let mut task = store
        .get_task(task_id)?
        .ok_or_else(|| WorkflowError::TaskNotFound(task_id.into()))?;

    if !task.is_done() {
        return Err(WorkflowError::InvalidTransition(
            "Cannot integrate task that is not Done".into(),
        ));
    }

    // Transition from Done to Archived
    // Keep worktree_path for log access even though physical worktree is removed
    task.status = Status::Archived;
    task.phase = Phase::Idle;
    task.updated_at = chrono::Utc::now().to_rfc3339();
    store.save_task(&task)?;

    Ok(task)
}
