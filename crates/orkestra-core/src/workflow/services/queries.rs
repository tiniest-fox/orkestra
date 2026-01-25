//! Read-only query operations.

use crate::workflow::domain::{Iteration, Question};
use crate::workflow::ports::WorkflowResult;
use crate::workflow::runtime::{Artifact, Outcome};

use super::WorkflowApi;

impl WorkflowApi {
    /// Get pending questions for a task.
    pub fn get_pending_questions(&self, task_id: &str) -> WorkflowResult<Vec<Question>> {
        let task = self.get_task(task_id)?;
        Ok(task.pending_questions)
    }

    /// Get a specific artifact by name.
    pub fn get_artifact(&self, task_id: &str, name: &str) -> WorkflowResult<Option<Artifact>> {
        let task = self.get_task(task_id)?;
        Ok(task.artifacts.get(name).cloned())
    }

    /// Get all iterations for a task.
    pub fn get_iterations(&self, task_id: &str) -> WorkflowResult<Vec<Iteration>> {
        self.store.get_iterations(task_id)
    }

    /// Get the latest iteration for a specific stage.
    pub fn get_latest_iteration(
        &self,
        task_id: &str,
        stage: &str,
    ) -> WorkflowResult<Option<Iteration>> {
        self.store.get_latest_iteration(task_id, stage)
    }

    /// Get feedback from the last rejection (for agent prompts).
    ///
    /// Returns the feedback from the most recent `Rejected` or `Restage` outcome
    /// for the task's current stage, if any.
    pub fn get_rejection_feedback(&self, task_id: &str) -> WorkflowResult<Option<String>> {
        let task = self.get_task(task_id)?;

        let current_stage = match task.current_stage() {
            Some(s) => s,
            None => return Ok(None),
        };

        // Get iterations for current stage
        let iterations = self.store.get_iterations_for_stage(task_id, current_stage)?;

        // Find the most recent rejection or restage outcome
        for iteration in iterations.into_iter().rev() {
            match iteration.outcome {
                Some(Outcome::Rejected { feedback, .. }) => {
                    return Ok(Some(feedback));
                }
                Some(Outcome::Restage { feedback, .. }) => {
                    return Ok(Some(feedback));
                }
                _ => continue,
            }
        }

        Ok(None)
    }

    /// Check if a task has pending questions.
    pub fn has_pending_questions(&self, task_id: &str) -> WorkflowResult<bool> {
        let task = self.get_task(task_id)?;
        Ok(!task.pending_questions.is_empty())
    }

    /// Get the current stage name for a task.
    pub fn get_current_stage(&self, task_id: &str) -> WorkflowResult<Option<String>> {
        let task = self.get_task(task_id)?;
        Ok(task.current_stage().map(|s| s.to_string()))
    }
}

#[cfg(test)]
mod tests {
    use crate::workflow::config::{StageCapabilities, StageConfig, WorkflowConfig};
    use crate::workflow::execution::StageOutput;
    use crate::workflow::runtime::Status;
    use crate::workflow::InMemoryWorkflowStore;

    use super::*;

    fn test_workflow() -> WorkflowConfig {
        WorkflowConfig::new(vec![
            StageConfig::new("planning", "plan")
                .with_capabilities(StageCapabilities::with_questions()),
            StageConfig::new("work", "summary").with_inputs(vec!["plan".into()]),
        ])
    }

    #[test]
    fn test_get_pending_questions() {
        let workflow = test_workflow();
        let store = Box::new(InMemoryWorkflowStore::new());
        let api = WorkflowApi::new(workflow, store);

        let mut task = api.create_task("Test", "Description").unwrap();
        task.pending_questions = vec![Question::new("q1", "What framework?")];
        api.store.save_task(&task).unwrap();

        let questions = api.get_pending_questions(&task.id).unwrap();
        assert_eq!(questions.len(), 1);
        assert_eq!(questions[0].question, "What framework?");
    }

    #[test]
    fn test_get_artifact() {
        let workflow = test_workflow();
        let store = Box::new(InMemoryWorkflowStore::new());
        let api = WorkflowApi::new(workflow, store);

        let task = api.create_task("Test", "Description").unwrap();
        let task = api.agent_started(&task.id).unwrap();
        let _ = api
            .process_agent_output(
                &task.id,
                StageOutput::Artifact {
                    content: "The plan".to_string(),
                },
            )
            .unwrap();

        let artifact = api.get_artifact(&task.id, "plan").unwrap();
        assert!(artifact.is_some());
        assert_eq!(artifact.unwrap().content, "The plan");

        let missing = api.get_artifact(&task.id, "nonexistent").unwrap();
        assert!(missing.is_none());
    }

    #[test]
    fn test_get_iterations() {
        let workflow = test_workflow();
        let store = Box::new(InMemoryWorkflowStore::new());
        let api = WorkflowApi::new(workflow, store);

        let task = api.create_task("Test", "Description").unwrap();

        let iterations = api.get_iterations(&task.id).unwrap();
        assert_eq!(iterations.len(), 1);
        assert_eq!(iterations[0].stage, "planning");
    }

    #[test]
    fn test_get_latest_iteration() {
        let workflow = test_workflow();
        let store = Box::new(InMemoryWorkflowStore::new());
        let api = WorkflowApi::new(workflow, store);

        let task = api.create_task("Test", "Description").unwrap();

        let latest = api.get_latest_iteration(&task.id, "planning").unwrap();
        assert!(latest.is_some());
        assert_eq!(latest.unwrap().stage, "planning");

        let missing = api.get_latest_iteration(&task.id, "work").unwrap();
        assert!(missing.is_none());
    }

    #[test]
    fn test_get_rejection_feedback() {
        let workflow = test_workflow();
        let store = Box::new(InMemoryWorkflowStore::new());
        let api = WorkflowApi::new(workflow, store);

        let task = api.create_task("Test", "Description").unwrap();

        // Initially no feedback
        let feedback = api.get_rejection_feedback(&task.id).unwrap();
        assert!(feedback.is_none());

        // Simulate producing artifact and getting rejected
        let task = api.agent_started(&task.id).unwrap();
        let task = api
            .process_agent_output(
                &task.id,
                StageOutput::Artifact {
                    content: "Plan v1".to_string(),
                },
            )
            .unwrap();
        let _ = api.reject(&task.id, "Please add more detail").unwrap();

        // Now should have feedback
        let feedback = api.get_rejection_feedback(&task.id).unwrap();
        assert_eq!(feedback, Some("Please add more detail".to_string()));
    }

    #[test]
    fn test_has_pending_questions() {
        let workflow = test_workflow();
        let store = Box::new(InMemoryWorkflowStore::new());
        let api = WorkflowApi::new(workflow, store);

        let mut task = api.create_task("Test", "Description").unwrap();
        assert!(!api.has_pending_questions(&task.id).unwrap());

        task.pending_questions = vec![Question::new("q1", "What framework?")];
        api.store.save_task(&task).unwrap();

        assert!(api.has_pending_questions(&task.id).unwrap());
    }

    #[test]
    fn test_get_current_stage() {
        let workflow = test_workflow();
        let store = Box::new(InMemoryWorkflowStore::new());
        let api = WorkflowApi::new(workflow, store);

        let task = api.create_task("Test", "Description").unwrap();
        assert_eq!(
            api.get_current_stage(&task.id).unwrap(),
            Some("planning".to_string())
        );

        let mut done_task = api.create_task("Done", "Done task").unwrap();
        done_task.status = Status::Done;
        api.store.save_task(&done_task).unwrap();

        assert_eq!(api.get_current_stage(&done_task.id).unwrap(), None);
    }
}
