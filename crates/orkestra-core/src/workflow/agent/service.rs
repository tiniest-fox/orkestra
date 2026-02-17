//! Agent/orchestrator actions: agent started, process output, get pending tasks.

use crate::workflow::api::WorkflowApi;
use crate::workflow::domain::Task;
use crate::workflow::execution::StageOutput;
use crate::workflow::ports::WorkflowResult;

use super::interactions as agent;
use crate::workflow::query::interactions as query;
use crate::workflow::stage::interactions as stage;

impl WorkflowApi {
    /// Complete stage advancement after the commit pipeline finishes.
    pub fn finalize_stage_advancement(&self, task_id: &str) -> WorkflowResult<Task> {
        stage::finalize_advancement::execute(
            self.store.as_ref(),
            &self.workflow,
            &self.iteration_service,
            task_id,
        )
    }

    /// Mark agent as started on a task. Transitions phase to `AgentWorking`.
    pub fn agent_started(&self, task_id: &str) -> WorkflowResult<Task> {
        agent::agent_started::execute(self.store.as_ref(), task_id)
    }

    /// Process completed agent output. Handles artifacts, questions, approvals, failures.
    pub fn process_agent_output(&self, task_id: &str, output: StageOutput) -> WorkflowResult<Task> {
        agent::process_output::execute(
            self.store.as_ref(),
            &self.workflow,
            &self.iteration_service,
            task_id,
            output,
        )
    }

    /// Handle agent execution failure (crash, poll error, spawn failure).
    pub(crate) fn fail_agent_execution(&self, task_id: &str, error: &str) -> WorkflowResult<Task> {
        agent::fail_execution::execute(self.store.as_ref(), &self.iteration_service, task_id, error)
    }

    /// Record a successful commit. Transitions phase from Committing to Finished.
    pub(crate) fn commit_succeeded(&self, task_id: &str) -> WorkflowResult<Task> {
        stage::commit_succeeded::execute(self.store.as_ref(), task_id)
    }

    /// Record a failed commit. Marks task as failed and records a `CommitFailed` iteration.
    pub(crate) fn commit_failed(&self, task_id: &str, error: &str) -> WorkflowResult<Task> {
        stage::commit_failed::execute(self.store.as_ref(), &self.iteration_service, task_id, error)
    }

    /// Get tasks that need agents spawned (in Idle phase with Active status).
    pub fn get_tasks_needing_agents(&self) -> WorkflowResult<Vec<Task>> {
        query::tasks_needing_agents::execute(self.store.as_ref())
    }

    /// Advance a single parent task whose subtasks have all completed.
    pub(crate) fn advance_parent(&self, parent_id: &str) -> WorkflowResult<Task> {
        stage::advance_parent::execute(
            self.store.as_ref(),
            &self.workflow,
            &self.iteration_service,
            parent_id,
        )
    }

    /// Handle successful script completion. Creates artifact and auto-advances.
    pub(crate) fn process_script_success(
        &self,
        task_id: &str,
        output: &str,
    ) -> WorkflowResult<Task> {
        agent::process_script_success::execute(
            self.store.as_ref(),
            &self.workflow,
            &self.iteration_service,
            task_id,
            output,
        )
    }

    /// Handle script failure. Transitions to recovery stage if configured.
    pub(crate) fn process_script_failure(
        &self,
        task_id: &str,
        error: &str,
        recovery_stage: Option<&str>,
    ) -> WorkflowResult<Task> {
        agent::process_script_failure::execute(
            self.store.as_ref(),
            &self.workflow,
            &self.iteration_service,
            task_id,
            error,
            recovery_stage,
        )
    }
}

#[cfg(test)]
mod tests {
    use std::sync::Arc;

    use crate::workflow::config::{StageCapabilities, StageConfig, WorkflowConfig};
    use crate::workflow::domain::{IterationTrigger, Question};
    use crate::workflow::ports::WorkflowError;
    use crate::workflow::runtime::{Outcome, TaskState};
    use crate::workflow::InMemoryWorkflowStore;

