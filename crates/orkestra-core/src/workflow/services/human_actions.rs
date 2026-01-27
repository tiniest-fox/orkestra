//! Human/UI actions: approve, reject, answer questions.

use crate::orkestra_debug;
use crate::workflow::domain::{IterationTrigger, QuestionAnswer, Task};
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

        orkestra_debug!(
            "action",
            "approve {}: from stage {}",
            task_id,
            current_stage
        );

        // End current iteration
        self.end_current_iteration(&task, Outcome::Approved)?;

        // Compute next status (skipping optional stages)
        let next_status = self.compute_next_status_on_approve(&current_stage);
        let now = chrono::Utc::now().to_rfc3339();

        task.status = next_status.clone();
        task.phase = Phase::Idle;
        task.updated_at = now.clone();

        // If we moved to a new stage, create new iteration via IterationService
        if let Some(new_stage) = next_status.stage() {
            if new_stage != current_stage {
                self.iteration_service
                    .create_iteration(&task.id, new_stage, None)?;
            }
        }

        if task.is_done() {
            task.completed_at = Some(now);
            orkestra_debug!("action", "approve {}: task is now Done", task_id);
        } else {
            orkestra_debug!(
                "action",
                "approve {}: moved to stage {:?}",
                task_id,
                task.current_stage()
            );
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

        orkestra_debug!(
            "action",
            "reject {}: stage={}, feedback_len={}",
            task_id,
            current_stage,
            feedback.len()
        );

        // End current iteration with rejection
        self.end_current_iteration(&task, Outcome::rejected(&current_stage, feedback))?;

        // Stay in same stage, go back to Idle
        let now = chrono::Utc::now().to_rfc3339();
        task.phase = Phase::Idle;
        task.updated_at = now.clone();

        // Create new iteration in same stage with feedback context via IterationService
        self.iteration_service.create_iteration(
            &task.id,
            &current_stage,
            Some(IterationTrigger::Feedback {
                feedback: feedback.to_string(),
            }),
        )?;

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

        let current_stage = task
            .current_stage()
            .ok_or_else(|| WorkflowError::InvalidTransition("Task not in active stage".into()))?
            .to_string();

        // Get questions from latest iteration's outcome
        let prev_iter = self
            .store
            .get_latest_iteration(&task.id, &current_stage)?
            .ok_or_else(|| WorkflowError::InvalidTransition("No iteration to answer".into()))?;

        // Verify there are pending questions in the outcome
        let _questions = match &prev_iter.outcome {
            Some(Outcome::AwaitingAnswers { questions, .. }) if !questions.is_empty() => questions,
            _ => {
                return Err(WorkflowError::InvalidTransition(
                    "No pending questions to answer".into(),
                ))
            }
        };

        orkestra_debug!(
            "action",
            "answer_questions {}: {} answers provided",
            task_id,
            answers.len()
        );

        let now = chrono::Utc::now().to_rfc3339();

        // Create new iteration with Answers context via IterationService
        self.iteration_service.create_iteration(
            &task.id,
            &current_stage,
            Some(IterationTrigger::Answers { answers }),
        )?;

        // Task stays in same stage, phase goes back to Idle so agent can resume
        task.phase = Phase::Idle;
        task.updated_at = now;

        self.store.save_task(&task)?;
        Ok(task)
    }

    /// Retry a failed task by resuming it from its last active stage.
    ///
    /// This retrieves the last stage from the most recent iteration and
    /// transitions the task back to that stage with an Idle phase.
    ///
    /// # Errors
    ///
    /// Returns `InvalidTransition` if the task is not in Failed state.
    pub fn retry(&self, task_id: &str) -> WorkflowResult<Task> {
        let mut task = self.get_task(task_id)?;

        // Verify task is in failed state
        if !matches!(task.status, crate::workflow::runtime::Status::Failed { .. }) {
            return Err(WorkflowError::InvalidTransition(format!(
                "Cannot retry task {task_id} - not in failed state"
            )));
        }

        orkestra_debug!("action", "retry {}: recovering from failed state", task_id);

        // Get the last stage from the most recent iteration
        let iterations = self.store.get_iterations(&task.id)?;
        let last_stage = iterations
            .last()
            .map(|i| i.stage.clone())
            .unwrap_or_else(|| {
                self.workflow
                    .first_stage().map_or_else(|| "planning".to_string(), |s| s.name.clone())
            });

        let now = chrono::Utc::now().to_rfc3339();

        // Transition task back to its last stage with Idle phase
        task.status = crate::workflow::runtime::Status::active(&last_stage);
        task.phase = Phase::Idle;
        task.updated_at = now.clone();

        // Create new iteration with Interrupted trigger to indicate recovery via IterationService
        self.iteration_service.create_iteration(
            &task.id,
            &last_stage,
            Some(IterationTrigger::Interrupted),
        )?;

        // Save updated task
        self.store.save_task(&task)?;

        orkestra_debug!(
            "action",
            "retry {}: resumed in stage {}",
            task_id,
            last_stage
        );

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

        self.iteration_service
            .end_iteration(&task.id, current_stage, outcome)
    }
}

