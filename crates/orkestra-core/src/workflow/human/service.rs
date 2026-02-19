//! Human/UI actions: approve, reject, answer questions, toggle auto mode.

use crate::workflow::api::WorkflowApi;
use crate::workflow::domain::{PrCommentData, QuestionAnswer, Task};
use crate::workflow::ports::WorkflowResult;

use super::interactions as human;

impl WorkflowApi {
    /// Approve the current stage's artifact. Moves to next stage.
    pub fn approve(&self, task_id: &str) -> WorkflowResult<Task> {
        human::approve::execute(
            self.store.as_ref(),
            &self.workflow,
            &self.iteration_service,
            task_id,
        )
    }

    /// Reject the current stage's artifact with feedback. Retries current stage.
    pub fn reject(&self, task_id: &str, feedback: &str) -> WorkflowResult<Task> {
        human::reject::execute(
            self.store.as_ref(),
            &self.iteration_service,
            task_id,
            feedback,
        )
    }

    /// Answer pending questions from the agent.
    pub fn answer_questions(
        &self,
        task_id: &str,
        answers: Vec<QuestionAnswer>,
    ) -> WorkflowResult<Task> {
        human::answer_questions::execute(
            self.store.as_ref(),
            &self.iteration_service,
            task_id,
            answers,
        )
    }

    /// Retry a failed or blocked task by resuming it from its last active stage.
    pub fn retry(&self, task_id: &str, instructions: Option<&str>) -> WorkflowResult<Task> {
        human::retry::execute(
            self.store.as_ref(),
            &self.workflow,
            &self.iteration_service,
            task_id,
            instructions,
        )
    }

    /// Set the `auto_mode` flag on a task, with immediate side effects.
    pub fn set_auto_mode(&self, task_id: &str, auto_mode: bool) -> WorkflowResult<Task> {
        human::set_auto_mode::execute(
            self.store.as_ref(),
            &self.workflow,
            &self.iteration_service,
            task_id,
            auto_mode,
        )
    }

    /// Interrupt a running agent execution.
    pub fn interrupt(&self, task_id: &str) -> WorkflowResult<Task> {
        human::interrupt::execute(
            self.store.as_ref(),
            &self.iteration_service,
            self.agent_killer.as_deref(),
            task_id,
        )
    }

    /// Resume an interrupted task, optionally with a message for the agent.
    pub fn resume(&self, task_id: &str, message: Option<String>) -> WorkflowResult<Task> {
        human::resume::execute(
            self.store.as_ref(),
            &self.iteration_service,
            task_id,
            message,
        )
    }

    /// Address PR comments by returning to the recovery stage.
    pub fn address_pr_comments(
        &self,
        task_id: &str,
        comments: Vec<PrCommentData>,
        guidance: Option<String>,
    ) -> WorkflowResult<Task> {
        human::address_pr_comments::execute(
            self.store.as_ref(),
            &self.workflow,
            &self.iteration_service,
            task_id,
            comments,
            guidance,
        )
    }

    /// Address PR merge conflicts by returning to the recovery stage.
    pub fn address_pr_conflicts(&self, task_id: &str, base_branch: &str) -> WorkflowResult<Task> {
        human::address_pr_conflicts::execute(
            self.store.as_ref(),
            &self.workflow,
            &self.iteration_service,
            task_id,
            base_branch,
        )
    }

    /// Request update on a Done task by returning to the recovery stage with feedback.
    pub fn request_update(&self, task_id: &str, feedback: &str) -> WorkflowResult<Task> {
        human::request_update::execute(
            self.store.as_ref(),
            &self.workflow,
            &self.iteration_service,
            task_id,
            feedback,
        )
    }

    /// Manually archive a Done task.
    pub fn archive_task(&self, task_id: &str) -> WorkflowResult<Task> {
        human::archive::execute(self.store.as_ref(), task_id)
    }
}