    use super::*;

    /// Create a task ready for agent work (in Queued state).
    fn create_task_ready(api: &WorkflowApi, title: &str, desc: &str) -> Task {
        let mut task = api.create_task(title, desc, None).unwrap();
        task.state = TaskState::queued("planning");
        api.store.save_task(&task).unwrap();
        task
    }

    fn test_workflow() -> WorkflowConfig {
        WorkflowConfig::new(vec![
            StageConfig::new("planning", "plan")
                .with_capabilities(StageCapabilities::with_questions()),
            StageConfig::new("work", "summary").with_inputs(vec!["plan".into()]),
            StageConfig::new("review", "verdict")
                .with_inputs(vec!["summary".into()])
                .with_capabilities(StageCapabilities::with_approval(Some("work".into())))
                .automated(),
        ])
    }

    #[test]
    fn test_agent_started() {
        let workflow = test_workflow();
        let store = Arc::new(InMemoryWorkflowStore::new());
        let api = WorkflowApi::new(workflow, store);

        let task = create_task_ready(&api, "Test", "Description");
        let task = api.agent_started(&task.id).unwrap();

        assert!(matches!(task.state, TaskState::AgentWorking { .. }));
    }

    #[test]
    fn test_agent_started_invalid_phase() {
        let workflow = test_workflow();
        let store = Arc::new(InMemoryWorkflowStore::new());
        let api = WorkflowApi::new(workflow, store);

        let mut task = create_task_ready(&api, "Test", "Description");
        task.state = TaskState::agent_working("planning");
        api.store.save_task(&task).unwrap();

        let result = api.agent_started(&task.id);
        assert!(matches!(result, Err(WorkflowError::InvalidTransition(_))));
    }

    #[test]
    fn test_process_artifact_output() {
        let workflow = test_workflow();
        let store = Arc::new(InMemoryWorkflowStore::new());
        let api = WorkflowApi::new(workflow, store);

        let task = create_task_ready(&api, "Test", "Description");
        api.agent_started(&task.id).unwrap();

        let output = StageOutput::Artifact {
            content: "The plan content".to_string(),
            activity_log: None,
        };
        let task = api.process_agent_output(&task.id, output).unwrap();

        assert!(matches!(task.state, TaskState::AwaitingApproval { .. }));
        assert!(task.artifacts.get("plan").is_some());
    }

    #[test]
    fn test_process_questions_output() {
        let workflow = test_workflow();
        let store = Arc::new(InMemoryWorkflowStore::new());
        let api = WorkflowApi::new(workflow, store);

        let task = create_task_ready(&api, "Test", "Description");
        api.agent_started(&task.id).unwrap();

        let output = StageOutput::Questions {
            questions: vec![Question::new("What framework?")],
        };
        let task = api.process_agent_output(&task.id, output).unwrap();

        assert!(matches!(
            task.state,
            TaskState::AwaitingQuestionAnswer { .. }
        ));

        // Questions are now stored in iteration outcome, not on task
        let questions = api.get_pending_questions(&task.id).unwrap();
        assert_eq!(questions.len(), 1);
    }

    #[test]
    fn test_process_approval_reject_output() {
        let workflow = test_workflow();
        let store = Arc::new(InMemoryWorkflowStore::new());
        let api = WorkflowApi::new(workflow, store);

        let mut task = api.create_task("Test", "Description", None).unwrap();

        // Move to review stage
        task.state = TaskState::agent_working("review");
        api.store.save_task(&task).unwrap();

        let output = StageOutput::Approval {
            decision: "reject".to_string(),
            content: "Tests failing".to_string(),
            activity_log: None,
        };
        let task = api.process_agent_output(&task.id, output).unwrap();

        assert_eq!(task.current_stage(), Some("work"));
        assert!(matches!(task.state, TaskState::Queued { .. }));

        // Rejection should create an artifact with the rejection content
        assert!(task.artifacts.get("verdict").is_some());
        assert_eq!(
            task.artifacts.get("verdict").unwrap().content,
            "Tests failing"
        );
    }

