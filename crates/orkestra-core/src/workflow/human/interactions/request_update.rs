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

    let recovery_stage = resolve_recovery_stage(workflow, task.flow.as_deref())?;

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

    // Create new iteration with feedback trigger
    iteration_service.create_iteration(
        task_id,
        &recovery_stage,
        Some(IterationTrigger::Feedback {
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

// -- Helpers --

fn resolve_recovery_stage(workflow: &WorkflowConfig, flow: Option<&str>) -> WorkflowResult<String> {
    let configured = workflow.effective_integration_on_failure(flow);
    if workflow.stage_in_flow(configured, flow) {
        return Ok(configured.to_string());
    }
    workflow
        .first_stage_in_flow(flow)
        .map(|s| s.name.clone())
        .ok_or_else(|| WorkflowError::InvalidTransition("No recovery stage configured".into()))
}

// ============================================================================
// Tests
// ============================================================================

#[cfg(test)]
mod tests {
    use super::*;
    use crate::workflow::adapters::InMemoryWorkflowStore;
    use crate::workflow::config::{
        IntegrationConfig, StageCapabilities, StageConfig, WorkflowConfig,
    };
    use crate::workflow::domain::Task;
    use crate::workflow::iteration::IterationService;
    use std::sync::Arc;

    fn test_workflow() -> WorkflowConfig {
        WorkflowConfig {
            stages: vec![
                StageConfig {
                    name: "planning".to_string(),
                    artifact: "plan".to_string(),
                    ..Default::default()
                },
                StageConfig {
                    name: "work".to_string(),
                    artifact: "summary".to_string(),
                    capabilities: StageCapabilities {
                        approval: Some(Default::default()),
                        ..Default::default()
                    },
                    ..Default::default()
                },
            ],
            integration: IntegrationConfig {
                on_failure: "work".to_string(),
                ..Default::default()
            },
            ..Default::default()
        }
    }

    fn create_done_task(store: &Arc<InMemoryWorkflowStore>) -> Task {
        let mut task = Task::new("task-1", "Test", "Description", "now");
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
            Some(IterationTrigger::Feedback { feedback }) => {
                assert_eq!(feedback, "Add more tests");
            }
            other => panic!("Expected Feedback trigger, got {other:?}"),
        }
    }

    #[test]
    fn test_request_update_not_done() {
        let store = Arc::new(InMemoryWorkflowStore::new());
        let workflow = test_workflow();
        let iteration_service = IterationService::new(store.clone());

        // Create task in Queued state (not Done)
        let mut task = Task::new("task-1", "Test", "Description", "now");
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
        let result = execute(
            store.as_ref(),
            &workflow,
            &iteration_service,
            &task.id,
            "",
        );
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
