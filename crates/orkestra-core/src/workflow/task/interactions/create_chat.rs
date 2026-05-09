//! Create a new chat task (no flow, starts in Queued).

use crate::orkestra_debug;
use crate::workflow::domain::Task;
use crate::workflow::ports::{WorkflowError, WorkflowResult, WorkflowStore};

pub fn execute(
    store: &dyn WorkflowStore,
    task_id: Option<&str>,
    title: &str,
    base_branch: Option<&str>,
) -> WorkflowResult<Task> {
    if title.trim().is_empty() {
        return Err(WorkflowError::InvalidState(
            "Chat task title cannot be empty".to_string(),
        ));
    }

    let id = match task_id {
        Some(id) => id.to_string(),
        None => store.next_task_id()?,
    };
    let now = chrono::Utc::now().to_rfc3339();

    let mut task = Task::new(&id, title, "", "chat", &now);
    task.is_chat = true;
    task.flow = String::new();

    // Check for a prewarmed worktree; adopt it if ready.
    if let Some(record) = super::adopt_worktree::execute(store, &id)? {
        if let Some(path) = record.worktree_path {
            task.worktree_path = Some(path);
        }
        if let Some(branch) = record.base_branch {
            task.base_branch = branch;
        }
        if let Some(branch_name) = record.branch_name {
            task.branch_name = Some(branch_name);
        }
        if let Some(base_commit) = record.base_commit {
            task.base_commit = base_commit;
        }
    }

    // Also apply base_branch if provided and worktree adoption didn't set one.
    if let Some(b) = base_branch {
        if task.base_branch.is_empty() {
            task.base_branch = b.to_string();
        }
    }

    store.save_task(&task)?;

    orkestra_debug!("task", "Created chat task {}", task.id);
    Ok(task)
}