    #[test]
    fn test_rejection_pauses_for_review_on_non_automated_stage() {
        // Non-automated review stage: rejection should pause for human review
        let workflow = WorkflowConfig::new(vec![
            StageConfig::new("planning", "plan"),
            StageConfig::new("work", "summary").with_inputs(vec!["plan".into()]),
            StageConfig::new("review", "verdict")
                .with_inputs(vec!["summary".into()])
                .with_capabilities(StageCapabilities::with_approval(Some("work".into()))),
        ]);
        let store = Arc::new(InMemoryWorkflowStore::new());
        let api = WorkflowApi::new(workflow, store);

        let mut task = api.create_task("Test", "Description", None).unwrap();
        task.state = TaskState::agent_working("review");
        api.store.save_task(&task).unwrap();
        api.iteration_service
            .create_iteration(&task.id, "review", None)
            .unwrap();

        let output = StageOutput::Approval {
            decision: "reject".to_string(),
            content: "Tests failing, please fix".to_string(),
            activity_log: None,
        };
        let task = api.process_agent_output(&task.id, output).unwrap();

        // Should pause at AwaitingRejectionConfirmation, NOT move to work stage
        assert_eq!(task.current_stage(), Some("review"));
        assert!(matches!(
            task.state,
            TaskState::AwaitingRejectionConfirmation { .. }
        ));

        // Rejection content stored as artifact
        assert_eq!(
            task.artifacts.get("verdict").unwrap().content,
            "Tests failing, please fix"
        );

        // Iteration should have AwaitingRejectionReview outcome
        let iterations = api.store.get_iterations(&task.id).unwrap();
        let review_iter = iterations.iter().find(|i| i.stage == "review").unwrap();
        match &review_iter.outcome {
            Some(Outcome::AwaitingRejectionReview {
                from_stage,
                target,
                feedback,
            }) => {
                assert_eq!(from_stage, "review");
                assert_eq!(target, "work");
                assert_eq!(feedback, "Tests failing, please fix");
            }
            other => panic!("Expected AwaitingRejectionReview outcome, got {other:?}"),
        }
    }

    #[test]
    fn test_rejection_auto_executes_for_auto_mode_task() {
        // Non-automated review stage but task has auto_mode — should auto-execute
        let workflow = WorkflowConfig::new(vec![
            StageConfig::new("planning", "plan"),
            StageConfig::new("work", "summary").with_inputs(vec!["plan".into()]),
            StageConfig::new("review", "verdict")
                .with_inputs(vec!["summary".into()])
                .with_capabilities(StageCapabilities::with_approval(Some("work".into()))),
        ]);
        let store = Arc::new(InMemoryWorkflowStore::new());
        let api = WorkflowApi::new(workflow, store);

        let mut task = api.create_task("Test", "Description", None).unwrap();
        task.auto_mode = true;
        task.state = TaskState::agent_working("review");
        api.store.save_task(&task).unwrap();
        api.iteration_service
            .create_iteration(&task.id, "review", None)
            .unwrap();

        let output = StageOutput::Approval {
            decision: "reject".to_string(),
            content: "Tests failing".to_string(),
            activity_log: None,
        };
        let task = api.process_agent_output(&task.id, output).unwrap();

        // Should auto-execute rejection — move to work stage
        assert_eq!(task.current_stage(), Some("work"));
        assert!(matches!(task.state, TaskState::Queued { .. }));
    }

