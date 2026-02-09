//! Core `WorkflowApi` struct and workflow configuration queries.

use std::sync::Arc;

use super::task_setup::TaskSetupService;
use super::IterationService;
use crate::commit_message::{
    collect_model_names, fallback_commit_message, ClaudeCommitMessageGenerator,
    CommitMessageGenerator,
};
use crate::title::{ClaudeTitleGenerator, TitleGenerator};
use crate::workflow::config::{StageConfig, WorkflowConfig};
use crate::workflow::domain::Task;
use crate::workflow::ports::{GitService, WorkflowError, WorkflowResult, WorkflowStore};
use crate::workflow::runtime::Phase;

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
    pub(crate) setup_service: Arc<TaskSetupService>,
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
            setup_service,
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
            setup_service,
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

    /// Run task setup synchronously instead of on background threads.
    ///
    /// When enabled, `create_task` and subtask setup complete inline
    /// rather than deferring to a background thread. Used by tests for
    /// deterministic execution.
    pub fn set_sync_setup(&self, sync: bool) {
        self.setup_service.set_sync(sync);
    }

    /// Get the git service, if configured.
    pub fn git_service(&self) -> Option<&Arc<dyn GitService>> {
        self.git_service.as_ref()
    }

    /// Get the workflow configuration.
    pub fn workflow(&self) -> &WorkflowConfig {
        &self.workflow
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
    ///
    /// Uses the workflow's integration config, but validates the configured
    /// `on_failure` stage exists in the task's flow. Falls back to the first
    /// stage in the flow if the configured stage is not available.
    pub fn integration_failure_stage(&self, flow: Option<&str>) -> Option<String> {
        let configured = &self.workflow.integration.on_failure;

        // Validate the configured stage exists in this task's flow
        if self.workflow.stage_in_flow(configured, flow) {
            return Some(configured.clone());
        }

        // Fallback: use the first stage in the flow
        self.workflow
            .first_stage_in_flow(flow)
            .map(|s| s.name.clone())
    }

    /// Get artifact name for a stage, with fallback default.
    pub(crate) fn artifact_name_for_stage(&self, stage: &str, default: &str) -> String {
        self.workflow
            .stage(stage)
            .map_or_else(|| default.to_string(), |s| s.artifact.clone())
    }

    /// Compute the next status after approving the current stage.
    ///
    /// Returns Done if no more stages. Uses the task's flow for progression.
    pub(crate) fn compute_next_status_on_approve(
        &self,
        current_stage: &str,
        flow: Option<&str>,
    ) -> crate::workflow::runtime::Status {
        use crate::workflow::runtime::Status;

        match self.workflow.next_stage_in_flow(current_stage, flow) {
            Some(stage) => Status::active(&stage.name),
            None => Status::Done,
        }
    }

    /// Get tasks that are Done and ready for integration (merge to target branch).
    ///
    /// Returns both parent tasks and subtasks that:
    /// - Are in Done status (not Archived — integrated tasks become Archived)
    /// - Are in Idle phase (not already integrating)
    /// - Have a worktree path (need merging)
    ///
    /// Parent tasks merge to primary (main/master).
    /// Subtasks merge to their parent's branch (stored in `base_branch`).
    pub fn get_tasks_needing_integration(&self) -> WorkflowResult<Vec<Task>> {
        let tasks = self.store.list_tasks()?;
        Ok(tasks
            .into_iter()
            .filter(|t| t.is_done() && t.phase == Phase::Idle && t.worktree_path.is_some())
            .collect())
    }

    /// Mark a task as being integrated.
    ///
    /// This sets the phase to `Integrating` to prevent double-integration
    /// and to indicate that the merge is in progress.
    ///
    /// # Errors
    ///
    /// Returns `InvalidTransition` if the task is not Done or not in Idle phase.
    pub fn mark_integrating(&self, task_id: &str) -> WorkflowResult<Task> {
        let mut task = self.get_task(task_id)?;

        if !task.is_done() {
            return Err(WorkflowError::InvalidTransition(
                "Can only integrate Done tasks".into(),
            ));
        }

        if task.phase != Phase::Idle {
            return Err(WorkflowError::InvalidTransition(format!(
                "Task must be Idle to start integration, but is {:?}",
                task.phase
            )));
        }

        task.phase = Phase::Integrating;
        task.updated_at = chrono::Utc::now().to_rfc3339();
        self.store.save_task(&task)?;
        Ok(task)
    }

    /// Get the diff for a task against its base branch.
    ///
    /// Returns the structured diff data including file paths, change types,
    /// additions/deletions counts, and unified diff content.
    ///
    /// # Errors
    ///
    /// Returns `TaskNotFound` if the task doesn't exist, or `GitError` if
    /// the task doesn't have a worktree or if the git diff operation fails.
    pub fn get_task_diff(&self, task_id: &str) -> WorkflowResult<crate::workflow::ports::TaskDiff> {
        let task = self.get_task(task_id)?;

        let git = self
            .git_service
            .as_ref()
            .ok_or_else(|| WorkflowError::GitError("No git service configured".into()))?;

        let worktree_path = task
            .worktree_path
            .as_ref()
            .ok_or_else(|| WorkflowError::GitError("Task has no worktree".into()))?;

        let branch_name = task
            .branch_name
            .as_ref()
            .ok_or_else(|| WorkflowError::GitError("Task has no branch".into()))?;

        git.diff_against_base(
            std::path::Path::new(worktree_path),
            branch_name,
            &task.base_branch,
        )
        .map_err(|e| WorkflowError::GitError(e.to_string()))
    }

    /// Get the content of a file at HEAD in a task's worktree.
    ///
    /// Returns the file content as a string, or None if the file doesn't exist.
    ///
    /// # Errors
    ///
    /// Returns `TaskNotFound` if the task doesn't exist, or `GitError` if
    /// the task doesn't have a worktree or if the git operation fails.
    pub fn get_file_content(
        &self,
        task_id: &str,
        file_path: &str,
    ) -> WorkflowResult<Option<String>> {
        let task = self.get_task(task_id)?;

        let git = self
            .git_service
            .as_ref()
            .ok_or_else(|| WorkflowError::GitError("No git service configured".into()))?;

        let worktree_path = task
            .worktree_path
            .as_ref()
            .ok_or_else(|| WorkflowError::GitError("Task has no worktree".into()))?;

        git.read_file_at_head(std::path::Path::new(worktree_path), file_path)
            .map_err(|e| WorkflowError::GitError(e.to_string()))
    }

    /// Generate a commit message for task integration.
    ///
    /// Collects model attribution from the workflow config, gets the diff summary
    /// from the git service, and invokes the commit message generator.
    /// Falls back to the task title if generation fails.
    pub fn generate_integration_commit_message(&self, task: &Task) -> String {
        // Collect model names from workflow config
        let model_names = collect_model_names(&self.workflow, task.flow.as_deref());

        // Get diff summary from git service
        let diff_summary = self.get_diff_summary(task);

        // Try AI generation, fall back to task title
        match self.commit_message_generator.generate_commit_message(
            &task.title,
            &task.description,
            &diff_summary,
            &model_names,
        ) {
            Ok(message) => message,
            Err(e) => {
                crate::orkestra_debug!(
                    "integration",
                    "Commit message generation failed for {}: {e}, using fallback",
                    task.id
                );
                fallback_commit_message(&task.title, &task.id)
            }
        }
    }

    /// Build a diff summary string for the commit message prompt.
    fn get_diff_summary(&self, task: &Task) -> String {
        use std::fmt::Write;

        let Some(git) = &self.git_service else {
            return String::from("No git diff available");
        };
        let Some(branch_name) = &task.branch_name else {
            return String::from("No branch");
        };
        let Some(worktree_path) = &task.worktree_path else {
            return String::from("No worktree");
        };

        match git.diff_against_base(
            std::path::Path::new(worktree_path),
            branch_name,
            &task.base_branch,
        ) {
            Ok(diff) => {
                let mut summary = String::new();
                for file in &diff.files {
                    let change = match file.change_type {
                        crate::workflow::ports::FileChangeType::Added => "added",
                        crate::workflow::ports::FileChangeType::Modified => "modified",
                        crate::workflow::ports::FileChangeType::Deleted => "deleted",
                        crate::workflow::ports::FileChangeType::Renamed => "renamed",
                    };
                    let _ = writeln!(
                        summary,
                        "- {} ({}, +{} -{})",
                        file.path, change, file.additions, file.deletions
                    );
                }
                if summary.is_empty() {
                    "No file changes detected".to_string()
                } else {
                    summary
                }
            }
            Err(e) => {
                crate::orkestra_debug!("integration", "Failed to get diff for commit message: {e}");
                String::from("Diff unavailable")
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::workflow::config::{StageCapabilities, StageConfig};
    use crate::workflow::InMemoryWorkflowStore;
    use std::sync::Arc;

    fn test_workflow() -> WorkflowConfig {
        WorkflowConfig::new(vec![
            StageConfig::new("planning", "plan")
                .with_capabilities(StageCapabilities::with_questions()),
            StageConfig::new("breakdown", "subtasks"),
            StageConfig::new("work", "summary").with_inputs(vec!["plan".into()]),
            StageConfig::new("review", "verdict")
                .with_inputs(vec!["plan".into(), "summary".into()])
                .with_capabilities(StageCapabilities::with_approval(Some("work".into())))
                .automated(),
        ])
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
    fn test_compute_next_status() {
        let workflow = test_workflow();
        let store = Arc::new(InMemoryWorkflowStore::new());
        let api = WorkflowApi::new(workflow, store);

        // Planning goes to breakdown (default flow)
        let status = api.compute_next_status_on_approve("planning", None);
        assert_eq!(status.stage(), Some("breakdown"));

        // Breakdown goes to work
        let status = api.compute_next_status_on_approve("breakdown", None);
        assert_eq!(status.stage(), Some("work"));

        // Work goes to review
        let status = api.compute_next_status_on_approve("work", None);
        assert_eq!(status.stage(), Some("review"));

        // Review goes to Done
        let status = api.compute_next_status_on_approve("review", None);
        assert_eq!(status, crate::workflow::runtime::Status::Done);
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
