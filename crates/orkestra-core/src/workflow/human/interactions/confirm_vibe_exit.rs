//! Override the proposed vibe exit destination and enter the commit pipeline.

use crate::workflow::config::WorkflowConfig;
use crate::workflow::domain::Task;
use crate::workflow::iteration::IterationService;
use crate::workflow::ports::{WorkflowError, WorkflowResult, WorkflowStore};
use crate::workflow::stage::interactions as stage;

pub fn execute(
    store: &dyn WorkflowStore,
    iteration_service: &IterationService,
    workflow: &WorkflowConfig,
    task_id: &str,
    destination: &str,
) -> WorkflowResult<Task> {
    let mut task = store
        .get_task(task_id)?
        .ok_or_else(|| WorkflowError::TaskNotFound(task_id.into()))?;

    // Must be awaiting review
    if !task.is_awaiting_review() {
        return Err(WorkflowError::InvalidTransition(format!(
            "Cannot confirm vibe exit in state {} (expected AwaitingApproval)",
            task.state
        )));
    }

    // Must be in vibe mode
    if task.vibe_origin.is_none() {
        return Err(WorkflowError::InvalidTransition(
            "Task is not in vibe mode; use approve instead".into(),
        ));
    }

    // Validate destination against the origin flow
    let valid_destinations = workflow.vibe_valid_destinations(&task);
    if !valid_destinations.iter().any(|d| d == destination) {
        return Err(WorkflowError::InvalidTransition(format!(
            "Invalid vibe destination: {destination}"
        )));
    }

    // Override proposed destination
    if let Some(ref mut origin) = task.vibe_origin {
        origin.proposed_destination = Some(destination.to_string());
    }

    let now = chrono::Utc::now().to_rfc3339();
    stage::enter_commit_pipeline::execute(iteration_service, &mut task, &now)?;

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
    use crate::workflow::adapters::InMemoryWorkflowStore;
    use crate::workflow::config::{IntegrationConfig, StageConfig, WorkflowConfig};
    use crate::workflow::iteration::IterationService;
    use crate::workflow::ports::WorkflowStore;
    use crate::workflow::runtime::TaskState;
    use orkestra_types::domain::VibeOrigin;

    fn make_workflow() -> WorkflowConfig {
        WorkflowConfig::new(vec![
            StageConfig::new("work", "summary"),
            StageConfig::new("review", "verdict"),
        ])
        .with_integration(IntegrationConfig::new("work"))
    }

    fn make_store_and_service() -> (Arc<InMemoryWorkflowStore>, IterationService) {
        let store = Arc::new(InMemoryWorkflowStore::new());
        let service = IterationService::new(Arc::clone(&store) as Arc<dyn WorkflowStore>);
        (store, service)
    }

    fn make_vibe_task(
        store: &Arc<InMemoryWorkflowStore>,
        iteration_service: &IterationService,
    ) -> Task {
        use crate::testutil::fixtures::tasks;
        let mut task = tasks::save_task(store.as_ref(), "task-1", "vibe", "Test", "Desc").unwrap();
        task.state = TaskState::awaiting_approval("vibe");
        task.worktree_path = Some("/tmp/worktree".into());
        task.vibe_origin = Some(VibeOrigin {
            flow: "default".to_string(),
            stage: Some("work".to_string()),
            proposed_destination: Some("work".to_string()),
        });
        store.save_task(&task).unwrap();
        iteration_service
            .create_iteration(&task.id, "vibe", None)
            .unwrap();
        task
    }

    #[test]
    fn test_confirm_vibe_exit_overrides_destination() {
        let (store, iteration_service) = make_store_and_service();
        let workflow = make_workflow();
        let task = make_vibe_task(&store, &iteration_service);

        let result = execute(
            store.as_ref(),
            &iteration_service,
            &workflow,
            &task.id,
            "review",
        )
        .unwrap();

        // Should enter commit pipeline (Finishing state)
        assert!(matches!(result.state, TaskState::Finishing { .. }));
        // Destination override stored
        let origin = result.vibe_origin.as_ref().unwrap();
        assert_eq!(origin.proposed_destination.as_deref(), Some("review"));
    }

    #[test]
    fn test_confirm_vibe_exit_invalid_destination() {
        let (store, iteration_service) = make_store_and_service();
        let workflow = make_workflow();
        let task = make_vibe_task(&store, &iteration_service);

        let result = execute(
            store.as_ref(),
            &iteration_service,
            &workflow,
            &task.id,
            "nonexistent_stage",
        );

        assert!(
            matches!(result, Err(WorkflowError::InvalidTransition(_))),
            "Expected InvalidTransition for unknown destination"
        );
    }

    #[test]
    fn test_confirm_vibe_exit_not_awaiting_approval() {
        let (store, iteration_service) = make_store_and_service();
        let workflow = make_workflow();
        let mut task = make_vibe_task(&store, &iteration_service);
        task.state = TaskState::agent_working("vibe");
        store.save_task(&task).unwrap();

        let result = execute(
            store.as_ref(),
            &iteration_service,
            &workflow,
            &task.id,
            "work",
        );

        assert!(
            matches!(result, Err(WorkflowError::InvalidTransition(_))),
            "Expected InvalidTransition when not awaiting approval"
        );
    }

    #[test]
    fn test_confirm_vibe_exit_not_in_vibe_mode() {
        let (store, iteration_service) = make_store_and_service();
        let workflow = make_workflow();
        let mut task = make_vibe_task(&store, &iteration_service);
        task.vibe_origin = None;
        store.save_task(&task).unwrap();

        let result = execute(
            store.as_ref(),
            &iteration_service,
            &workflow,
            &task.id,
            "work",
        );

        assert!(
            matches!(result, Err(WorkflowError::InvalidTransition(_))),
            "Expected InvalidTransition when not in vibe mode"
        );
    }
}