    #[test]
    fn test_process_approval_approve_output() {
        let workflow = test_workflow();
        let store = Arc::new(InMemoryWorkflowStore::new());
        let api = WorkflowApi::new(workflow, store);

        let mut task = api.create_task("Test", "Description", None).unwrap();

        // Move to review stage (automated)
        task.state = TaskState::agent_working("review");
        api.store.save_task(&task).unwrap();

        let output = StageOutput::Approval {
            decision: "approve".to_string(),
            content: "Looks good, well implemented".to_string(),
            activity_log: None,
        };
        let task = api.process_agent_output(&task.id, output).unwrap();

        // Should enter commit pipeline (automated stage auto-advances via Finishing)
        assert!(matches!(task.state, TaskState::Finishing { .. }));
        assert_eq!(task.current_stage(), Some("review"));
        // Content should be stored as artifact
        assert!(task.artifacts.get("verdict").is_some());
        assert!(task
            .artifacts
            .get("verdict")
            .unwrap()
            .content
            .contains("well implemented"));
    }

    #[test]
    fn test_process_approval_no_capability() {
        let workflow = test_workflow();
        let store = Arc::new(InMemoryWorkflowStore::new());
        let api = WorkflowApi::new(workflow, store);

        let task = create_task_ready(&api, "Test", "Description");
        api.agent_started(&task.id).unwrap();

        // Planning stage doesn't have approval capability
        let output = StageOutput::Approval {
            decision: "approve".to_string(),
            content: "Should fail".to_string(),
            activity_log: None,
        };
        let result = api.process_agent_output(&task.id, output);

        assert!(matches!(result, Err(WorkflowError::InvalidTransition(_))));
    }

    #[test]
    fn test_process_failed_output() {
        let workflow = test_workflow();
        let store = Arc::new(InMemoryWorkflowStore::new());
        let api = WorkflowApi::new(workflow, store);

        let task = create_task_ready(&api, "Test", "Description");
        api.agent_started(&task.id).unwrap();

        let output = StageOutput::Failed {
            error: "Build failed".to_string(),
        };
        let task = api.process_agent_output(&task.id, output).unwrap();

        assert!(task.is_failed());
    }

    #[test]
    fn test_process_blocked_output() {
        let workflow = test_workflow();
        let store = Arc::new(InMemoryWorkflowStore::new());
        let api = WorkflowApi::new(workflow, store);

        let task = create_task_ready(&api, "Test", "Description");
        api.agent_started(&task.id).unwrap();

        let output = StageOutput::Blocked {
            reason: "Waiting for API access".to_string(),
        };
        let task = api.process_agent_output(&task.id, output).unwrap();

        assert!(task.is_blocked());
    }

    #[test]
    fn test_automated_stage_auto_approves() {
        let workflow = test_workflow();
        let store = Arc::new(InMemoryWorkflowStore::new());
        let api = WorkflowApi::new(workflow, store);

        let mut task = api.create_task("Test", "Description", None).unwrap();

        // Move to review stage (automated)
        task.state = TaskState::agent_working("review");
        api.store.save_task(&task).unwrap();

        let output = StageOutput::Artifact {
            content: "Approved".to_string(),
            activity_log: None,
        };
        let task = api.process_agent_output(&task.id, output).unwrap();

        // Should enter commit pipeline (automated stage auto-advances via Finishing)
        assert!(matches!(task.state, TaskState::Finishing { .. }));
        assert_eq!(task.current_stage(), Some("review"));
    }

    #[test]
    fn test_get_tasks_needing_agents() {
        let workflow = test_workflow();
        let store = Arc::new(InMemoryWorkflowStore::new());
        let api = WorkflowApi::new(workflow, store);

        // Create some tasks in different states
        let task1 = create_task_ready(&api, "Task 1", "Ready for agent");
        let task2 = create_task_ready(&api, "Task 2", "Also ready");
        let _ = api.agent_started(&task2.id).unwrap(); // Now working

        let mut task3 = create_task_ready(&api, "Task 3", "Done");
        task3.state = TaskState::Done;
        api.store.save_task(&task3).unwrap();

        let needing_agents = api.get_tasks_needing_agents().unwrap();

        assert_eq!(needing_agents.len(), 1);
        assert_eq!(needing_agents[0].id, task1.id);
    }

