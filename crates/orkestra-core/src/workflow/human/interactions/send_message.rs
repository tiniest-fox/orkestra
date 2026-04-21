//! Send a message to the agent — creates a new iteration with a `UserMessage` trigger.
//!
//! Handles tasks in `AwaitingQuestionAnswer`, `Failed`, `Blocked`, or `Interrupted` states.
//! Creates a new iteration with a `UserMessage` trigger and transitions the task to `Queued`
//! (or `AwaitingSetup` when no worktree exists). The orchestrator then picks it up and spawns
//! the agent normally with a `user_message` resume prompt.

use crate::orkestra_debug;
use crate::workflow::config::WorkflowConfig;
use crate::workflow::domain::{IterationTrigger, Task};
use crate::workflow::iteration::IterationService;
use crate::workflow::ports::{WorkflowError, WorkflowResult, WorkflowStore};
use crate::workflow::runtime::TaskState;

/// Send a message to the agent.
///
/// Creates a new iteration with a `UserMessage` trigger and transitions the task to `Queued`.
/// Valid from `AwaitingQuestionAnswer`, `Failed`, `Blocked`, `Interrupted`. Creates a
/// `UserMessage` iteration and transitions to `Queued`.
pub fn execute(
    store: &dyn WorkflowStore,
    workflow: &WorkflowConfig,
    iteration_service: &IterationService,
    task_id: &str,
    message: &str,
) -> WorkflowResult<Task> {
    let task = store
        .get_task(task_id)?
        .ok_or_else(|| WorkflowError::TaskNotFound(task_id.into()))?;

    match &task.state {
        TaskState::AwaitingQuestionAnswer { .. }
        | TaskState::Failed { .. }
        | TaskState::Blocked { .. }
        | TaskState::Interrupted { .. } => {
            execute_queued(store, workflow, iteration_service, task_id, message, task)
        }

        _ => Err(WorkflowError::InvalidTransition(format!(
            "Cannot send message in state {} \
             (expected AwaitingQuestionAnswer, Failed, Blocked, or Interrupted)",
            task.state
        ))),
    }
}

// ============================================================================
// Helpers
// ============================================================================

/// Create a new iteration with a `UserMessage` trigger and queue the task.
///
/// For `Failed` and `Blocked`, resolves the last active stage and checks
/// whether a worktree exists:
/// - No worktree → `AwaitingSetup`
/// - Worktree exists → `Queued`
///
/// For `AwaitingQuestionAnswer` and `Interrupted`, uses the current stage
/// and transitions directly to `Queued`.
fn execute_queued(
    store: &dyn WorkflowStore,
    workflow: &WorkflowConfig,
    iteration_service: &IterationService,
    task_id: &str,
    message: &str,
    mut task: Task,
) -> WorkflowResult<Task> {
    orkestra_debug!(
        "action",
        "send_message {}: queuing with UserMessage trigger, state={}",
        task_id,
        task.state
    );

    let now = chrono::Utc::now().to_rfc3339();
    let trigger = IterationTrigger::UserMessage {
        message: message.to_string(),
    };

    let stage_name = match &task.state {
        TaskState::AwaitingQuestionAnswer { stage } | TaskState::Interrupted { stage } => {
            stage.clone()
        }
        TaskState::Failed { .. } | TaskState::Blocked { .. } => {
            super::resolve_current_stage(&task, store, workflow)?
        }
        _ => unreachable!("state already validated by execute()"),
    };

    iteration_service.create_iteration(&task.id, &stage_name, Some(trigger))?;

    task.state = match &task.state {
        TaskState::AwaitingQuestionAnswer { .. } | TaskState::Interrupted { .. } => {
            TaskState::queued(&stage_name)
        }
        TaskState::Failed { .. } | TaskState::Blocked { .. } => {
            if task.worktree_path.is_none() {
                TaskState::awaiting_setup(&stage_name)
            } else {
                TaskState::queued(&stage_name)
            }
        }
        _ => unreachable!("state already validated by execute()"),
    };
    task.updated_at = now;

    store.save_task(&task)?;

    orkestra_debug!(
        "action",
        "send_message {}: queued, state={}",
        task_id,
        task.state
    );

    Ok(task)
}

// ============================================================================
// Tests
// ============================================================================

#[cfg(test)]
mod tests {
    use super::*;
    use crate::workflow::config::{IntegrationConfig, StageConfig, WorkflowConfig};
    use crate::workflow::domain::IterationTrigger;
    use crate::workflow::iteration::IterationService;
    use crate::workflow::ports::WorkflowStore;
    use crate::workflow::runtime::TaskState;
    use crate::workflow::InMemoryWorkflowStore;
    use std::sync::Arc;

    fn test_workflow() -> WorkflowConfig {
        WorkflowConfig::new(vec![
            StageConfig::new("planning", "plan"),
            StageConfig::new("work", "summary"),
        ])
        .with_integration(IntegrationConfig::new("work"))
    }

    fn make_store_and_service() -> (Arc<InMemoryWorkflowStore>, IterationService) {
        let store = Arc::new(InMemoryWorkflowStore::new());
        let service = IterationService::new(Arc::clone(&store) as Arc<dyn WorkflowStore>);
        (store, service)
    }

