//! Create a new chat task (no flow, no worktree, starts in Queued).

use crate::orkestra_debug;
use crate::workflow::domain::Task;
use crate::workflow::ports::{WorkflowError, WorkflowResult, WorkflowStore};

pub fn execute(store: &dyn WorkflowStore, title: &str) -> WorkflowResult<Task> {
    if title.trim().is_empty() {
        return Err(WorkflowError::InvalidState(
            "Chat task title cannot be empty".to_string(),
        ));
    }

    let id = store.next_task_id()?;
    let now = chrono::Utc::now().to_rfc3339();

    let mut task = Task::new(&id, title, "", "chat", &now);
    task.is_chat = true;
    task.flow = String::new();

    store.save_task(&task)?;

    orkestra_debug!("task", "Created chat task {}", task.id);
    Ok(task)
}
