//! Prompt context assembly.
//!
//! Builds `StagePromptContext` from workflow configuration and task state.

use orkestra_types::config::{StageConfig, WorkflowConfig};
use orkestra_types::domain::Task;
use orkestra_types::runtime::{resolve_artifact_path, TASK_ARTIFACT_NAME};

use crate::types::{
    ArtifactContext, IntegrationErrorContext, SiblingTaskContext, StagePromptContext,
};

use super::workflow_overview;

// ============================================================================
// PromptBuilder
// ============================================================================

/// Builder for stage prompts.
///
/// Takes workflow configuration and task state to generate
/// prompts for any stage.
pub struct PromptBuilder<'a> {
    workflow: &'a WorkflowConfig,
}

impl<'a> PromptBuilder<'a> {
    /// Create a new prompt builder.
    pub fn new(workflow: &'a WorkflowConfig) -> Self {
        Self { workflow }
    }

    /// Build prompt context for a stage.
    ///
    /// This provides all the context needed to render a prompt template.
    ///
    /// # Arguments
    /// * `artifact_names` - Names of artifacts that have been materialized to the worktree.
    ///   These are used to construct file paths for the prompt.
    #[allow(clippy::too_many_arguments)]
    pub fn build_context(
        &self,
        stage_name: &'a str,
        task: &'a Task,
        artifact_names: &[String],
        feedback: Option<&'a str>,
        integration_error: Option<IntegrationErrorContext<'a>>,
        show_direct_structured_output_hint: bool,
        sibling_tasks: &[SiblingTaskContext],
    ) -> Option<StagePromptContext<'a>> {
        let stage = self.workflow.stage(stage_name)?;
        Some(build_context_from_stage(
            self.workflow,
            stage,
            task,
            artifact_names,
            feedback,
            integration_error,
            show_direct_structured_output_hint,
            sibling_tasks,
        ))
    }

    /// Build context for a stage using an explicit stage config (for flow overrides).
    ///
    /// This is like `build_context` but accepts the stage directly instead of
    /// looking it up by name. Used when capabilities have been overridden by a flow.
    ///
    /// # Arguments
    /// * `artifact_names` - Names of artifacts that have been materialized to the worktree.
    ///   These are used to construct file paths for the prompt.
    #[allow(clippy::too_many_arguments)]
    pub fn build_context_with_stage(
        &self,
        stage: &'a StageConfig,
        task: &'a Task,
        artifact_names: &[String],
        feedback: Option<&'a str>,
        integration_error: Option<IntegrationErrorContext<'a>>,
        show_direct_structured_output_hint: bool,
        sibling_tasks: &[SiblingTaskContext],
    ) -> Option<StagePromptContext<'a>> {
        Some(build_context_from_stage(
            self.workflow,
            stage,
            task,
            artifact_names,
            feedback,
            integration_error,
            show_direct_structured_output_hint,
            sibling_tasks,
        ))
    }
}

// -- Helpers --

#[allow(clippy::too_many_arguments)]
fn build_context_from_stage<'a>(
    workflow: &'a WorkflowConfig,
    stage: &'a StageConfig,
    task: &'a Task,
    artifact_names: &[String],
    feedback: Option<&'a str>,
    integration_error: Option<IntegrationErrorContext<'a>>,
    show_direct_structured_output_hint: bool,
    sibling_tasks: &[SiblingTaskContext],
) -> StagePromptContext<'a> {
    // Build artifact contexts with file paths instead of content.
    // Artifacts are materialized to files before agent spawn.
    // Use absolute paths when worktree_path is available to avoid ambiguity in nested worktrees.
    let artifacts: Vec<ArtifactContext> = artifact_names
        .iter()
        .map(|name| {
            let description = workflow.artifact_description(name).map(str::to_owned);
            let file_path = resolve_artifact_path(task.worktree_path.as_deref(), name);
            ArtifactContext {
                name: name.clone(),
                file_path,
                description,
            }
        })
        .collect();

    // Question history is passed via resume prompts (IterationTrigger::Answers).
    // Initial prompts don't include question history since no questions have been asked yet.
    let question_history = Vec::new();

    let workflow_stages = workflow_overview::execute(
        workflow,
        &stage.name,
        task.flow.as_deref(),
        artifact_names,
        task.worktree_path.as_deref(),
    );

    StagePromptContext {
        stage,
        task_id: &task.id,
        task_file_path: resolve_artifact_path(task.worktree_path.as_deref(), TASK_ARTIFACT_NAME),
        artifacts,
        question_history,
        feedback,
        integration_error,
        worktree_path: task.worktree_path.as_deref(),
        base_branch: task.base_branch.as_str(),
        base_commit: task.base_commit.as_str(),
        show_direct_structured_output_hint,
        workflow_stages,
        sibling_tasks: sibling_tasks.to_vec(),
    }
}
