//! Create a new chat task (no flow, no worktree, starts in Queued).

use crate::orkestra_debug;
use crate::workflow::domain::Task;
use crate::workflow::ports::{WorkflowResult, WorkflowStore};
use crate::workflow::runtime::TaskState;

pub fn execute(store: &dyn WorkflowStore, title: &str) -> WorkflowResult<Task> {
    let id = store.next_task_id()?;
    let now = chrono::Utc::now().to_rfc3339();

    let mut task = Task::new(&id, title, "", "chat", &now);
    task.is_chat = true;
    task.flow = String::new();
    task.state = TaskState::queued("chat");

    store.save_task(&task)?;

    orkestra_debug!("task", "Created chat task {}", task.id);
    Ok(task)
}
