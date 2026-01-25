//! Git integration operations: success/failure handling.

use crate::workflow::domain::{Iteration, Task};
use crate::workflow::ports::{WorkflowError, WorkflowResult};
use crate::workflow::runtime::{Outcome, Phase, Status};

use super::WorkflowApi;

impl WorkflowApi {
    /// Record successful integration (merge).
    ///
    /// This marks the task as fully complete after its branch has been merged.
    ///
    /// # Errors
    ///
    /// Returns `InvalidTransition` if the task is not Done.
    pub fn integration_succeeded(&self, task_id: &str) -> WorkflowResult<Task> {
        let task = self.get_task(task_id)?;

        if !task.is_done() {
            return Err(WorkflowError::InvalidTransition(
                "Cannot integrate task that is not Done".into(),
            ));
        }

        // Task is already Done - integration is just recording success
        // Could add an "Integrated" status in the future if needed
        Ok(task)
    }

    /// Record failed integration (merge conflict). Returns task to recovery stage.
    ///
    /// The task is moved back to the stage configured in `integration.on_failure`
    /// (defaults to the last non-optional stage, typically "work").
    ///
    /// # Arguments
    ///
    /// * `task_id` - The task ID
    /// * `error` - Error message describing the integration failure
    /// * `conflict_files` - List of files with merge conflicts
    ///
    /// # Errors
    ///
    /// Returns `InvalidTransition` if the task is not Done.
    pub fn integration_failed(
        &self,
        task_id: &str,
        error: &str,
        conflict_files: Vec<String>,
    ) -> WorkflowResult<Task> {
        let mut task = self.get_task(task_id)?;

        if !task.is_done() {
            return Err(WorkflowError::InvalidTransition(
                "Can only fail integration on Done task".into(),
            ));
        }

        let now = chrono::Utc::now().to_rfc3339();

        // Record integration failure in current iteration
        let iterations = self.store.get_iterations(&task.id)?;
        let iteration_count = iterations.len() as u32;

        // Create a new iteration to record the integration failure
        let mut integration_iter = Iteration::new(
            format!("{}-integration-fail", task.id),
            &task.id,
            "integration",
            iteration_count + 1,
            &now,
        );
        integration_iter.ended_at = Some(now.clone());
        integration_iter.outcome = Some(Outcome::IntegrationFailed {
            error: error.to_string(),
            conflict_files: conflict_files.clone(),
        });
        self.store.save_iteration(&integration_iter)?;

        // Determine which stage to return to
        let recovery_stage = self
            .integration_failure_stage()
            .ok_or_else(|| {
                WorkflowError::InvalidTransition("No recovery stage configured".into())
            })?
            .to_string();

        // Move task back to recovery stage
        task.status = Status::active(&recovery_stage);
        task.phase = Phase::Idle;
        task.completed_at = None;
        task.updated_at = now.clone();

        // Create new iteration in recovery stage
        let iteration = Iteration::new(
            format!("{}-iter-{}", task.id, iteration_count + 2),
            &task.id,
            &recovery_stage,
            iteration_count + 2,
            &now,
        );
        self.store.save_iteration(&iteration)?;

        self.store.save_task(&task)?;
        Ok(task)
    }
}

#[cfg(test)]
mod tests {
    use std::sync::Arc;
    use crate::workflow::config::{StageConfig, WorkflowConfig};
    use crate::workflow::InMemoryWorkflowStore;

    use super::*;

    fn test_workflow() -> WorkflowConfig {
        WorkflowConfig::new(vec![
            StageConfig::new("planning", "plan"),
            StageConfig::new("work", "summary").with_inputs(vec!["plan".into()]),
            StageConfig::new("review", "verdict")
                .with_inputs(vec!["summary".into()])
                .automated(),
        ])
    }

    fn api_with_done_task() -> (WorkflowApi, Task) {
        let workflow = test_workflow();
        let store = Arc::new(InMemoryWorkflowStore::new());
        let api = WorkflowApi::new(workflow, store);

        let mut task = api.create_task("Test", "Description").unwrap();
        task.status = Status::Done;
        task.completed_at = Some(chrono::Utc::now().to_rfc3339());
        api.store.save_task(&task).unwrap();

        (api, task)
    }

    #[test]
    fn test_integration_succeeded() {
        let (api, task) = api_with_done_task();

        let result = api.integration_succeeded(&task.id).unwrap();
        assert!(result.is_done());
    }

    #[test]
    fn test_integration_succeeded_not_done() {
        let workflow = test_workflow();
        let store = Arc::new(InMemoryWorkflowStore::new());
        let api = WorkflowApi::new(workflow, store);

        let task = api.create_task("Test", "Description").unwrap();

        let result = api.integration_succeeded(&task.id);
        assert!(matches!(result, Err(WorkflowError::InvalidTransition(_))));
    }

    #[test]
    fn test_integration_failed_returns_to_recovery_stage() {
        let (api, task) = api_with_done_task();

        let task = api
            .integration_failed(&task.id, "Merge conflict", vec!["src/main.rs".to_string()])
            .unwrap();

        // Should return to configured on_failure stage (default: "work")
        assert_eq!(task.current_stage(), Some("work"));
        assert_eq!(task.phase, Phase::Idle);
        assert!(task.completed_at.is_none());
    }

    #[test]
    fn test_integration_failed_creates_iteration() {
        let (api, task) = api_with_done_task();

        let _ = api
            .integration_failed(&task.id, "Merge conflict", vec!["src/main.rs".to_string()])
            .unwrap();

        let iterations = api.get_iterations(&task.id).unwrap();

        // Should have: initial + integration failure + recovery
        assert!(iterations.len() >= 2);

        // Find the integration failure iteration
        let integration_iter = iterations
            .iter()
            .find(|i| i.stage == "integration")
            .expect("Should have integration iteration");

        match &integration_iter.outcome {
            Some(Outcome::IntegrationFailed {
                error,
                conflict_files,
            }) => {
                assert_eq!(error, "Merge conflict");
                assert_eq!(conflict_files, &vec!["src/main.rs".to_string()]);
            }
            other => panic!("Expected IntegrationFailed outcome, got {:?}", other),
        }
    }

    #[test]
    fn test_integration_failed_not_done() {
        let workflow = test_workflow();
        let store = Arc::new(InMemoryWorkflowStore::new());
        let api = WorkflowApi::new(workflow, store);

        let task = api.create_task("Test", "Description").unwrap();

        let result = api.integration_failed(&task.id, "Error", vec![]);
        assert!(matches!(result, Err(WorkflowError::InvalidTransition(_))));
    }
}
