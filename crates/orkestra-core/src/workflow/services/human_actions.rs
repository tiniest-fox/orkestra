//! Human/UI actions: approve, reject, answer questions.

use crate::workflow::domain::{Iteration, QuestionAnswer, Task};
use crate::workflow::ports::{WorkflowError, WorkflowResult};
use crate::workflow::runtime::{Outcome, Phase};

use super::WorkflowApi;

impl WorkflowApi {
    /// Approve the current stage's artifact. Moves to next stage.
    ///
    /// # Errors
    ///
    /// Returns `InvalidTransition` if the task is not in `AwaitingReview` phase.
    pub fn approve(&self, task_id: &str) -> WorkflowResult<Task> {
        let mut task = self.get_task(task_id)?;

        if task.phase != Phase::AwaitingReview {
            return Err(WorkflowError::InvalidTransition(format!(
                "Cannot approve task in phase {:?}",
                task.phase
            )));
        }

        let current_stage = task
            .current_stage()
            .ok_or_else(|| WorkflowError::InvalidTransition("Task not in active stage".into()))?
            .to_string();

        // End current iteration
        self.end_current_iteration(&task, Outcome::Approved)?;

        // Compute next status (skipping optional stages)
        let next_status = self.compute_next_status_on_approve(&current_stage);
        let now = chrono::Utc::now().to_rfc3339();

        task.status = next_status.clone();
        task.phase = Phase::Idle;
        task.updated_at = now.clone();

        // If we moved to a new stage, create new iteration
        if let Some(new_stage) = next_status.stage() {
            if new_stage != current_stage {
                let iteration_count = self.store.get_iterations(&task.id)?.len() as u32;
                let iteration = Iteration::new(
                    format!("{}-iter-{}", task.id, iteration_count + 1),
                    &task.id,
                    new_stage,
                    iteration_count + 1,
                    &now,
                );
                self.store.save_iteration(&iteration)?;
            }
        }

        if task.is_done() {
            task.completed_at = Some(now);
        }

        self.store.save_task(&task)?;
        Ok(task)
    }

    /// Reject the current stage's artifact with feedback. Retries current stage.
    ///
    /// # Errors
    ///
    /// Returns `InvalidTransition` if the task is not in `AwaitingReview` phase.
    pub fn reject(&self, task_id: &str, feedback: &str) -> WorkflowResult<Task> {
        let mut task = self.get_task(task_id)?;

        if task.phase != Phase::AwaitingReview {
            return Err(WorkflowError::InvalidTransition(format!(
                "Cannot reject task in phase {:?}",
                task.phase
            )));
        }

        let current_stage = task
            .current_stage()
            .ok_or_else(|| WorkflowError::InvalidTransition("Task not in active stage".into()))?
            .to_string();

        // End current iteration with rejection
        self.end_current_iteration(&task, Outcome::rejected(&current_stage, feedback))?;

        // Stay in same stage, go back to Idle
        let now = chrono::Utc::now().to_rfc3339();
        task.phase = Phase::Idle;
        task.updated_at = now.clone();

        // Create new iteration in same stage
        let iteration_count = self.store.get_iterations(&task.id)?.len() as u32;
        let iteration = Iteration::new(
            format!("{}-iter-{}", task.id, iteration_count + 1),
            &task.id,
            &current_stage,
            iteration_count + 1,
            &now,
        );
        self.store.save_iteration(&iteration)?;

        self.store.save_task(&task)?;
        Ok(task)
    }

    /// Answer pending questions from the agent.
    ///
    /// # Errors
    ///
    /// Returns `InvalidTransition` if there are no pending questions.
    pub fn answer_questions(
        &self,
        task_id: &str,
        answers: Vec<QuestionAnswer>,
    ) -> WorkflowResult<Task> {
        let mut task = self.get_task(task_id)?;

        if task.pending_questions.is_empty() {
            return Err(WorkflowError::InvalidTransition(
                "No pending questions to answer".into(),
            ));
        }

        // Move questions to history with answers
        task.question_history.extend(answers);
        task.pending_questions.clear();

        // Task stays in same stage, phase goes back to Idle so agent can resume
        task.phase = Phase::Idle;
        task.updated_at = chrono::Utc::now().to_rfc3339();

        self.store.save_task(&task)?;
        Ok(task)
    }

