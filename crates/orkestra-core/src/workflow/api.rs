//! Core `WorkflowApi` struct and workflow configuration queries.

use std::sync::Arc;

use crate::commit_message::{ClaudeCommitMessageGenerator, CommitMessageGenerator};
use crate::pr_description::{ClaudePrDescriptionGenerator, PrDescriptionGenerator};
use crate::title::{ClaudeTitleGenerator, TitleGenerator};
use crate::workflow::config::{StageConfig, WorkflowConfig};
use crate::workflow::domain::Task;
use crate::workflow::iteration::IterationService;
use crate::workflow::ports::{GitService, PrService, WorkflowError, WorkflowResult, WorkflowStore};
use crate::workflow::task::setup::TaskSetupService;

/// Trait for killing active agent processes.
///
/// Used by `interrupt()` to kill the agent before transitioning state.
/// Implemented by `StageExecutionService`.
pub trait AgentKiller: Send + Sync {
    /// Kill the active agent for a task, removing it from tracking.
    /// Returns the PID that was killed, or None if no active agent was found.
    /// Implementations should handle errors internally (log and continue)
    /// since the state transition should proceed regardless.
    fn kill_agent(&self, task_id: &str) -> Option<u32>;
}

/// The main API for workflow operations.
///
/// This is the interface that Tauri commands, CLI, and tests use.
/// It encapsulates all business logic for task lifecycle management.
///
/// # Example
///
/// ```ignore
/// let api = WorkflowApi::new(workflow, store);
/// let task = api.create_task("Fix bug", "Fix the login bug", None)?;
/// ```
pub struct WorkflowApi {
    pub(crate) workflow: WorkflowConfig,
    pub(crate) store: Arc<dyn WorkflowStore>,
    pub(crate) git_service: Option<Arc<dyn GitService>>,
    pub(crate) iteration_service: Arc<IterationService>,
    pub(crate) title_generator: Arc<dyn TitleGenerator>,
    pub(crate) commit_message_generator: Arc<dyn CommitMessageGenerator>,
    pub(crate) pr_description_generator: Arc<dyn PrDescriptionGenerator>,
    pub(crate) pr_service: Option<Arc<dyn PrService>>,
    pub(crate) setup_service: Arc<TaskSetupService>,
    pub(crate) agent_killer: Option<Arc<dyn AgentKiller>>,
}

impl WorkflowApi {
    /// Create a new `WorkflowApi` with the given config and store.
    ///
    /// Git service is not configured by default. Use `with_git()` to add it.
    pub fn new(workflow: WorkflowConfig, store: Arc<dyn WorkflowStore>) -> Self {
        let iteration_service = Arc::new(IterationService::new(Arc::clone(&store)));
        let title_generator: Arc<dyn TitleGenerator> = Arc::new(ClaudeTitleGenerator);
        let commit_message_generator: Arc<dyn CommitMessageGenerator> =
            Arc::new(ClaudeCommitMessageGenerator);
        let pr_description_generator: Arc<dyn PrDescriptionGenerator> =
            Arc::new(ClaudePrDescriptionGenerator);
        let setup_service = Arc::new(TaskSetupService::new(
            Arc::clone(&store),
            None,
            Arc::clone(&title_generator),
        ));
        Self {
            workflow,
            store,
            git_service: None,
            iteration_service,
            title_generator,
            commit_message_generator,
            pr_description_generator,
            pr_service: None,
            setup_service,
            agent_killer: None,
        }
    }

    /// Create a new `WorkflowApi` with git worktree support.
    ///
    /// Git worktrees enable parallel task development by isolating each task
    /// in its own worktree with a dedicated branch.
    pub fn with_git(
        workflow: WorkflowConfig,
        store: Arc<dyn WorkflowStore>,
        git_service: Arc<dyn GitService>,
    ) -> Self {
        let iteration_service = Arc::new(IterationService::new(Arc::clone(&store)));
        let title_generator: Arc<dyn TitleGenerator> = Arc::new(ClaudeTitleGenerator);
        let commit_message_generator: Arc<dyn CommitMessageGenerator> =
            Arc::new(ClaudeCommitMessageGenerator);
        let pr_description_generator: Arc<dyn PrDescriptionGenerator> =
            Arc::new(ClaudePrDescriptionGenerator);
        let setup_service = Arc::new(TaskSetupService::new(
            Arc::clone(&store),
            Some(Arc::clone(&git_service)),
            Arc::clone(&title_generator),
        ));
        Self {
            workflow,
            store,
            git_service: Some(git_service),
            iteration_service,
            title_generator,
            commit_message_generator,
            pr_description_generator,
            pr_service: None,
            setup_service,
            agent_killer: None,
        }
    }

