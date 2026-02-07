//! Human/UI actions: approve, reject, answer questions, toggle auto mode.

use crate::orkestra_debug;
use crate::workflow::domain::{IterationTrigger, QuestionAnswer, Task};
use crate::workflow::ports::{WorkflowError, WorkflowResult};
use crate::workflow::runtime::{Outcome, Phase, Status};

use super::agent_actions::AUTO_ANSWER_TEXT;
use super::SubtaskService;

use super::WorkflowApi;

impl WorkflowApi {
    /// Approve the current stage's artifact. Moves to next stage.
    ///
    /// When approving a breakdown stage that produced subtasks, this creates
    /// Task records for each subtask and sets the parent to `WaitingOnChildren`.
    ///
    /// When confirming a pending rejection, executes the rejection (moves to target stage).
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

        // Check for pending rejection review — "approve" means "confirm the rejection"
        if let Some((from_stage, target, feedback)) =
            self.pending_rejection_review(&task.id, &current_stage)?
        {
            orkestra_debug!(
                "action",
                "approve {}: confirming rejection from {} to {}",
                task_id,
                from_stage,
                target
            );
            let now = chrono::Utc::now().to_rfc3339();
            self.execute_rejection(&mut task, &from_stage, &target, &feedback, &now)?;
            self.store.save_task(&task)?;
            return Ok(task);
        }

        orkestra_debug!(
            "action",
            "approve {}: from stage {}",
            task_id,
            current_stage
        );

        // End current iteration
        self.end_current_iteration(&task, Outcome::Approved)?;

        // Check if this stage produced subtasks that need to be created
        if self.stage_has_subtasks(&current_stage, &task) {
            return self.approve_with_subtask_creation(&mut task, &current_stage);
        }