#[cfg(test)]
mod tests {
    use crate::workflow::config::{
        IntegrationConfig, StageCapabilities, StageConfig, WorkflowConfig,
    };
    use crate::workflow::domain::{IterationTrigger, Question};
    use crate::workflow::ports::WorkflowError;
    use crate::workflow::runtime::{Artifact, Outcome, TaskState};
    use crate::workflow::InMemoryWorkflowStore;
    use std::sync::Arc;

    use super::*;

    fn test_workflow() -> WorkflowConfig {
        WorkflowConfig::new(vec![
            StageConfig::new("planning", "plan")
                .with_capabilities(StageCapabilities::with_questions()),
            StageConfig::new("work", "summary"),
            StageConfig::new("review", "verdict").automated(),
        ])
        .with_integration(IntegrationConfig::new("work"))
    }

    fn api_with_task_in_review() -> (WorkflowApi, Task) {
        let workflow = test_workflow();
        let store = Arc::new(InMemoryWorkflowStore::new());
        let api = WorkflowApi::new(workflow, store);

        let mut task = api.create_task("Test", "Description", None).unwrap();

        // Unit tests don't have an orchestrator to run setup, so we manually
        // transition the task. This is fine because these tests are testing
        // human actions (approve/reject), not setup behavior.

        // Simulate agent producing artifact and going to review
        let now = chrono::Utc::now().to_rfc3339();
        task.artifacts
            .set(Artifact::new("plan", "The plan", "planning", &now));
        task.state = TaskState::awaiting_approval("planning");
        api.store.save_task(&task).unwrap();

        (api, task)
    }

    #[test]
    fn test_approve_moves_to_next_stage() {
        let (api, task) = api_with_task_in_review();

        let task = api.approve(&task.id).unwrap();

        // Approve enters commit pipeline — actual advancement happens in finalize_stage_advancement
        assert_eq!(task.current_stage(), Some("planning"));
        assert!(matches!(task.state, TaskState::Finishing { .. }));
    }

    #[test]
    fn test_approve_from_last_stage_marks_done() {
        let workflow = test_workflow();
        let store = Arc::new(InMemoryWorkflowStore::new());
        let api = WorkflowApi::new(workflow, store);

        let mut task = api.create_task("Test", "Description", None).unwrap();

        // Move to review stage
        task.state = TaskState::awaiting_approval("review");
        let now = chrono::Utc::now().to_rfc3339();
        task.artifacts
            .set(Artifact::new("verdict", "Approved", "review", &now));
        api.store.save_task(&task).unwrap();

        let task = api.approve(&task.id).unwrap();

        // Approve enters commit pipeline — actual advancement happens in finalize_stage_advancement
        assert_eq!(task.current_stage(), Some("review"));
        assert!(matches!(task.state, TaskState::Finishing { .. }));
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
        assert!(matches!(task.state, TaskState::Queued { .. }));

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
        task.state = TaskState::awaiting_question_answer("planning");
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

        assert!(matches!(task.state, TaskState::Queued { .. }));
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
        task.worktree_path = Some("/tmp/fake-worktree".into());
        task.state = TaskState::failed("Something went wrong");
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
        task.worktree_path = Some("/tmp/fake-worktree".into());
        task.state = TaskState::blocked("Waiting on external service");
        api.store.save_task(&task).unwrap();

        (api, task)
    }

    #[test]
    fn test_retry_failed_without_instructions() {
        let (api, task) = api_with_failed_task();

        let task = api.retry(&task.id, None).unwrap();

        assert_eq!(task.current_stage(), Some("planning"));
        assert!(matches!(task.state, TaskState::Queued { .. }));

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
        assert!(matches!(task.state, TaskState::Queued { .. }));

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
        assert!(matches!(task.state, TaskState::Queued { .. }));

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
            StageConfig::new("work", "summary"),
            StageConfig::new("review", "verdict")
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

        // Advance to review stage with AgentWorking (simulating agent producing output)
        task.state = TaskState::agent_working("review");
        api.store.save_task(&task).unwrap();
        api.iteration_service
            .create_iteration(&task.id, "review", None)
            .unwrap();

        // Simulate reviewer agent producing a rejection verdict
        let output = StageOutput::Approval {
            decision: "reject".to_string(),
            content: "Tests are failing, fix them".to_string(),
            activity_log: None,
        };
        let task = api.process_agent_output(&task.id, output).unwrap();

        // Verify precondition: should be paused at AwaitingRejectionConfirmation
        assert!(matches!(
            task.state,
            TaskState::AwaitingRejectionConfirmation { .. }
        ));
        assert_eq!(task.current_stage(), Some("review"));

        (api, task)
    }

