//! Request update on a Done task by returning to recovery stage.

use crate::orkestra_debug;
use crate::workflow::config::WorkflowConfig;
use crate::workflow::domain::{IterationTrigger, Task};
use crate::workflow::iteration::IterationService;
use crate::workflow::ports::{WorkflowError, WorkflowResult, WorkflowStore};
use crate::workflow::runtime::TaskState;

pub fn execute(
    store: &dyn WorkflowStore,
    workflow: &WorkflowConfig,
    iteration_service: &IterationService,
    task_id: &str,
    feedback: &str,
) -> WorkflowResult<Task> {
    // Validate feedback is not empty/whitespace
    if feedback.trim().is_empty() {
        return Err(WorkflowError::InvalidTransition(
            "Feedback cannot be empty".into(),
        ));
    }

    let mut task = store
        .get_task(task_id)?
        .ok_or_else(|| WorkflowError::TaskNotFound(task_id.into()))?;

    let recovery_stage = workflow
        .recovery_stage(&task.flow)
        .ok_or_else(|| WorkflowError::InvalidTransition("No recovery stage configured".into()))?;

    // Validate task state
    if !task.is_done() {
        return Err(WorkflowError::InvalidTransition(format!(
            "Task {task_id} is not done, cannot request update"
        )));
    }

    orkestra_debug!(
        "action",
        "request_update {}: returning to {} stage with feedback",
        task_id,
        recovery_stage
    );

    // Create new iteration with rejection trigger — this is a "returning" scenario
    // (task is coming back from Done to a previous stage), so we use Rejection to
    // start a fresh session instead of resuming the stale one.
    iteration_service.create_iteration(
        task_id,
        &recovery_stage,
        Some(IterationTrigger::Rejection {
            from_stage: "done".to_string(),
            feedback: feedback.to_string(),
        }),
    )?;

    // Update task to recovery stage in Queued state
    let now = chrono::Utc::now().to_rfc3339();
    task.state = TaskState::queued(&recovery_stage);
    task.completed_at = None;
    task.updated_at = now;

    store.save_task(&task)?;
    Ok(task)
}

// ============================================================================
// Tests
// ============================================================================

#[cfg(test)]
mod tests {
    use super::*;
    use crate::workflow::adapters::InMemoryWorkflowStore;
    use crate::workflow::config::{IntegrationConfig, StageConfig, WorkflowConfig};
    use crate::workflow::domain::Task;
    use crate::workflow::iteration::IterationService;
    use std::sync::Arc;

    fn test_workflow() -> WorkflowConfig {
        WorkflowConfig::new(vec![
            StageConfig::new("planning", "plan"),
            StageConfig::new("work", "summary"),
        ])
        .with_integration(IntegrationConfig::new("work"))
    }

    fn create_done_task(store: &Arc<InMemoryWorkflowStore>) -> Task {
        let mut task = Task::new("task-1", "Test", "Description", "planning", "now");
        task.state = TaskState::Done;
        store.save_task(&task).unwrap();
        task
    }

    #[test]
    fn test_request_update_success() {
        let store = Arc::new(InMemoryWorkflowStore::new());
        let workflow = test_workflow();
        let iteration_service = IterationService::new(store.clone());
        let task = create_done_task(&store);

        let result = execute(
            store.as_ref(),
            &workflow,
            &iteration_service,
            &task.id,
            "Please add error handling",
        )
        .unwrap();

        // Should return to work stage (integration recovery stage)
        assert_eq!(result.current_stage(), Some("work"));
        assert!(matches!(result.state, TaskState::Queued { .. }));
        assert!(result.completed_at.is_none());
    }

    #[test]
    fn test_request_update_creates_iteration_with_feedback() {
        let store = Arc::new(InMemoryWorkflowStore::new());
        let workflow = test_workflow();
        let iteration_service = IterationService::new(store.clone());
        let task = create_done_task(&store);

        let _ = execute(
            store.as_ref(),
            &workflow,
            &iteration_service,
            &task.id,
            "Add more tests",
        )
        .unwrap();

        let iterations = store.get_iterations(&task.id).unwrap();
        let last = iterations.last().unwrap();

        match &last.incoming_context {
            Some(IterationTrigger::Rejection {
                from_stage,
                feedback,
            }) => {
                assert_eq!(from_stage, "done");
                assert_eq!(feedback, "Add more tests");
            }
            other => panic!("Expected Rejection trigger, got {other:?}"),
        }
    }

    #[test]
    fn test_request_update_not_done() {
        let store = Arc::new(InMemoryWorkflowStore::new());
        let workflow = test_workflow();
        let iteration_service = IterationService::new(store.clone());

        // Create task in Queued state (not Done)
        let mut task = Task::new("task-1", "Test", "Description", "planning", "now");
        task.state = TaskState::queued("planning");
        store.save_task(&task).unwrap();

        let result = execute(
            store.as_ref(),
            &workflow,
            &iteration_service,
            &task.id,
            "Some feedback",
        );
        assert!(matches!(result, Err(WorkflowError::InvalidTransition(_))));
    }

    #[test]
    fn test_request_update_empty_feedback() {
        let store = Arc::new(InMemoryWorkflowStore::new());
        let workflow = test_workflow();
        let iteration_service = IterationService::new(store.clone());
        let task = create_done_task(&store);

        // Empty feedback should be rejected
        let result = execute(store.as_ref(), &workflow, &iteration_service, &task.id, "");
        assert!(matches!(result, Err(WorkflowError::InvalidTransition(_))));

        // Whitespace-only feedback should also be rejected
        let result = execute(
            store.as_ref(),
            &workflow,
            &iteration_service,
            &task.id,
            "   \n\t  ",
        );
        assert!(matches!(result, Err(WorkflowError::InvalidTransition(_))));
    }
}
