//! Prompt building service.
//!
//! This service encapsulates prompt generation for agents. It captures
//! the project root at construction time and provides methods for resolving
//! complete agent configurations.
//!
//! The service delegates to the existing prompt building infrastructure
//! in the execution module.

use std::path::{Path, PathBuf};

use crate::workflow::config::WorkflowConfig;
use crate::workflow::domain::Task;
use crate::workflow::execution::{
    resolve_stage_agent_config, AgentConfigError, IntegrationErrorContext, ResolvedAgentConfig,
};

// ============================================================================
// Prompt Service
// ============================================================================

/// Service for building agent prompts.
///
/// This service encapsulates the project root and provides a clean interface
/// for resolving agent configurations. It acts as a facade over the lower-level
/// prompt building functions.
pub struct PromptService {
    /// Project root directory for loading agent definitions and schemas.
    project_root: PathBuf,
}

impl PromptService {
    /// Create a new prompt service for the given project root.
    pub fn new(project_root: impl Into<PathBuf>) -> Self {
        Self {
            project_root: project_root.into(),
        }
    }

    /// Get the project root path.
    pub fn project_root(&self) -> &Path {
        &self.project_root
    }

    /// Resolve complete agent configuration for a task.
    ///
    /// This method determines the appropriate prompt, schema, and session type
    /// for spawning an agent based on the task's current stage.
    ///
    /// # Arguments
    /// * `workflow` - The workflow configuration
    /// * `task` - The task requiring an agent
    /// * `feedback` - Optional rejection feedback to incorporate
    /// * `integration_error` - Optional merge conflict information
    ///
    /// # Returns
    /// Complete agent configuration including prompt and JSON schema.
    pub fn resolve_config(
        &self,
        workflow: &WorkflowConfig,
        task: &Task,
        feedback: Option<&str>,
        integration_error: Option<IntegrationErrorContext<'_>>,
    ) -> Result<ResolvedAgentConfig, AgentConfigError> {
        resolve_stage_agent_config(
            workflow,
            task,
            Some(&self.project_root),
            feedback,
            integration_error,
        )
    }

    /// Resolve agent configuration with just feedback (no integration error).
    ///
    /// Convenience method for the common case of rejection feedback.
    pub fn resolve_with_feedback(
        &self,
        workflow: &WorkflowConfig,
        task: &Task,
        feedback: &str,
    ) -> Result<ResolvedAgentConfig, AgentConfigError> {
        self.resolve_config(workflow, task, Some(feedback), None)
    }

    /// Resolve agent configuration with no additional context.
    ///
    /// Convenience method for fresh agent spawns with no feedback.
    pub fn resolve_fresh(
        &self,
        workflow: &WorkflowConfig,
        task: &Task,
    ) -> Result<ResolvedAgentConfig, AgentConfigError> {
        self.resolve_config(workflow, task, None, None)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::workflow::config::{StageConfig, WorkflowConfig};

    fn test_workflow() -> WorkflowConfig {
        WorkflowConfig::new(vec![
            StageConfig::new("planning", "plan"),
            StageConfig::new("work", "summary").with_inputs(vec!["plan".into()]),
        ])
    }

    #[test]
    fn test_prompt_service_new() {
        let service = PromptService::new("/path/to/project");
        assert_eq!(service.project_root(), Path::new("/path/to/project"));
    }

    #[test]
    fn test_resolve_fresh_not_in_stage() {
        let service = PromptService::new("/tmp");
        let workflow = test_workflow();

        // Task with no active stage (terminal status)
        let mut task = Task::new("task-1", "Test", "Desc", "planning", "now");
        task.status = crate::workflow::runtime::Status::Done;

        let result = service.resolve_fresh(&workflow, &task);
        assert!(matches!(result, Err(AgentConfigError::NotInActiveStage)));
    }

    #[test]
    fn test_resolve_fresh_unknown_stage() {
        let service = PromptService::new("/tmp");
        let workflow = test_workflow();

        // Task in an unknown stage
        let task = Task::new("task-1", "Test", "Desc", "nonexistent", "now");

        let result = service.resolve_fresh(&workflow, &task);
        assert!(matches!(result, Err(AgentConfigError::UnknownStage(_))));
    }
}
