//! Park a task at `AwaitingApproval` when the agent produced plain text with no structured output.

use crate::workflow::domain::Task;
use crate::workflow::ports::{WorkflowError, WorkflowResult, WorkflowStore};
use crate::workflow::runtime::TaskState;

pub fn execute(store: &dyn WorkflowStore, task_id: &str) -> WorkflowResult<Task> {
    let mut task = store
        .get_task(task_id)?
        .ok_or_else(|| WorkflowError::TaskNotFound(task_id.into()))?;

    if !matches!(task.state, TaskState::AgentWorking { .. }) {
        return Err(WorkflowError::InvalidTransition(format!(
            "Cannot park plain text in state {} (expected AgentWorking)",
            task.state
        )));
    }

    let stage = task
        .current_stage()
        .ok_or_else(|| WorkflowError::InvalidTransition("Task not in active stage".into()))?
        .to_string();

    task.state = TaskState::awaiting_approval(&stage);
    task.updated_at = chrono::Utc::now().to_rfc3339();

    store.save_task(&task)?;
    Ok(task)
}

// ============================================================================
// Tests
// ============================================================================

#[cfg(test)]
mod tests {
    use super::*;
    use crate::testutil::fixtures::tasks;
    use crate::workflow::adapters::InMemoryWorkflowStore;
    use crate::workflow::ports::WorkflowStore;

    #[test]
    fn parks_task_at_awaiting_approval() {
        let store = InMemoryWorkflowStore::new();
        let mut task = tasks::save_task(&store, "task-1", "work", "Test", "Desc").unwrap();
        task.state = TaskState::agent_working("work");
        store.save_task(&task).unwrap();

        let result = execute(&store, "task-1").unwrap();

        assert!(
            matches!(result.state, TaskState::AwaitingApproval { ref stage } if stage == "work"),
            "Expected AwaitingApproval(work), got {:?}",
            result.state
        );
    }

    #[test]
    fn rejects_non_agent_working_state() {
        let store = InMemoryWorkflowStore::new();
        let _task = tasks::save_task(&store, "task-1", "work", "Test", "Desc").unwrap();
        // task is in Queued state by default

        let err = execute(&store, "task-1").unwrap_err();
        assert!(
            matches!(err, WorkflowError::InvalidTransition(_)),
            "Expected InvalidTransition, got {err:?}"
        );
    }
}
