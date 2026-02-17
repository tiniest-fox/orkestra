//! Record successful PR creation by saving the PR URL.

use crate::workflow::domain::Task;
use crate::workflow::ports::{WorkflowError, WorkflowResult, WorkflowStore};

pub fn execute(store: &dyn WorkflowStore, task_id: &str, pr_url: &str) -> WorkflowResult<Task> {
    let mut task = store
        .get_task(task_id)?
        .ok_or_else(|| WorkflowError::TaskNotFound(task_id.into()))?;

    task.pr_url = Some(pr_url.to_string());
    // Task stays Done with PR link
    task.state = crate::workflow::runtime::TaskState::Done;
    task.updated_at = chrono::Utc::now().to_rfc3339();
    store.save_task(&task)?;
    Ok(task)
}