    #[test]
    fn test_approve_confirms_pending_rejection() {
        let (api, task) = api_with_pending_rejection();

        // Human approves → "I agree with the rejection" → move to target stage
        let task = api.approve(&task.id).unwrap();

        assert_eq!(task.current_stage(), Some("work"));
        assert!(matches!(task.state, TaskState::Queued { .. }));

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
        assert!(matches!(task.state, TaskState::Queued { .. }));

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
        assert!(matches!(task.state, TaskState::Queued { .. }));
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
        assert!(matches!(task.state, TaskState::Queued { .. }));

        // Step 2: Agent starts again in review stage
        api.agent_started(&task.id).unwrap();

        // Step 3: Agent produces a new approval verdict this time
        let output = StageOutput::Approval {
            decision: "approve".to_string(),
            content: "On re-evaluation, the implementation looks good".to_string(),
            activity_log: None,
        };
        let task = api.process_agent_output(&task.id, output).unwrap();

        // Step 4: Should pause at AwaitingReview (standard approval review, non-automated stage)
        assert!(matches!(task.state, TaskState::AwaitingApproval { .. }));
        assert_eq!(task.current_stage(), Some("review"));

        // Step 5: Human approves → enters commit pipeline (advancement happens in finalize_stage_advancement)
        let task = api.approve(&task.id).unwrap();
        assert!(matches!(task.state, TaskState::Finishing { .. }));
    }

    // ========================================================================
    // Interrupt and Resume tests
    // ========================================================================

    /// Create an API with a task in `AgentWorking` phase
    fn api_with_agent_working() -> (WorkflowApi, Task) {
        let workflow = test_workflow();
        let store = Arc::new(InMemoryWorkflowStore::new());
        let api = WorkflowApi::new(workflow, store);

        let mut task = api.create_task("Test", "Description", None).unwrap();

        // Simulate agent started
        task.state = TaskState::agent_working("planning");
        api.store.save_task(&task).unwrap();

        (api, task)
    }

    #[test]
    fn test_interrupt_from_agent_working() {
        let (api, task) = api_with_agent_working();

        let task = api.interrupt(&task.id).unwrap();

        assert!(matches!(task.state, TaskState::Interrupted { .. }));

        // Verify iteration was ended with Interrupted outcome
        let iterations = api.get_iterations(&task.id).unwrap();
        let latest = iterations.last().unwrap();
        assert!(matches!(latest.outcome, Some(Outcome::Interrupted)));
        assert!(latest.ended_at.is_some());
    }

    #[test]
    fn test_interrupt_wrong_phase() {
        let workflow = test_workflow();
        let store = Arc::new(InMemoryWorkflowStore::new());
        let api = WorkflowApi::new(workflow, store);

        let mut task = api.create_task("Test", "Description", None).unwrap();

        // Set task to AwaitingReview instead of AgentWorking
        task.state = TaskState::awaiting_approval("planning");
        api.store.save_task(&task).unwrap();

        let result = api.interrupt(&task.id);
        assert!(matches!(result, Err(WorkflowError::InvalidTransition(_))));
    }

    /// Create an API with a task in Interrupted phase
    fn api_with_interrupted_task() -> (WorkflowApi, Task) {
        let workflow = test_workflow();
        let store = Arc::new(InMemoryWorkflowStore::new());
        let api = WorkflowApi::new(workflow, store);

        let mut task = api.create_task("Test", "Description", None).unwrap();

        // Simulate interrupted state
        task.state = TaskState::interrupted("planning");
        api.store.save_task(&task).unwrap();

        // End the current iteration with Interrupted outcome
        let iter = api
            .store
            .get_latest_iteration(&task.id, "planning")
            .unwrap()
            .unwrap();
        let mut iter = iter;
        iter.outcome = Some(Outcome::Interrupted);
        iter.ended_at = Some(chrono::Utc::now().to_rfc3339());
        api.store.save_iteration(&iter).unwrap();

        (api, task)
    }

