//! Handle agent execution failure (crash, poll error, spawn failure).

use crate::orkestra_debug;
use crate::workflow::domain::{LogEntry, Task};
use crate::workflow::iteration::IterationService;
use crate::workflow::ports::{WorkflowError, WorkflowResult, WorkflowStore};
use crate::workflow::runtime::{Outcome, TaskState};
use crate::workflow::stage::interactions as stage;

pub fn execute(
    store: &dyn WorkflowStore,
    iteration_service: &IterationService,
    task_id: &str,
    error: &str,
) -> WorkflowResult<Task> {
    let mut task = store
        .get_task(task_id)?
        .ok_or_else(|| WorkflowError::TaskNotFound(task_id.into()))?;

    if !matches!(task.state, TaskState::AgentWorking { .. }) {
        return Err(WorkflowError::InvalidTransition(format!(
            "Cannot fail agent execution in state {} (expected AgentWorking)",
            task.state
        )));
    }

    let current_stage = task
        .current_stage()
        .ok_or_else(|| WorkflowError::InvalidTransition("Task not in active stage".into()))?
        .to_string();

    orkestra_debug!(
        "action",
        "fail_agent_execution {}: stage={}, error={}",
        task_id,
        current_stage,
        error
    );

    // Capture iteration ID before end_iteration marks it completed.
    let iteration_id = store
        .get_active_iteration(task_id, &current_stage)?
        .map(|it| it.id);

    stage::end_iteration::execute(
        iteration_service,
        &task,
        Outcome::AgentError {
            error: error.to_string(),
        },
    )?;

    // Emit the error into the session log so it surfaces in the Agent tab.
    // claude_session_id is preserved regardless — on_spawn_starting gates is_resume on
    // has_activity, so a no-activity session is never resumed even with an ID present.
    if let Some(session) = store.get_stage_session(task_id, &current_stage)? {
        store.append_log_entry(
            &session.id,
            &LogEntry::Error {
                message: error.to_string(),
            },
            iteration_id.as_deref(),
        )?;
    }

    task.state = TaskState::failed_at(&current_stage, error);
    task.updated_at = chrono::Utc::now().to_rfc3339();

    store.save_task(&task)?;
    Ok(task)
}

// ============================================================================
// Tests
// ============================================================================

#[cfg(test)]
mod tests {
    use std::sync::Arc;

    use super::*;
    use crate::testutil::fixtures::{sessions, tasks};
    use crate::workflow::adapters::InMemoryWorkflowStore;
    use crate::workflow::domain::StageSession;
    use crate::workflow::iteration::IterationService;

    fn make_store_and_service() -> (Arc<InMemoryWorkflowStore>, IterationService) {
        let store = Arc::new(InMemoryWorkflowStore::new());
        let service = IterationService::new(Arc::clone(&store) as Arc<dyn WorkflowStore>);
        (store, service)
    }

    fn setup_agent_working_task(
        store: &dyn WorkflowStore,
        iteration_service: &IterationService,
    ) -> (Task, StageSession) {
        let mut task = tasks::save_task(store, "task-1", "planning", "Test", "Desc").unwrap();
        task.state = TaskState::agent_working("planning");
        store.save_task(&task).unwrap();

        let session = sessions::save_session(store, "session-1", "task-1", "planning").unwrap();
        iteration_service
            .create_initial_iteration("task-1", "planning")
            .unwrap();

        (task, session)
    }

    #[test]
    fn test_session_id_preserved_on_error() {
        let (store, iteration_service) = make_store_and_service();
        let (_, mut session) = setup_agent_working_task(store.as_ref(), &iteration_service);

        session.claude_session_id = Some("claude-session-abc".to_string());
        store.save_stage_session(&session).unwrap();

        execute(store.as_ref(), &iteration_service, "task-1", "boom").unwrap();

        let saved = store
            .get_stage_session("task-1", "planning")
            .unwrap()
            .unwrap();
        assert_eq!(
            saved.claude_session_id.as_deref(),
            Some("claude-session-abc"),
            "claude_session_id must be preserved on error; on_spawn_starting gates is_resume on has_activity"
        );
    }

    #[test]
    fn test_error_log_entry_emitted_on_failure() {
        let (store, iteration_service) = make_store_and_service();
        let (_, session) = setup_agent_working_task(store.as_ref(), &iteration_service);

        execute(
            store.as_ref(),
            &iteration_service,
            "task-1",
            "agent crashed",
        )
        .unwrap();

        let entries = store.get_log_entries(&session.id).unwrap();
        let has_error = entries
            .iter()
            .any(|e| matches!(e, LogEntry::Error { message } if message == "agent crashed"));
        assert!(
            has_error,
            "expected LogEntry::Error in session log after failure"
        );
    }
}
