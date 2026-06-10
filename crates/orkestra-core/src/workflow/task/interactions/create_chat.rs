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

    // Apply explicit base_branch first so worktree adoption doesn't override it.
    if let Some(b) = base_branch {
        task.base_branch = b.to_string();
    }

    // Check for a prewarmed worktree; adopt it if ready.
    if let Some(record) = super::adopt_worktree::execute(store, &id)? {
        super::adopt_worktree::apply_to_task(&mut task, record);
    }

    store.save_task(&task)?;

    orkestra_debug!("task", "Created chat task {}", task.id);
    Ok(task)
}