    #[test]
    fn test_resume_from_interrupted() {
        let (api, task) = api_with_interrupted_task();

        let task = api
            .resume(
                &task.id,
                Some("Please continue with the implementation".to_string()),
            )
            .unwrap();

        assert!(matches!(task.state, TaskState::Queued { .. }));
        assert_eq!(task.current_stage(), Some("planning"));

        // Verify new iteration was created with ManualResume trigger
        let iterations = api.get_iterations(&task.id).unwrap();
        assert_eq!(iterations.len(), 2);

        let new_iter = iterations.last().unwrap();
        match &new_iter.incoming_context {
            Some(IterationTrigger::ManualResume { message }) => {
                assert_eq!(
                    message.as_deref(),
                    Some("Please continue with the implementation")
                );
            }
            other => panic!("Expected ManualResume trigger, got {other:?}"),
        }
    }

    #[test]
    fn test_resume_without_message() {
        let (api, task) = api_with_interrupted_task();

        let task = api.resume(&task.id, None).unwrap();

        assert!(matches!(task.state, TaskState::Queued { .. }));

        // Verify new iteration has ManualResume with None message
        let iterations = api.get_iterations(&task.id).unwrap();
        let new_iter = iterations.last().unwrap();
        match &new_iter.incoming_context {
            Some(IterationTrigger::ManualResume { message }) => {
                assert!(message.is_none());
            }
            other => panic!("Expected ManualResume trigger, got {other:?}"),
        }
    }

    #[test]
    fn test_resume_wrong_phase() {
        let workflow = test_workflow();
        let store = Arc::new(InMemoryWorkflowStore::new());
        let api = WorkflowApi::new(workflow, store);

        let mut task = api.create_task("Test", "Description", None).unwrap();

        // Set task to AgentWorking instead of Interrupted
        task.state = TaskState::agent_working("planning");
        api.store.save_task(&task).unwrap();

        let result = api.resume(&task.id, None);
        assert!(matches!(result, Err(WorkflowError::InvalidTransition(_))));
    }

    // ========================================================================
    // Archive task tests
    // ========================================================================

    /// Create an API with a task in Done state.
    fn api_with_done_task() -> (WorkflowApi, Task) {
        let workflow = test_workflow();
        let store = Arc::new(InMemoryWorkflowStore::new());
        let api = WorkflowApi::new(workflow, store);

        let mut task = api.create_task("Test", "Description", None).unwrap();

        task.state = TaskState::Done;
        api.store.save_task(&task).unwrap();

        (api, task)
    }

    #[test]
    fn test_archive_task_success() {
        let (api, task) = api_with_done_task();

        let result = api.archive_task(&task.id).unwrap();

        assert!(result.is_archived());
    }

    #[test]
    fn test_archive_task_not_done() {
        let workflow = test_workflow();
        let store = Arc::new(InMemoryWorkflowStore::new());
        let api = WorkflowApi::new(workflow, store);

        let task = api.create_task("Test", "Description", None).unwrap();
        // Task is in Queued state, not Done

        let result = api.archive_task(&task.id);
        assert!(matches!(result, Err(WorkflowError::InvalidTransition(_))));
    }

    #[test]
    fn test_archive_task_wrong_state() {
        let (api, mut task) = api_with_done_task();

        // Simulate task being in integrating state
        task.state = TaskState::Integrating;
        api.store.save_task(&task).unwrap();

        let result = api.archive_task(&task.id);
        assert!(matches!(result, Err(WorkflowError::InvalidTransition(_))));
    }

    // ========================================================================
    // Address PR comments tests
    // ========================================================================

