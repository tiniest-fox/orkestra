//! Record successful PR creation by saving the PR URL.

use crate::workflow::domain::Task;
use crate::workflow::ports::{WorkflowError, WorkflowResult, WorkflowStore};
use crate::workflow::runtime::Phase;

pub fn execute(store: &dyn WorkflowStore, task_id: &str, pr_url: &str) -> WorkflowResult<Task> {
    let mut task = store
        .get_task(task_id)?
        .ok_or_else(|| WorkflowError::TaskNotFound(task_id.into()))?;

    task.pr_url = Some(pr_url.to_string());
    task.phase = Phase::Idle; // Back to Idle — task stays Done with PR link
    task.updated_at = chrono::Utc::now().to_rfc3339();
    store.save_task(&task)?;
    Ok(task)
}