    /// Replace the title generator (for testing).
    #[must_use]
    pub fn with_title_generator(mut self, gen: Arc<dyn TitleGenerator>) -> Self {
        self.setup_service = Arc::new(TaskSetupService::new(
            Arc::clone(&self.store),
            self.git_service.clone(),
            Arc::clone(&gen),
        ));
        self.title_generator = gen;
        self
    }

    /// Replace the commit message generator (for testing).
    #[must_use]
    pub fn with_commit_message_generator(mut self, gen: Arc<dyn CommitMessageGenerator>) -> Self {
        self.commit_message_generator = gen;
        self
    }

    /// Replace the PR description generator (for testing).
    #[must_use]
    pub fn with_pr_description_generator(mut self, gen: Arc<dyn PrDescriptionGenerator>) -> Self {
        self.pr_description_generator = gen;
        self
    }

    /// Set the PR service.
    #[must_use]
    pub fn with_pr_service(mut self, service: Arc<dyn PrService>) -> Self {
        self.pr_service = Some(service);
        self
    }

    /// Run task setup synchronously instead of on background threads.
    ///
    /// When enabled, `create_task` and subtask setup complete inline
    /// rather than deferring to a background thread. Used by tests for
    /// deterministic execution.
    pub fn set_sync_setup(&self, sync: bool) {
        self.setup_service.set_sync(sync);
    }

    /// Set the agent killer (used by interrupt to kill active agents).
    pub fn set_agent_killer(&mut self, killer: Arc<dyn AgentKiller>) {
        self.agent_killer = Some(killer);
    }

    /// Get the git service, if configured.
    pub fn git_service(&self) -> Option<&Arc<dyn GitService>> {
        self.git_service.as_ref()
    }

    /// Get the workflow configuration.
    pub fn workflow(&self) -> &WorkflowConfig {
        &self.workflow
    }

    /// Get the commit message generator.
    pub fn commit_message_generator(&self) -> &Arc<dyn CommitMessageGenerator> {
        &self.commit_message_generator
    }

    /// Get the iteration service (shared reference).
    pub fn iteration_service(&self) -> &Arc<IterationService> {
        &self.iteration_service
    }

    /// Check if a stage is automated.
    pub fn is_stage_automated(&self, stage: &str) -> bool {
        self.workflow.stage(stage).is_some_and(|s| s.is_automated)
    }

    /// Check if a stage is a script stage (vs an agent stage).
    pub fn is_script_stage(&self, stage: &str) -> bool {
        self.workflow
            .stage(stage)
            .is_some_and(StageConfig::is_script_stage)
    }

    /// Get the next stage after approval from the given stage.
    ///
    /// Returns None if the stage is the last one or doesn't exist.
    pub fn next_stage_after(&self, stage: &str) -> Option<&str> {
        self.workflow.next_stage(stage).map(|s| s.name.as_str())
    }

    /// Get the next stage in a flow after the given stage.
    pub fn next_stage_after_in_flow(&self, stage: &str, flow: Option<&str>) -> Option<&str> {
        self.workflow
            .next_stage_in_flow(stage, flow)
            .map(|s| s.name.as_str())
    }

    /// Get the stage to return to on integration failure.
    pub fn integration_failure_stage(&self, flow: Option<&str>) -> Option<String> {
        let configured = self.workflow.effective_integration_on_failure(flow);
        if self.workflow.stage_in_flow(configured, flow) {
            return Some(configured.to_string());
        }
        self.workflow
            .first_stage_in_flow(flow)
            .map(|s| s.name.clone())
    }

    /// Mark a task as being integrated.
    pub fn mark_integrating(&self, task_id: &str) -> WorkflowResult<Task> {
        crate::workflow::integration::interactions::mark_integrating::execute(
            self.store.as_ref(),
            task_id,
        )
    }

