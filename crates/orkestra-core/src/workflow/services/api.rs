//! Core WorkflowApi struct and workflow configuration queries.

use std::sync::Arc;

use crate::workflow::config::WorkflowConfig;
use crate::workflow::ports::{GitService, WorkflowStore};

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
}

impl WorkflowApi {
    /// Create a new WorkflowApi with the given config and store.
    ///
    /// Git service is not configured by default. Use `with_git()` to add it.
    pub fn new(workflow: WorkflowConfig, store: Arc<dyn WorkflowStore>) -> Self {
        Self {
            workflow,
            store,
            git_service: None,
        }
    }

    /// Create a new WorkflowApi with git worktree support.
    ///
    /// Git worktrees enable parallel task development by isolating each task
    /// in its own worktree with a dedicated branch.
    pub fn with_git(
        workflow: WorkflowConfig,
        store: Arc<dyn WorkflowStore>,
        git_service: Arc<dyn GitService>,
    ) -> Self {
        Self {
            workflow,
            store,
            git_service: Some(git_service),
        }
    }

    /// Get the git service, if configured.
    pub fn git_service(&self) -> Option<&Arc<dyn GitService>> {
        self.git_service.as_ref()
    }

    /// Get the workflow configuration.
    pub fn workflow(&self) -> &WorkflowConfig {
        &self.workflow
    }

    /// Check if a stage is automated.
    pub fn is_stage_automated(&self, stage: &str) -> bool {
        self.workflow
            .stage(stage)
            .map(|s| s.is_automated)
            .unwrap_or(false)
    }

    /// Get the next stage after approval from the given stage.
    ///
    /// Returns None if the stage is the last one or doesn't exist.
    pub fn next_stage_after(&self, stage: &str) -> Option<&str> {
        self.workflow.next_stage(stage).map(|s| s.name.as_str())
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
    /// Skips optional stages and returns Done if no more stages.
    pub(crate) fn compute_next_status_on_approve(
        &self,
        current_stage: &str,
    ) -> crate::workflow::runtime::Status {
        use crate::workflow::runtime::Status;

        let mut next = self.workflow.next_stage(current_stage);

        // Skip optional stages
        while let Some(stage) = next {
            if stage.is_optional {
                next = self.workflow.next_stage(&stage.name);
            } else {
                return Status::active(&stage.name);
            }
        }

        // No more stages - task is done
        Status::Done
    }
}

#[cfg(test)]
mod tests {
    use std::sync::Arc;
    use super::*;
    use crate::workflow::config::{StageCapabilities, StageConfig};
    use crate::workflow::InMemoryWorkflowStore;

    fn test_workflow() -> WorkflowConfig {
        WorkflowConfig::new(vec![
            StageConfig::new("planning", "plan")
                .with_capabilities(StageCapabilities::with_questions()),
            StageConfig::new("breakdown", "subtasks").optional(),
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
    fn test_compute_next_status_skips_optional() {
        let workflow = test_workflow();
        let store = Arc::new(InMemoryWorkflowStore::new());
        let api = WorkflowApi::new(workflow, store);

        // Planning should skip optional breakdown and go to work
        let status = api.compute_next_status_on_approve("planning");
        assert_eq!(status.stage(), Some("work"));

        // Work goes to review
        let status = api.compute_next_status_on_approve("work");
        assert_eq!(status.stage(), Some("review"));

        // Review goes to Done
        let status = api.compute_next_status_on_approve("review");
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
