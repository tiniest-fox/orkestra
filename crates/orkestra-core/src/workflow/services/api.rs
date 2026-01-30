//! Core `WorkflowApi` struct and workflow configuration queries.

use std::sync::Arc;

use super::task_setup::TaskSetupService;
use super::IterationService;
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
    pub(crate) setup_service: Arc<TaskSetupService>,
}

impl WorkflowApi {
    /// Create a new `WorkflowApi` with the given config and store.
    ///
    /// Git service is not configured by default. Use `with_git()` to add it.
    pub fn new(workflow: WorkflowConfig, store: Arc<dyn WorkflowStore>) -> Self {
        let iteration_service = Arc::new(IterationService::new(Arc::clone(&store)));
        let title_generator: Arc<dyn TitleGenerator> = Arc::new(ClaudeTitleGenerator);
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
    /// Uses the workflow's integration config.
    pub fn integration_failure_stage(&self) -> Option<&str> {
        // Use the configured on_failure stage
        Some(self.workflow.integration.on_failure.as_str())
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

    /// Get tasks that are Done and ready for integration.
    ///
    /// Returns tasks that:
    /// - Are in Done status (not Archived - integrated tasks become Archived)
    /// - Are in Idle phase (not already integrating)
    /// - Have a worktree path (need merging)
    /// - Are not subtasks (subtasks share parent's worktree)
    pub fn get_tasks_needing_integration(&self) -> WorkflowResult<Vec<Task>> {
        let tasks = self.store.list_tasks()?;
        Ok(tasks
            .into_iter()
            .filter(|t| {
                t.is_done()
                    && t.phase == Phase::Idle
                    && t.worktree_path.is_some()
                    && t.parent_id.is_none()
            })
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
                .with_capabilities(StageCapabilities::with_restage(vec!["work".into()]))
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

        // Default: "work" stage
        assert_eq!(api.integration_failure_stage(), Some("work"));
    }
}