    /// Get the diff for a task against its base branch.
    pub fn get_task_diff(&self, task_id: &str) -> WorkflowResult<crate::workflow::ports::TaskDiff> {
        let git = self
            .git_service
            .as_ref()
            .ok_or_else(|| WorkflowError::GitError("No git service configured".into()))?;
        crate::workflow::query::interactions::diff::execute(
            self.store.as_ref(),
            git.as_ref(),
            task_id,
        )
    }

    /// Get the content of a file at HEAD in a task's worktree.
    pub fn get_file_content(
        &self,
        task_id: &str,
        file_path: &str,
    ) -> WorkflowResult<Option<String>> {
        let git = self
            .git_service
            .as_ref()
            .ok_or_else(|| WorkflowError::GitError("No git service configured".into()))?;
        crate::workflow::query::interactions::file_content::execute(
            self.store.as_ref(),
            git.as_ref(),
            task_id,
            file_path,
        )
    }

    /// Generate a commit message for task integration.
    ///
    /// Collects model attribution from the workflow config, gets the diff summary
    /// from the git service, and invokes the commit message generator.
    /// Falls back to the task title if generation fails.
    pub fn generate_integration_commit_message(&self, task: &Task) -> String {
        match &self.git_service {
            Some(git) => super::integration::interactions::generate_commit_message::execute(
                git.as_ref(),
                task,
                &self.workflow,
                self.commit_message_generator.as_ref(),
            ),
            None => {
                super::integration::interactions::generate_commit_message::execute_without_diff(
                    task,
                    &self.workflow,
                    self.commit_message_generator.as_ref(),
                )
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::workflow::config::{
        FlowConfig, FlowIntegrationOverride, FlowStageEntry, IntegrationConfig, StageCapabilities,
        StageConfig,
    };
    use crate::workflow::InMemoryWorkflowStore;
    use indexmap::IndexMap;
    use std::sync::Arc;

    fn test_workflow() -> WorkflowConfig {
        WorkflowConfig::new(vec![
            StageConfig::new("planning", "plan")
                .with_capabilities(StageCapabilities::with_questions()),
            StageConfig::new("breakdown", "subtasks"),
            StageConfig::new("work", "summary"),
            StageConfig::new("review", "verdict")
                .with_capabilities(StageCapabilities::with_approval(Some("work".into())))
                .automated(),
        ])
        .with_integration(IntegrationConfig::new("work"))
    }

    #[test]
    fn test_new() {
        let workflow = test_workflow();
        let store = Arc::new(InMemoryWorkflowStore::new());
        let api = WorkflowApi::new(workflow, store);

        assert_eq!(api.workflow().stages.len(), 4);
    }

    #[test]
    fn test_is_stage_automated() {
        let workflow = test_workflow();
        let store = Arc::new(InMemoryWorkflowStore::new());
        let api = WorkflowApi::new(workflow, store);

        assert!(!api.is_stage_automated("planning"));
        assert!(!api.is_stage_automated("work"));
        assert!(api.is_stage_automated("review"));
        assert!(!api.is_stage_automated("nonexistent"));
    }

    #[test]
    fn test_next_stage_after() {
        let workflow = test_workflow();
        let store = Arc::new(InMemoryWorkflowStore::new());
        let api = WorkflowApi::new(workflow, store);

        assert_eq!(api.next_stage_after("planning"), Some("breakdown"));
        assert_eq!(api.next_stage_after("breakdown"), Some("work"));
        assert_eq!(api.next_stage_after("work"), Some("review"));
        assert_eq!(api.next_stage_after("review"), None);
        assert_eq!(api.next_stage_after("nonexistent"), None);
    }

    #[test]
    fn test_compute_next_state() {
        use crate::workflow::stage::interactions::finalize_advancement::compute_next_state_on_approve;

        let workflow = test_workflow();

        // Planning goes to breakdown (default flow)
        let state = compute_next_state_on_approve(&workflow, "planning", None);
        assert_eq!(state.stage(), Some("breakdown"));

        // Breakdown goes to work
        let state = compute_next_state_on_approve(&workflow, "breakdown", None);
        assert_eq!(state.stage(), Some("work"));

        // Work goes to review
        let state = compute_next_state_on_approve(&workflow, "work", None);
        assert_eq!(state.stage(), Some("review"));

        // Review goes to Done
        let state = compute_next_state_on_approve(&workflow, "review", None);
        assert_eq!(state, crate::workflow::runtime::TaskState::Done);
    }

    #[test]
    fn test_integration_failure_stage() {
        let workflow = test_workflow();
        let store = Arc::new(InMemoryWorkflowStore::new());
        let api = WorkflowApi::new(workflow, store);

        // Default flow: "work" stage
        assert_eq!(
            api.integration_failure_stage(None),
            Some("work".to_string())
        );
    }

    #[test]
    fn test_integration_failure_stage_with_flow_override() {
        let mut flows = IndexMap::new();
        flows.insert(
            "quick".to_string(),
            FlowConfig {
                description: "Quick flow".to_string(),
                icon: None,
                stages: vec![
                    FlowStageEntry {
                        stage_name: "planning".to_string(),
                        overrides: None,
                    },
                    FlowStageEntry {
                        stage_name: "work".to_string(),
                        overrides: None,
                    },
                ],
                integration: Some(FlowIntegrationOverride {
                    on_failure: Some("planning".to_string()),
                }),
            },
        );

        let workflow = WorkflowConfig::new(vec![
            StageConfig::new("planning", "plan")
                .with_capabilities(StageCapabilities::with_questions()),
            StageConfig::new("breakdown", "subtasks"),
            StageConfig::new("work", "summary"),
            StageConfig::new("review", "verdict")
                .with_capabilities(StageCapabilities::with_approval(Some("work".into())))
                .automated(),
        ])
        .with_integration(IntegrationConfig {
            on_failure: "work".to_string(),
            auto_merge: false,
        })
        .with_flows(flows);

        let store = Arc::new(InMemoryWorkflowStore::new());
        let api = WorkflowApi::new(workflow, store);

        // Default flow uses global
        assert_eq!(
            api.integration_failure_stage(None),
            Some("work".to_string())
        );

        // Flow with override uses override
        assert_eq!(
            api.integration_failure_stage(Some("quick")),
            Some("planning".to_string())
        );
    }

    #[test]
    fn test_with_commit_message_generator() {
        use crate::commit_message::mock::MockCommitMessageGenerator;

        let workflow = test_workflow();
        let store = Arc::new(InMemoryWorkflowStore::new());
        let mock_gen = Arc::new(MockCommitMessageGenerator::succeeding());

        let api = WorkflowApi::new(workflow, store).with_commit_message_generator(mock_gen);

        // Verify the generator can be overridden (by creating a task and calling generate)
        let task = Task::new(
            "task-1",
            "Test Task",
            "Test description",
            "planning",
            chrono::Utc::now().to_rfc3339(),
        );
        let message = api.generate_integration_commit_message(&task);

        // Mock generator returns the task title followed by "Automated changes."
        assert!(message.contains("Test Task"));
        assert!(message.contains("Automated changes."));
    }

    #[test]
    fn test_generate_commit_message_fallback_on_failure() {
        use crate::commit_message::mock::MockCommitMessageGenerator;

        let workflow = test_workflow();
        let store = Arc::new(InMemoryWorkflowStore::new());
        let failing_gen = Arc::new(MockCommitMessageGenerator::failing());

        let api = WorkflowApi::new(workflow, store).with_commit_message_generator(failing_gen);

        let task = Task::new(
            "task-123",
            "Test Task",
            "Test description",
            "planning",
            chrono::Utc::now().to_rfc3339(),
        );
        let message = api.generate_integration_commit_message(&task);

        // On failure, should fall back to task title
        assert_eq!(message, "Test Task");
    }

    #[test]
    fn test_generate_commit_message_fallback_on_empty_title() {
        use crate::commit_message::mock::MockCommitMessageGenerator;

        let workflow = test_workflow();
        let store = Arc::new(InMemoryWorkflowStore::new());
        let failing_gen = Arc::new(MockCommitMessageGenerator::failing());

        let api = WorkflowApi::new(workflow, store).with_commit_message_generator(failing_gen);

        let task = Task::new(
            "task-456",
            "",
            "Test description",
            "planning",
            chrono::Utc::now().to_rfc3339(),
        );
        let message = api.generate_integration_commit_message(&task);

        // On failure with empty title, should fall back to "Task {id}"
        assert_eq!(message, "Task task-456");
    }
}