    /// Create an API with a task in Done status with a PR URL.
    fn api_with_done_task_and_pr() -> (WorkflowApi, Task) {
        let workflow = test_workflow();
        let store = Arc::new(InMemoryWorkflowStore::new());
        let api = WorkflowApi::new(workflow, store);

        let mut task = api.create_task("Test", "Description", None).unwrap();

        // Set task to Done state with PR URL
        task.state = TaskState::Done;
        task.pr_url = Some("https://github.com/owner/repo/pull/123".to_string());
        api.store.save_task(&task).unwrap();

        (api, task)
    }

    fn test_comments() -> Vec<PrCommentData> {
        vec![
            PrCommentData {
                author: "reviewer1".to_string(),
                body: "Fix this formatting".to_string(),
                path: Some("src/main.rs".to_string()),
                line: Some(42),
            },
            PrCommentData {
                author: "reviewer2".to_string(),
                body: "PR-level comment".to_string(),
                path: None,
                line: None,
            },
        ]
    }

    #[test]
    fn test_address_pr_comments_success() {
        let (api, task) = api_with_done_task_and_pr();

        let result = api
            .address_pr_comments(
                &task.id,
                test_comments(),
                Some("Fix the formatting issues".to_string()),
            )
            .unwrap();

        // Should return to work stage (integration recovery stage)
        assert_eq!(result.current_stage(), Some("work"));
        assert!(matches!(result.state, TaskState::Queued { .. }));
        assert!(result.completed_at.is_none());
    }

    #[test]
    fn test_address_pr_comments_creates_iteration_with_trigger() {
        let (api, task) = api_with_done_task_and_pr();

        let _ = api
            .address_pr_comments(
                &task.id,
                test_comments(),
                Some("Address code review feedback".to_string()),
            )
            .unwrap();

        let iterations = api.get_iterations(&task.id).unwrap();
        let last = iterations.last().unwrap();

        match &last.incoming_context {
            Some(IterationTrigger::PrComments { comments, guidance }) => {
                assert_eq!(comments.len(), 2);
                assert_eq!(comments[0].author, "reviewer1");
                assert_eq!(comments[0].body, "Fix this formatting");
                assert_eq!(guidance.as_deref(), Some("Address code review feedback"));
            }
            other => panic!("Expected PrComments trigger, got {other:?}"),
        }
    }

    #[test]
    fn test_address_pr_comments_without_guidance() {
        let (api, task) = api_with_done_task_and_pr();

        let _ = api
            .address_pr_comments(&task.id, test_comments(), None)
            .unwrap();

        let iterations = api.get_iterations(&task.id).unwrap();
        let last = iterations.last().unwrap();

        match &last.incoming_context {
            Some(IterationTrigger::PrComments { comments, guidance }) => {
                assert_eq!(comments.len(), 2);
                assert!(guidance.is_none());
            }
            other => panic!("Expected PrComments trigger, got {other:?}"),
        }
    }

    #[test]
    fn test_address_pr_comments_not_done() {
        let workflow = test_workflow();
        let store = Arc::new(InMemoryWorkflowStore::new());
        let api = WorkflowApi::new(workflow, store);

        let task = api.create_task("Test", "Description", None).unwrap();
        // Task is in Active status, not Done

        let result = api.address_pr_comments(&task.id, test_comments(), None);
        assert!(matches!(result, Err(WorkflowError::InvalidTransition(_))));
    }

    #[test]
    fn test_address_pr_comments_wrong_state() {
        let (api, mut task) = api_with_done_task_and_pr();

        // Simulate task being in integrating state
        task.state = TaskState::Integrating;
        api.store.save_task(&task).unwrap();

        let result = api.address_pr_comments(&task.id, test_comments(), None);
        assert!(matches!(result, Err(WorkflowError::InvalidTransition(_))));
    }

    #[test]
    fn test_address_pr_comments_empty_comments() {
        let (api, task) = api_with_done_task_and_pr();

        // Empty comments should be rejected
        let result = api.address_pr_comments(&task.id, vec![], None);
        assert!(matches!(result, Err(WorkflowError::InvalidTransition(_))));
    }
}