    /// Helper: End the current active iteration with an outcome.
    pub(crate) fn end_current_iteration(
        &self,
        task: &Task,
        outcome: Outcome,
    ) -> WorkflowResult<()> {
        let current_stage = task
            .current_stage()
            .ok_or_else(|| WorkflowError::InvalidTransition("Task not in active stage".into()))?;

        if let Some(mut iteration) = self.store.get_active_iteration(&task.id, current_stage)? {
            let now = chrono::Utc::now().to_rfc3339();
            iteration.ended_at = Some(now);
            iteration.outcome = Some(outcome);
            self.store.save_iteration(&iteration)?;
        }

        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use crate::workflow::config::{StageCapabilities, StageConfig, WorkflowConfig};
    use crate::workflow::domain::Question;
    use crate::workflow::runtime::{Artifact, Status};
    use crate::workflow::InMemoryWorkflowStore;

    use super::*;

    fn test_workflow() -> WorkflowConfig {
        WorkflowConfig::new(vec![
            StageConfig::new("planning", "plan")
                .with_capabilities(StageCapabilities::with_questions()),
            StageConfig::new("work", "summary").with_inputs(vec!["plan".into()]),
            StageConfig::new("review", "verdict")
                .with_inputs(vec!["summary".into()])
                .automated(),
        ])
    }

    fn api_with_task_in_review() -> (WorkflowApi, Task) {
        let workflow = test_workflow();
        let store = Box::new(InMemoryWorkflowStore::new());
        let api = WorkflowApi::new(workflow, store);

        let mut task = api.create_task("Test", "Description").unwrap();

        // Simulate agent producing artifact and going to review
        let now = chrono::Utc::now().to_rfc3339();
        task.artifacts
            .set(Artifact::new("plan", "The plan", "planning", &now));
        task.phase = Phase::AwaitingReview;
        api.store.save_task(&task).unwrap();

        (api, task)
    }

    #[test]
    fn test_approve_moves_to_next_stage() {
        let (api, task) = api_with_task_in_review();

        let task = api.approve(&task.id).unwrap();

        assert_eq!(task.current_stage(), Some("work"));
        assert_eq!(task.phase, Phase::Idle);
    }

    #[test]
    fn test_approve_from_last_stage_marks_done() {
        let workflow = test_workflow();
        let store = Box::new(InMemoryWorkflowStore::new());
        let api = WorkflowApi::new(workflow, store);

        let mut task = api.create_task("Test", "Description").unwrap();

        // Move to review stage
        task.status = Status::active("review");
        task.phase = Phase::AwaitingReview;
        let now = chrono::Utc::now().to_rfc3339();
        task.artifacts
            .set(Artifact::new("verdict", "Approved", "review", &now));
        api.store.save_task(&task).unwrap();

        let task = api.approve(&task.id).unwrap();

        assert!(task.is_done());
        assert!(task.completed_at.is_some());
    }

    #[test]
    fn test_approve_invalid_phase() {
        let workflow = test_workflow();
        let store = Box::new(InMemoryWorkflowStore::new());
        let api = WorkflowApi::new(workflow, store);

        let task = api.create_task("Test", "Description").unwrap();
        // Task is in Idle phase, not AwaitingReview

        let result = api.approve(&task.id);
        assert!(matches!(result, Err(WorkflowError::InvalidTransition(_))));
    }

    #[test]
    fn test_reject_stays_in_same_stage() {
        let (api, task) = api_with_task_in_review();

        let task = api.reject(&task.id, "Please add more detail").unwrap();

        assert_eq!(task.current_stage(), Some("planning"));
        assert_eq!(task.phase, Phase::Idle);
    }

    #[test]
    fn test_reject_creates_new_iteration() {
        let (api, task) = api_with_task_in_review();

        let _ = api.reject(&task.id, "Please add more detail").unwrap();

        let iterations = api.get_iterations(&task.id).unwrap();
        assert_eq!(iterations.len(), 2);
        assert_eq!(iterations[1].stage, "planning");
        assert_eq!(iterations[1].iteration_number, 2);
    }

    #[test]
    fn test_reject_records_feedback_in_outcome() {
        let (api, task) = api_with_task_in_review();

        let _ = api.reject(&task.id, "Please add more detail").unwrap();

        let iterations = api.get_iterations(&task.id).unwrap();
        let first_iteration = &iterations[0];

        match &first_iteration.outcome {
            Some(Outcome::Rejected { feedback, .. }) => {
                assert_eq!(feedback, "Please add more detail");
            }
            other => panic!("Expected Rejected outcome, got {:?}", other),
        }
    }

    #[test]
    fn test_answer_questions_clears_pending() {
        let workflow = test_workflow();
        let store = Box::new(InMemoryWorkflowStore::new());
        let api = WorkflowApi::new(workflow, store);

        let mut task = api.create_task("Test", "Description").unwrap();

        // Simulate agent asking questions
        task.pending_questions = vec![Question::new("q1", "What framework?")];
        task.phase = Phase::AwaitingReview;
        api.store.save_task(&task).unwrap();

        let answers = vec![QuestionAnswer::new(
            "q1",
            "What framework?",
            "React",
            chrono::Utc::now().to_rfc3339(),
        )];

        let task = api.answer_questions(&task.id, answers).unwrap();

        assert!(task.pending_questions.is_empty());
        assert_eq!(task.question_history.len(), 1);
        assert_eq!(task.phase, Phase::Idle);
    }

    #[test]
    fn test_answer_questions_no_questions() {
        let workflow = test_workflow();
        let store = Box::new(InMemoryWorkflowStore::new());
        let api = WorkflowApi::new(workflow, store);

        let task = api.create_task("Test", "Description").unwrap();

        let result = api.answer_questions(&task.id, vec![]);
        assert!(matches!(result, Err(WorkflowError::InvalidTransition(_))));
    }
}