    #[test]
    fn test_send_message_from_awaiting_question_answer_queues() {
        let workflow = test_workflow();
        let (store, iter_service) = make_store_and_service();

        let mut task = crate::workflow::domain::Task::new(
            "task-1",
            "Test",
            "Test",
            "planning",
            "2025-01-01T00:00:00Z",
        );
        task.worktree_path = Some("/tmp/fake-worktree".into());
        task.state = TaskState::awaiting_question_answer("planning");
        store.save_task(&task).unwrap();

        let result = execute(
            store.as_ref(),
            &workflow,
            &iter_service,
            &task.id,
            "Please use PostgreSQL",
        )
        .unwrap();

        assert!(matches!(result.state, TaskState::Queued { .. }));
        assert_eq!(result.current_stage(), Some("planning"));

        let iterations = store.get_iterations(&task.id).unwrap();
        let last = iterations.last().unwrap();
        match &last.incoming_context {
            Some(IterationTrigger::UserMessage { message }) => {
                assert_eq!(message, "Please use PostgreSQL");
            }
            other => panic!("Expected UserMessage trigger, got {other:?}"),
        }
    }

    #[test]
    fn test_send_message_from_interrupted_queues() {
        let workflow = test_workflow();
        let (store, iter_service) = make_store_and_service();

        let mut task = crate::workflow::domain::Task::new(
            "task-2",
            "Test",
            "Test",
            "work",
            "2025-01-01T00:00:00Z",
        );
        task.worktree_path = Some("/tmp/fake-worktree".into());
        task.state = TaskState::interrupted("work");
        store.save_task(&task).unwrap();

        let result = execute(
            store.as_ref(),
            &workflow,
            &iter_service,
            &task.id,
            "Continue with the implementation",
        )
        .unwrap();

        assert!(matches!(result.state, TaskState::Queued { .. }));
        assert_eq!(result.current_stage(), Some("work"));

        let iterations = store.get_iterations(&task.id).unwrap();
        let last = iterations.last().unwrap();
        assert!(matches!(
            &last.incoming_context,
            Some(IterationTrigger::UserMessage { .. })
        ));
    }

    #[test]
    fn test_send_message_from_failed_with_worktree_queues() {
        let workflow = test_workflow();
        let (store, iter_service) = make_store_and_service();

        let mut task = crate::workflow::domain::Task::new(
            "task-3",
            "Test",
            "Test",
            "work",
            "2025-01-01T00:00:00Z",
        );
        task.worktree_path = Some("/tmp/fake-worktree".into());
        task.state = TaskState::failed_at("work", "Something went wrong");
        // Simulate an existing iteration so last_stage can be resolved
        store.save_task(&task).unwrap();
        iter_service
            .create_iteration(&task.id, "work", None)
            .unwrap();

        let result = execute(
            store.as_ref(),
            &workflow,
            &iter_service,
            &task.id,
            "Try a different approach",
        )
        .unwrap();

        assert!(matches!(result.state, TaskState::Queued { .. }));
        assert_eq!(result.current_stage(), Some("work"));
    }

    #[test]
    fn test_send_message_from_failed_without_worktree_awaits_setup() {
        let workflow = test_workflow();
        let (store, iter_service) = make_store_and_service();

        let mut task = crate::workflow::domain::Task::new(
            "task-4",
            "Test",
            "Test",
            "planning",
            "2025-01-01T00:00:00Z",
        );
        // No worktree_path set
        task.state = TaskState::failed("Setup failed");
        store.save_task(&task).unwrap();
        iter_service
            .create_iteration(&task.id, "planning", None)
            .unwrap();

        let result = execute(
            store.as_ref(),
            &workflow,
            &iter_service,
            &task.id,
            "Please retry",
        )
        .unwrap();

        assert!(matches!(result.state, TaskState::AwaitingSetup { .. }));
        assert_eq!(result.current_stage(), Some("planning"));
    }

    #[test]
    fn test_send_message_from_blocked_with_worktree_queues() {
        let workflow = test_workflow();
        let (store, iter_service) = make_store_and_service();

        let mut task = crate::workflow::domain::Task::new(
            "task-5",
            "Test",
            "Test",
            "work",
            "2025-01-01T00:00:00Z",
        );
        task.worktree_path = Some("/tmp/fake-worktree".into());
        task.state = TaskState::blocked_at("work", "Waiting on external service");
        store.save_task(&task).unwrap();
        iter_service
            .create_iteration(&task.id, "work", None)
            .unwrap();

        let result = execute(
            store.as_ref(),
            &workflow,
            &iter_service,
            &task.id,
            "The service is now available",
        )
        .unwrap();

        assert!(matches!(result.state, TaskState::Queued { .. }));
        assert_eq!(result.current_stage(), Some("work"));
    }

    #[test]
    fn test_send_message_invalid_state_returns_error() {
        let workflow = test_workflow();
        let (store, iter_service) = make_store_and_service();

        let task = crate::workflow::domain::Task::new(
            "task-6",
            "Test",
            "Test",
            "work",
            "2025-01-01T00:00:00Z",
        );
        // AgentWorking is not a valid state for send_message
        let mut bad_task = task.clone();
        bad_task.state = TaskState::agent_working("work");
        store.save_task(&bad_task).unwrap();

        let result = execute(
            store.as_ref(),
            &workflow,
            &iter_service,
            &bad_task.id,
            "hello",
        );

        assert!(matches!(result, Err(WorkflowError::InvalidTransition(_))));
    }

    #[test]
    fn test_send_message_from_awaiting_approval_returns_error() {
        let workflow = test_workflow();
        let (store, iter_service) = make_store_and_service();

        let mut task = crate::workflow::domain::Task::new(
            "task-7",
            "Test",
            "Test",
            "work",
            "2025-01-01T00:00:00Z",
        );
        task.state = TaskState::awaiting_approval("work");
        store.save_task(&task).unwrap();

        let result = execute(store.as_ref(), &workflow, &iter_service, &task.id, "hello");

        assert!(matches!(result, Err(WorkflowError::InvalidTransition(_))));
    }
}