    // ========================================================================
    // Script stage tests
    // ========================================================================

    fn test_workflow_with_script() -> WorkflowConfig {
        use crate::workflow::config::ScriptStageConfig;

        let mut checks_stage = StageConfig::new_script("checks", "check_results", "./run.sh");
        checks_stage.script = Some(ScriptStageConfig::new("./run.sh").with_on_failure("work"));

        WorkflowConfig::new(vec![
            StageConfig::new("planning", "plan"),
            StageConfig::new("work", "summary").with_inputs(vec!["plan".into()]),
            checks_stage.with_inputs(vec!["summary".into()]),
            StageConfig::new("review", "verdict")
                .with_inputs(vec!["check_results".into()])
                .automated(),
        ])
    }

    #[test]
    fn test_process_script_success() {
        let workflow = test_workflow_with_script();
        let store = Arc::new(InMemoryWorkflowStore::new());
        let api = WorkflowApi::new(workflow, store);

        let mut task = api.create_task("Test", "Description", None).unwrap();
        task.state = TaskState::agent_working("checks");
        api.store.save_task(&task).unwrap();

        let task = api
            .process_script_success(&task.id, "All tests passed!\nOK")
            .unwrap();

        assert_eq!(task.current_stage(), Some("checks"));
        assert!(matches!(task.state, TaskState::Finishing { .. }));
        assert!(task.artifacts.get("check_results").is_some());
        assert!(task
            .artifacts
            .get("check_results")
            .unwrap()
            .content
            .contains("All tests passed"));
    }

    #[test]
    fn test_process_script_failure_with_recovery() {
        let workflow = test_workflow_with_script();
        let store = Arc::new(InMemoryWorkflowStore::new());
        let api = WorkflowApi::new(workflow, store);

        let mut task = api.create_task("Test", "Description", None).unwrap();
        task.state = TaskState::agent_working("checks");
        api.store.save_task(&task).unwrap();

        let task = api
            .process_script_failure(
                &task.id,
                "npm test failed\nError: test failed",
                Some("work"),
            )
            .unwrap();

        assert_eq!(task.current_stage(), Some("work"));
        assert!(matches!(task.state, TaskState::Queued { .. }));
        assert!(!task.is_failed());
    }

    #[test]
    fn test_process_script_failure_no_recovery() {
        let workflow = test_workflow_with_script();
        let store = Arc::new(InMemoryWorkflowStore::new());
        let api = WorkflowApi::new(workflow, store);

        let mut task = api.create_task("Test", "Description", None).unwrap();
        task.state = TaskState::agent_working("checks");
        api.store.save_task(&task).unwrap();

        let task = api
            .process_script_failure(&task.id, "Critical error", None)
            .unwrap();

        assert!(task.is_failed());
    }

    #[test]
    fn test_process_script_invalid_phase() {
        let workflow = test_workflow_with_script();
        let store = Arc::new(InMemoryWorkflowStore::new());
        let api = WorkflowApi::new(workflow, store);

        let mut task = api.create_task("Test", "Description", None).unwrap();
        task.state = TaskState::queued("checks"); // Not AgentWorking
        api.store.save_task(&task).unwrap();

        let result = api.process_script_success(&task.id, "output");
        assert!(matches!(result, Err(WorkflowError::InvalidTransition(_))));
    }

    #[test]
    fn test_process_script_success_strips_ansi_codes() {
        let workflow = test_workflow_with_script();
        let store = Arc::new(InMemoryWorkflowStore::new());
        let api = WorkflowApi::new(workflow, store);

        let mut task = api.create_task("Test", "Description", None).unwrap();
        task.state = TaskState::agent_working("checks");
        api.store.save_task(&task).unwrap();

        let colored_output =
            "\x1b[32m✓ All tests passed!\x1b[0m\n\x1b[31mWarning: 1 skipped\x1b[0m";
        let task = api
            .process_script_success(&task.id, colored_output)
            .unwrap();

        let artifact = task.artifacts.get("check_results").unwrap();
        assert!(!artifact.content.contains("\x1b["));
        assert!(artifact.content.contains("✓ All tests passed!"));
        assert!(artifact.content.contains("Warning: 1 skipped"));
    }