#[cfg(test)]
mod tests {
    use crate::workflow::config::{StageCapabilities, StageConfig, WorkflowConfig};
    use crate::workflow::domain::Question;
    use crate::workflow::runtime::{Artifact, Status};
    use crate::workflow::InMemoryWorkflowStore;
    use std::sync::Arc;

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
        let store = Arc::new(InMemoryWorkflowStore::new());
        let api = WorkflowApi::new(workflow, store);

        let task = api.create_task("Test", "Description", None).unwrap();
        let task_id = task.id.clone();

        // Wait for async setup to complete with bounded polling (robust for slow CI)
        let mut task = {
            let mut result = None;
            for _ in 0..100 {
                std::thread::sleep(std::time::Duration::from_millis(10));
                let task = api.get_task(&task_id).unwrap();
                if task.phase != Phase::SettingUp {
                    result = Some(task);
                    break;
                }
            }
            result.expect("Task setup should complete within 1 second")
        };

        // Verify setup succeeded
        assert_eq!(task.phase, Phase::Idle, "Task setup should complete");
        assert!(task.status.is_active(), "Task should not fail during setup");

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
        let store = Arc::new(InMemoryWorkflowStore::new());
        let api = WorkflowApi::new(workflow, store);

        let task = api.create_task("Test", "Description", None).unwrap();
        let task_id = task.id.clone();

        // Wait for async setup to complete with bounded polling
        let mut task = {
            let mut result = None;
            for _ in 0..100 {
                std::thread::sleep(std::time::Duration::from_millis(10));
                let task = api.get_task(&task_id).unwrap();
                if task.phase != Phase::SettingUp {
                    result = Some(task);
                    break;
                }
            }
            result.expect("Task setup should complete within 1 second")
        };

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
        let store = Arc::new(InMemoryWorkflowStore::new());
        let api = WorkflowApi::new(workflow, store);

        let task = api.create_task("Test", "Description", None).unwrap();
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
    fn test_answer_questions_creates_new_iteration() {
        let workflow = test_workflow();
        let store = Arc::new(InMemoryWorkflowStore::new());
        let api = WorkflowApi::new(workflow, store);

        let mut task = api.create_task("Test", "Description", None).unwrap();

        // Simulate agent asking questions by ending iteration with AwaitingAnswers outcome
        let iter = api
            .store
            .get_latest_iteration(&task.id, "planning")
            .unwrap()
            .unwrap();
        let mut iter = iter;
        iter.outcome = Some(Outcome::awaiting_answers(
            "planning",
            vec![Question::new("q1", "What framework?")],
        ));
        iter.ended_at = Some(chrono::Utc::now().to_rfc3339());
        api.store.save_iteration(&iter).unwrap();
        task.phase = Phase::AwaitingReview;
        api.store.save_task(&task).unwrap();

        let answers = vec![QuestionAnswer::new(
            "q1",
            "What framework?",
            "React",
            chrono::Utc::now().to_rfc3339(),
        )];

        let task = api.answer_questions(&task.id, answers.clone()).unwrap();

        // Check that a new iteration was created with Answers context
        let iterations = api.store.get_iterations(&task.id).unwrap();
        assert_eq!(iterations.len(), 2);

        let new_iter = iterations.last().unwrap();
        match &new_iter.incoming_context {
            Some(IterationTrigger::Answers {
                answers: ctx_answers,
            }) => {
                assert_eq!(ctx_answers.len(), 1);
                assert_eq!(ctx_answers[0].answer, "React");
            }
            _ => panic!("Expected Answers context"),
        }

        assert_eq!(task.phase, Phase::Idle);
    }

    #[test]
    fn test_answer_questions_no_questions() {
        let workflow = test_workflow();
        let store = Arc::new(InMemoryWorkflowStore::new());
        let api = WorkflowApi::new(workflow, store);

        let task = api.create_task("Test", "Description", None).unwrap();

        let result = api.answer_questions(&task.id, vec![]);
        assert!(matches!(result, Err(WorkflowError::InvalidTransition(_))));
    }
}