        // Standard approval: compute next status (flow-aware progression)
        self.apply_standard_approval(&mut task, &current_stage)
    }

    /// Approve a breakdown stage by creating subtask Task records and setting parent to `WaitingOnChildren`.
    fn approve_with_subtask_creation(
        &self,
        task: &mut Task,
        current_stage: &str,
    ) -> WorkflowResult<Task> {
        let artifact_name = self
            .workflow
            .stage(current_stage)
            .map_or_else(|| "breakdown".to_string(), |s| s.artifact.clone());

        let created = SubtaskService::create_subtasks_from_breakdown(
            task,
            &self.workflow,
            &self.store,
            &self.iteration_service,
            &artifact_name,
        )?;

        let now = chrono::Utc::now().to_rfc3339();

        if created.is_empty() {
            // No subtasks created (breakdown was skipped) - proceed normally
            return self.apply_standard_approval(task, current_stage);
        }

        orkestra_debug!(
            "action",
            "approve {}: created {} subtasks, setting WaitingOnChildren",
            task.id,
            created.len()
        );

        let next_stage = self
            .compute_next_status_on_approve(current_stage, task.flow.as_deref())
            .stage()
            .unwrap_or(current_stage)
            .to_string();
        task.status = Status::waiting_on_children(next_stage);
        task.phase = Phase::Idle;
        task.updated_at = now;

        self.store.save_task(task)?;
        Ok(task.clone())
    }

    /// Apply standard approval logic: advance to next stage or mark done.
    fn apply_standard_approval(
        &self,
        task: &mut Task,
        current_stage: &str,
    ) -> WorkflowResult<Task> {
        let next_status = self.compute_next_status_on_approve(current_stage, task.flow.as_deref());
        let now = chrono::Utc::now().to_rfc3339();

        task.status = next_status.clone();
        task.phase = Phase::Idle;
        task.updated_at.clone_from(&now);

        // If we moved to a new stage, create new iteration via IterationService
        if let Some(new_stage) = next_status.stage() {
            if new_stage != current_stage {
                self.iteration_service
                    .create_iteration(&task.id, new_stage, None)?;
            }
        }

        if task.is_done() {
            task.completed_at = Some(now);
            orkestra_debug!("action", "approve {}: task is now Done", task.id);
        } else {
            orkestra_debug!(
                "action",
                "approve {}: moved to stage {:?}",
                task.id,
                task.current_stage()
            );
        }

        self.store.save_task(task)?;
        Ok(task.clone())
    }

    /// Check if a stage produced subtasks that need to be materialized.
    ///
    /// Returns true if the stage has subtask capabilities and
    /// the task has structured subtask data stored.
    fn stage_has_subtasks(&self, stage: &str, task: &Task) -> bool {
        let has_capability = self
            .workflow
            .effective_capabilities(stage, task.flow.as_deref())
            .is_some_and(|caps| caps.produces_subtasks());

        if !has_capability {
            return false;
        }

        // Check if there's structured subtask data
        let artifact_name = self
            .workflow
            .stage(stage)
            .map_or_else(|| "breakdown".to_string(), |s| s.artifact.clone());
        let structured_key = format!("{artifact_name}_structured");

        task.artifacts.content(&structured_key).is_some()
    }

    /// Reject the current stage's artifact with feedback. Retries current stage.
    ///
    /// When overriding a pending rejection, stays in the same review stage and creates
    /// a new iteration with the human's feedback so the reviewer agent runs again.
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

        // Check for pending rejection review — "reject" means "override, request new verdict"
        if self
            .pending_rejection_review(&task.id, &current_stage)?
            .is_some()
        {
            orkestra_debug!(
                "action",
                "reject {}: overriding rejection, requesting new verdict in {}",
                task_id,
                current_stage
            );

            let now = chrono::Utc::now().to_rfc3339();

            // Don't call end_current_iteration — it was already ended with AwaitingRejectionReview
            // Create new iteration in the same review stage with human's feedback
            self.iteration_service.create_iteration(
                &task.id,
                &current_stage,
                Some(IterationTrigger::Feedback {
                    feedback: feedback.to_string(),
                }),
            )?;

            task.phase = Phase::Idle;
            task.updated_at = now;

            self.store.save_task(&task)?;
            return Ok(task);
        }

        orkestra_debug!(
            "action",
            "reject {}: stage={}, feedback_len={}",
            task_id,
            current_stage,
            feedback.len()
        );

        let now = chrono::Utc::now().to_rfc3339();

        // End current iteration with rejection
        self.end_current_iteration(&task, Outcome::rejected(&current_stage, feedback))?;

        // Stay in same stage, go back to Idle
        task.phase = Phase::Idle;
        task.updated_at.clone_from(&now);

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

    /// Retry a failed or blocked task by resuming it from its last active stage.
    ///
    /// This retrieves the last stage from the most recent iteration and
    /// transitions the task back to that stage with an Idle phase.
    ///
    /// # Errors
    ///
    /// Returns `InvalidTransition` if the task is not in Failed or Blocked state.
    pub fn retry(&self, task_id: &str, instructions: Option<&str>) -> WorkflowResult<Task> {
        let mut task = self.get_task(task_id)?;

        // Verify task is in a retryable state (failed or blocked)
        let was_failed = matches!(task.status, Status::Failed { .. });
        let was_blocked = matches!(task.status, Status::Blocked { .. });
        if !was_failed && !was_blocked {
            return Err(WorkflowError::InvalidTransition(format!(
                "Cannot retry task {task_id} - not in failed or blocked state"
            )));
        }

        orkestra_debug!(
            "action",
            "retry {}: recovering from {} state",
            task_id,
            task.status
        );

        // Get the last stage from the most recent iteration
        let iterations = self.store.get_iterations(&task.id)?;
        let last_stage = iterations.last().map_or_else(
            || {
                self.workflow
                    .first_stage_in_flow(task.flow.as_deref())
                    .map_or_else(|| "planning".to_string(), |s| s.name.clone())
            },
            |i| i.stage.clone(),
        );

        let now = chrono::Utc::now().to_rfc3339();

        // Transition task back to its last stage
        task.status = Status::active(&last_stage);

        // If worktree setup never completed, go back to AwaitingSetup
        if task.worktree_path.is_none() {
            task.phase = Phase::AwaitingSetup;
            orkestra_debug!(
                "action",
                "retry {}: no worktree_path, setting phase to AwaitingSetup",
                task_id
            );
        } else {
            task.phase = Phase::Idle;
        }

        task.updated_at.clone_from(&now);

        // Create new iteration with trigger that reflects the retry context
        let trimmed = instructions.map(str::trim).filter(|s| !s.is_empty());
        let trigger = if was_failed {
            IterationTrigger::RetryFailed {
                instructions: trimmed.map(String::from),
            }
        } else {
            IterationTrigger::RetryBlocked {
                instructions: trimmed.map(String::from),
            }
        };
        self.iteration_service
            .create_iteration(&task.id, &last_stage, Some(trigger))?;

        // Save updated task
        self.store.save_task(&task)?;

        orkestra_debug!(
            "action",
            "retry {}: resumed in stage {}, phase={:?}",
            task_id,
            last_stage,
            task.phase
        );

        Ok(task)
    }

    /// Set the `auto_mode` flag on a task, with immediate side effects.
    ///
    /// When toggling to `true`:
    /// - If the task is `AwaitingReview` with an artifact pending: auto-approves
    /// - If the task is `AwaitingReview` with questions pending: auto-answers them
    /// - Otherwise: saves the flag for the next stage completion
    ///
    /// When toggling to `false`: saves the flag, no immediate state change.
    ///
    /// If the immediate side effect fails, the toggle is rolled back.
    pub fn set_auto_mode(&self, task_id: &str, auto_mode: bool) -> WorkflowResult<Task> {
        let mut task = self.get_task(task_id)?;

        orkestra_debug!(
            "action",
            "set_auto_mode {}: {} -> {}",
            task_id,
            task.auto_mode,
            auto_mode
        );

        task.auto_mode = auto_mode;

        // When enabling auto mode, handle immediate side effects
        if auto_mode && task.phase == Phase::AwaitingReview {
            if let Some(current_stage) = task.current_stage().map(String::from) {
                // Check if there are pending questions
                let has_pending_questions = self
                    .store
                    .get_latest_iteration(&task.id, &current_stage)?
                    .and_then(|iter| match &iter.outcome {
                        Some(Outcome::AwaitingAnswers { questions, .. })
                            if !questions.is_empty() =>
                        {
                            Some(questions.clone())
                        }
                        _ => None,
                    });

                if let Some(questions) = has_pending_questions {
                    // Auto-answer questions
                    orkestra_debug!(
                        "action",
                        "set_auto_mode {}: auto-answering {} questions",
                        task_id,
                        questions.len()
                    );
                    let now = chrono::Utc::now().to_rfc3339();
                    let answers: Vec<QuestionAnswer> = questions
                        .iter()
                        .map(|q| QuestionAnswer::new(&q.question, AUTO_ANSWER_TEXT, &now))
                        .collect();

                    self.iteration_service.create_iteration(
                        &task.id,
                        &current_stage,
                        Some(IterationTrigger::Answers { answers }),
                    )?;
                    task.phase = Phase::Idle;
                    task.updated_at = now;
                } else if let Some((from_stage, target, feedback)) =
                    self.pending_rejection_review(&task.id, &current_stage)?
                {
                    // Auto-confirm pending rejection
                    orkestra_debug!(
                        "action",
                        "set_auto_mode {}: auto-confirming rejection from {} to {}",
                        task_id,
                        from_stage,
                        target
                    );
                    let now = chrono::Utc::now().to_rfc3339();
                    self.execute_rejection(&mut task, &from_stage, &target, &feedback, &now)?;
                } else {
                    self.auto_approve_stage(&mut task, &current_stage)?;
                }
            }
        } else {
            task.updated_at = chrono::Utc::now().to_rfc3339();
        }

        self.store.save_task(&task)?;
        Ok(task)
    }

    /// Auto-approve the current stage artifact and advance the task.
    ///
    /// Handles subtask creation if the stage has subtask capabilities.
    fn auto_approve_stage(&self, task: &mut Task, current_stage: &str) -> WorkflowResult<()> {
        orkestra_debug!(
            "action",
            "set_auto_mode {}: auto-approving stage {}",
            task.id,
            current_stage
        );
        self.end_current_iteration(task, Outcome::Approved)?;

        if self.stage_has_subtasks(current_stage, task) {
            let artifact_name = self
                .workflow
                .stage(current_stage)
                .map_or_else(|| "breakdown".to_string(), |s| s.artifact.clone());

            let created = SubtaskService::create_subtasks_from_breakdown(
                task,
                &self.workflow,
                &self.store,
                &self.iteration_service,
                &artifact_name,
            )?;

            if created.is_empty() {
                self.advance_to_next_stage(task, current_stage)?;
            } else {
                let now = chrono::Utc::now().to_rfc3339();
                let next_stage = self
                    .compute_next_status_on_approve(current_stage, task.flow.as_deref())
                    .stage()
                    .unwrap_or(current_stage)
                    .to_string();
                task.status = Status::waiting_on_children(next_stage);
                task.phase = Phase::Idle;
                task.updated_at = now;
            }
        } else {
            self.advance_to_next_stage(task, current_stage)?;
        }

        Ok(())
    }

    /// Advance a task to the next stage after approval.
    fn advance_to_next_stage(&self, task: &mut Task, current_stage: &str) -> WorkflowResult<()> {
        let next_status = self.compute_next_status_on_approve(current_stage, task.flow.as_deref());
        let now = chrono::Utc::now().to_rfc3339();

        task.status = next_status.clone();
        task.phase = Phase::Idle;
        task.updated_at.clone_from(&now);

        if let Some(new_stage) = next_status.stage() {
            if new_stage != current_stage {
                self.iteration_service
                    .create_iteration(&task.id, new_stage, None)?;
            }
        }
        if task.is_done() {
            task.completed_at = Some(now);
        }

        Ok(())
    }

    /// Check if the latest iteration has a pending rejection awaiting human review.
    ///
    /// Returns `Some((from_stage, target, feedback))` if found.
    fn pending_rejection_review(
        &self,
        task_id: &str,
        current_stage: &str,
    ) -> WorkflowResult<Option<(String, String, String)>> {
        let latest = self.store.get_latest_iteration(task_id, current_stage)?;

        if let Some(iter) = latest {
            if let Some(Outcome::AwaitingRejectionReview {
                from_stage,
                target,
                feedback,
            }) = &iter.outcome
            {
                return Ok(Some((from_stage.clone(), target.clone(), feedback.clone())));
            }
        }

        Ok(None)
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

        let mut task = api.create_task("Test", "Description", None).unwrap();

        // Unit tests don't have an orchestrator to run setup, so we manually
        // transition the task. This is fine because these tests are testing
        // human actions (approve/reject), not setup behavior.
        task.phase = Phase::Idle;
        api.store.save_task(&task).unwrap();

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

        let mut task = api.create_task("Test", "Description", None).unwrap();

        // Unit tests don't have an orchestrator, so manually complete setup
        task.phase = Phase::Idle;
        api.store.save_task(&task).unwrap();

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

        // Rejection should preserve the original agent artifact, not overwrite with feedback
        assert!(task.artifacts.get("plan").is_some());
        assert_eq!(task.artifacts.get("plan").unwrap().content, "The plan");
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
            other => panic!("Expected Rejected outcome, got {other:?}"),
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
            vec![Question::new("What framework?")],
        ));
        iter.ended_at = Some(chrono::Utc::now().to_rfc3339());
        api.store.save_iteration(&iter).unwrap();
        task.phase = Phase::AwaitingReview;
        api.store.save_task(&task).unwrap();

        let answers = vec![QuestionAnswer::new(
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

    /// Create an API with a task in Failed state at the planning stage.
    fn api_with_failed_task() -> (WorkflowApi, Task) {
        let workflow = test_workflow();
        let store = Arc::new(InMemoryWorkflowStore::new());
        let api = WorkflowApi::new(workflow, store);

        let mut task = api.create_task("Test", "Description", None).unwrap();

        // Simulate setup completion + agent failure
        task.phase = Phase::Idle;
        task.worktree_path = Some("/tmp/fake-worktree".into());
        task.status = Status::failed("Something went wrong");
        api.store.save_task(&task).unwrap();

        (api, task)
    }

    /// Create an API with a task in Blocked state at the planning stage.
    fn api_with_blocked_task() -> (WorkflowApi, Task) {
        let workflow = test_workflow();
        let store = Arc::new(InMemoryWorkflowStore::new());
        let api = WorkflowApi::new(workflow, store);

        let mut task = api.create_task("Test", "Description", None).unwrap();

        // Simulate setup completion + agent blocked
        task.phase = Phase::Idle;
        task.worktree_path = Some("/tmp/fake-worktree".into());
        task.status = Status::blocked("Waiting on external service");
        api.store.save_task(&task).unwrap();

        (api, task)
    }

    #[test]
    fn test_retry_failed_without_instructions() {
        let (api, task) = api_with_failed_task();

        let task = api.retry(&task.id, None).unwrap();

        assert_eq!(task.current_stage(), Some("planning"));
        assert_eq!(task.phase, Phase::Idle);
        assert!(matches!(task.status, Status::Active { .. }));

        let iterations = api.get_iterations(&task.id).unwrap();
        let last = iterations.last().unwrap();
        match &last.incoming_context {
            Some(IterationTrigger::RetryFailed { instructions }) => {
                assert!(instructions.is_none());
            }
            other => panic!("Expected RetryFailed trigger, got {other:?}"),
        }
    }

    #[test]
    fn test_retry_failed_with_instructions() {
        let (api, task) = api_with_failed_task();

        let task = api
            .retry(&task.id, Some("Try using the backup API endpoint"))
            .unwrap();

        assert_eq!(task.current_stage(), Some("planning"));
        assert_eq!(task.phase, Phase::Idle);

        let iterations = api.get_iterations(&task.id).unwrap();
        let last = iterations.last().unwrap();
        match &last.incoming_context {
            Some(IterationTrigger::RetryFailed { instructions }) => {
                assert_eq!(
                    instructions.as_deref(),
                    Some("Try using the backup API endpoint")
                );
            }
            other => panic!("Expected RetryFailed trigger, got {other:?}"),
        }
    }

    #[test]
    fn test_retry_blocked_with_instructions() {
        let (api, task) = api_with_blocked_task();

        let task = api
            .retry(&task.id, Some("The dependency is now available"))
            .unwrap();

        assert_eq!(task.current_stage(), Some("planning"));
        assert_eq!(task.phase, Phase::Idle);

        let iterations = api.get_iterations(&task.id).unwrap();
        let last = iterations.last().unwrap();
        match &last.incoming_context {
            Some(IterationTrigger::RetryBlocked { instructions }) => {
                assert_eq!(
                    instructions.as_deref(),
                    Some("The dependency is now available")
                );
            }
            other => panic!("Expected RetryBlocked trigger, got {other:?}"),
        }
    }

    #[test]
    fn test_retry_with_empty_instructions() {
        let (api, task) = api_with_failed_task();

        let task = api.retry(&task.id, Some("  ")).unwrap();

        let iterations = api.get_iterations(&task.id).unwrap();
        let last = iterations.last().unwrap();
        match &last.incoming_context {
            Some(IterationTrigger::RetryFailed { instructions }) => {
                assert!(instructions.is_none());
            }
            other => panic!("Expected RetryFailed with no instructions, got {other:?}"),
        }
    }

    // ========================================================================
    // Rejection review tests
    // ========================================================================

    /// Workflow with a non-automated review stage (rejection pauses for human review).
    fn test_workflow_with_review() -> WorkflowConfig {
        WorkflowConfig::new(vec![
            StageConfig::new("planning", "plan")
                .with_capabilities(StageCapabilities::with_questions()),
            StageConfig::new("work", "summary").with_inputs(vec!["plan".into()]),
            StageConfig::new("review", "verdict")
                .with_inputs(vec!["summary".into()])
                .with_capabilities(StageCapabilities::with_approval(Some("work".into()))),
        ])
    }

    /// Create an API with a task at review stage with a pending rejection verdict.
    fn api_with_pending_rejection() -> (WorkflowApi, Task) {
        use crate::workflow::execution::StageOutput;

        let workflow = test_workflow_with_review();
        let store = Arc::new(InMemoryWorkflowStore::new());
        let api = WorkflowApi::new(workflow, store);

        let mut task = api.create_task("Test", "Description", None).unwrap();
        task.phase = Phase::Idle;
        api.store.save_task(&task).unwrap();

        // Advance to review stage with agent working
        task.status = Status::active("review");
        task.phase = Phase::AgentWorking;
        api.store.save_task(&task).unwrap();
        api.iteration_service
            .create_iteration(&task.id, "review", None)
            .unwrap();

        // Simulate reviewer agent producing a rejection verdict
        let output = StageOutput::Approval {
            decision: "reject".to_string(),
            content: "Tests are failing, fix them".to_string(),
        };
        let task = api.process_agent_output(&task.id, output).unwrap();

        // Verify precondition: should be paused at AwaitingReview
        assert_eq!(task.phase, Phase::AwaitingReview);
        assert_eq!(task.current_stage(), Some("review"));

        (api, task)
    }

    #[test]
    fn test_approve_confirms_pending_rejection() {
        let (api, task) = api_with_pending_rejection();

        // Human approves → "I agree with the rejection" → move to target stage
        let task = api.approve(&task.id).unwrap();

        assert_eq!(task.current_stage(), Some("work"));
        assert_eq!(task.phase, Phase::Idle);

        // Should have created a rejection iteration in the work stage
        let iterations = api.store.get_iterations(&task.id).unwrap();
        let work_iter = iterations.iter().find(|i| i.stage == "work").unwrap();
        match &work_iter.incoming_context {
            Some(IterationTrigger::Rejection {
                from_stage,
                feedback,
            }) => {
                assert_eq!(from_stage, "review");
                assert_eq!(feedback, "Tests are failing, fix them");
            }
            other => panic!("Expected Rejection trigger, got {other:?}"),
        }
    }

    #[test]
    fn test_reject_overrides_pending_rejection() {
        let (api, task) = api_with_pending_rejection();

        // Human rejects → "I disagree, re-evaluate" → stay in review, new iteration
        let task = api
            .reject(
                &task.id,
                "The implementation looks correct, please re-evaluate",
            )
            .unwrap();

        // Should stay in review stage with Idle phase (ready for new agent run)
        assert_eq!(task.current_stage(), Some("review"));
        assert_eq!(task.phase, Phase::Idle);

        // A new iteration should be created in the review stage with Feedback trigger
        let iterations = api.store.get_iterations(&task.id).unwrap();
        let review_iters: Vec<_> = iterations.iter().filter(|i| i.stage == "review").collect();
        assert_eq!(review_iters.len(), 2, "Should have 2 review iterations");

        let new_iter = review_iters.last().unwrap();
        match &new_iter.incoming_context {
            Some(IterationTrigger::Feedback { feedback }) => {
                assert_eq!(
                    feedback,
                    "The implementation looks correct, please re-evaluate"
                );
            }
            other => panic!("Expected Feedback trigger, got {other:?}"),
        }
    }

    #[test]
    fn test_set_auto_mode_confirms_pending_rejection() {
        let (api, task) = api_with_pending_rejection();

        // Enabling auto_mode should auto-confirm the pending rejection
        let task = api.set_auto_mode(&task.id, true).unwrap();

        assert_eq!(task.current_stage(), Some("work"));
        assert_eq!(task.phase, Phase::Idle);
        assert!(task.auto_mode);
    }

    #[test]
    fn test_rejection_override_then_new_approval_verdict() {
        use crate::workflow::execution::StageOutput;

        let (api, task) = api_with_pending_rejection();

        // Step 1: Human overrides the rejection
        let task = api
            .reject(&task.id, "Please re-evaluate, the tests actually pass")
            .unwrap();
        assert_eq!(task.current_stage(), Some("review"));
        assert_eq!(task.phase, Phase::Idle);

        // Step 2: Agent starts again in review stage
        let task = api.agent_started(&task.id).unwrap();
        assert_eq!(task.phase, Phase::AgentWorking);

        // Step 3: Agent produces a new approval verdict this time
        let output = StageOutput::Approval {
            decision: "approve".to_string(),
            content: "On re-evaluation, the implementation looks good".to_string(),
        };
        let task = api.process_agent_output(&task.id, output).unwrap();

        // Step 4: Should pause at AwaitingReview (standard approval review, non-automated stage)
        assert_eq!(task.phase, Phase::AwaitingReview);
        assert_eq!(task.current_stage(), Some("review"));

        // Step 5: Human approves → task should advance past review (Done, since review is the last stage)
        let task = api.approve(&task.id).unwrap();
        assert!(task.is_done());
    }
}