    #[test]
    fn test_process_script_failure_strips_ansi_codes() {
        let workflow = test_workflow_with_script();
        let store = Arc::new(InMemoryWorkflowStore::new());
        let api = WorkflowApi::new(workflow, store);

        let mut task = api.create_task("Test", "Description", None).unwrap();
        task.state = TaskState::agent_working("checks");
        api.store.save_task(&task).unwrap();

        let colored_error =
            "\x1b[31mError: test failed\x1b[0m\n\x1b[33mStack trace:\x1b[0m foo.rs:42";
        let task = api
            .process_script_failure(&task.id, colored_error, Some("work"))
            .unwrap();

        assert_eq!(task.current_stage(), Some("work"));

        let iterations = api.store.get_iterations(&task.id).unwrap();
        let recovery_iter = iterations.iter().find(|i| i.stage == "work").unwrap();

        if let Some(IterationTrigger::ScriptFailure { error, .. }) = &recovery_iter.incoming_context
        {
            assert!(!error.contains("\x1b["));
            assert!(error.contains("Error: test failed"));
            assert!(error.contains("Stack trace:"));
        } else {
            panic!("Expected ScriptFailure trigger");
        }
    }

    // ========================================================================
    // Commit pipeline result tests
    // ========================================================================

    #[test]
    fn test_commit_succeeded() {
        let workflow = test_workflow();
        let store = Arc::new(InMemoryWorkflowStore::new());
        let api = WorkflowApi::new(workflow, store);

        let mut task = create_task_ready(&api, "Test", "Description");
        task.state = TaskState::committing("planning");
        api.store.save_task(&task).unwrap();

        let task = api.commit_succeeded(&task.id).unwrap();
        assert!(matches!(task.state, TaskState::Finishing { .. }));
    }

    #[test]
    fn test_commit_succeeded_wrong_phase() {
        let workflow = test_workflow();
        let store = Arc::new(InMemoryWorkflowStore::new());
        let api = WorkflowApi::new(workflow, store);

        let task = create_task_ready(&api, "Test", "Description");

        let result = api.commit_succeeded(&task.id);
        assert!(matches!(result, Err(WorkflowError::InvalidTransition(_))));
    }

    #[test]
    fn test_commit_failed_records_iteration() {
        let workflow = test_workflow();
        let store = Arc::new(InMemoryWorkflowStore::new());
        let api = WorkflowApi::new(workflow, store);

        let mut task = create_task_ready(&api, "Test", "Description");
        task.state = TaskState::committing("planning");
        api.store.save_task(&task).unwrap();

        let task = api.commit_failed(&task.id, "git commit error").unwrap();
        assert!(task.is_failed());

        let iterations = api.store.get_iterations(&task.id).unwrap();
        let commit_iter = iterations
            .iter()
            .find(|i| matches!(&i.outcome, Some(Outcome::CommitFailed { .. })));
        assert!(commit_iter.is_some(), "Should have CommitFailed iteration");

        if let Some(Outcome::CommitFailed { error }) = &commit_iter.unwrap().outcome {
            assert_eq!(error, "git commit error");
        }
    }

    #[test]
    fn test_commit_failed_wrong_phase() {
        let workflow = test_workflow();
        let store = Arc::new(InMemoryWorkflowStore::new());
        let api = WorkflowApi::new(workflow, store);

        let task = create_task_ready(&api, "Test", "Description");

        let result = api.commit_failed(&task.id, "error");
        assert!(matches!(result, Err(WorkflowError::InvalidTransition(_))));
    }
}
