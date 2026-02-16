//! Prompt context assembly.
//!
//! Builds `StagePromptContext` from workflow configuration and task state.

use orkestra_types::config::{StageConfig, WorkflowConfig};
use orkestra_types::domain::Task;

use crate::types::{
    ActivityLogEntry, ArtifactContext, IntegrationErrorContext, SiblingTaskContext,
    StagePromptContext,
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
    #[allow(clippy::too_many_arguments)]
    pub fn build_context(
        &self,
        stage_name: &'a str,
        task: &'a Task,
        feedback: Option<&'a str>,
        integration_error: Option<IntegrationErrorContext<'a>>,
        show_direct_structured_output_hint: bool,
        activity_logs: Vec<ActivityLogEntry>,
        sibling_tasks: Vec<SiblingTaskContext>,
    ) -> Option<StagePromptContext<'a>> {
        let stage = self.workflow.stage(stage_name)?;
        Some(build_context_from_stage(
            self.workflow,
            stage,
            task,
            feedback,
            integration_error,
            show_direct_structured_output_hint,
            activity_logs,
            sibling_tasks,
        ))
    }

    /// Build context for a stage using an explicit stage config (for flow overrides).
    ///
    /// This is like `build_context` but accepts the stage directly instead of
    /// looking it up by name. Used when capabilities have been overridden by a flow.
    #[allow(clippy::too_many_arguments)]
    pub fn build_context_with_stage(
        &self,
        stage: &'a StageConfig,
        task: &'a Task,
        feedback: Option<&'a str>,
        integration_error: Option<IntegrationErrorContext<'a>>,
        show_direct_structured_output_hint: bool,
        activity_logs: Vec<ActivityLogEntry>,
        sibling_tasks: Vec<SiblingTaskContext>,
    ) -> Option<StagePromptContext<'a>> {
        Some(build_context_from_stage(
            self.workflow,
            stage,
            task,
            feedback,
            integration_error,
            show_direct_structured_output_hint,
            activity_logs,
            sibling_tasks,
        ))
    }

    /// Build a simple text prompt for a stage.
    ///
    /// This generates a basic prompt without using templates.
    pub fn build_simple_prompt(
        &self,
        stage_name: &'a str,
        task: &'a Task,
        feedback: Option<&'a str>,
    ) -> Option<String> {
        let ctx = self.build_context(
            stage_name,
            task,
            feedback,
            None,
            false,
            Vec::new(),
            Vec::new(),
        )?;

        Some(format_simple_prompt(&ctx))
    }
}

// -- Helpers --

#[allow(clippy::too_many_arguments)]
fn build_context_from_stage<'a>(
    workflow: &'a WorkflowConfig,
    stage: &'a StageConfig,
    task: &'a Task,
    feedback: Option<&'a str>,
    integration_error: Option<IntegrationErrorContext<'a>>,
    show_direct_structured_output_hint: bool,
    activity_logs: Vec<ActivityLogEntry>,
    sibling_tasks: Vec<SiblingTaskContext>,
) -> StagePromptContext<'a> {
    let artifacts: Vec<ArtifactContext<'a>> = stage
        .inputs
        .iter()
        .filter_map(|input_name| {
            task.artifacts
                .get(input_name)
                .map(|artifact| ArtifactContext {
                    name: &artifact.name,
                    content: &artifact.content,
                })
        })
        .collect();

    // Question history is passed via resume prompts (IterationTrigger::Answers).
    // Initial prompts don't include question history since no questions have been asked yet.
    let question_history = Vec::new();

    let workflow_stages = workflow_overview::execute(workflow, &stage.name, task.flow.as_deref());

    StagePromptContext {
        stage,
        task_id: &task.id,
        title: &task.title,
        description: &task.description,
        artifacts,
        question_history,
        feedback,
        integration_error,
        worktree_path: task.worktree_path.as_deref(),
        base_branch: task.base_branch.as_str(),
        base_commit: task.base_commit.as_str(),
        show_direct_structured_output_hint,
        activity_logs,
        workflow_stages,
        sibling_tasks,
    }
}

fn format_simple_prompt(ctx: &StagePromptContext<'_>) -> String {
    use std::fmt::Write as _;

    let mut prompt = String::new();

    // Header
    let display_name = ctx.stage.display_name.as_deref().unwrap_or(&ctx.stage.name);
    let _ = write!(prompt, "# Stage: {display_name}\n\n");

    // Task info
    prompt.push_str("## Task\n\n");
    let _ = writeln!(prompt, "**ID:** {}", ctx.task_id);
    let _ = writeln!(prompt, "**Title:** {}", ctx.title);
    let _ = write!(prompt, "\n{}\n\n", ctx.description);

    // Input artifacts
    if !ctx.artifacts.is_empty() {
        prompt.push_str("## Input Artifacts\n\n");
        for artifact in &ctx.artifacts {
            let _ = write!(prompt, "### {}\n\n", artifact.name);
            let _ = write!(prompt, "{}\n\n", artifact.content);
        }
    }

    // Question history
    if !ctx.question_history.is_empty() {
        prompt.push_str("## Previous Questions & Answers\n\n");
        for qa in &ctx.question_history {
            let _ = writeln!(prompt, "**Q:** {}", qa.question);
            let _ = writeln!(prompt, "**A:** {}\n", qa.answer);
        }
    }

    // Feedback
    if let Some(fb) = ctx.feedback {
        prompt.push_str("## Feedback to Address\n\n");
        let _ = write!(prompt, "{fb}\n\n");
    }

    // Expected output
    prompt.push_str("## Expected Output\n\n");
    let _ = writeln!(
        prompt,
        "Produce the `{}` artifact for this stage.",
        ctx.stage.artifact
    );

    // Capabilities
    if ctx.stage.capabilities.ask_questions {
        prompt.push_str("\nYou may ask clarifying questions if needed.\n");
    }
    if ctx.stage.capabilities.produces_subtasks() {
        prompt.push_str("\nYou may break this down into subtasks if appropriate.\n");
    }
    if ctx.stage.capabilities.has_approval() {
        prompt.push_str("\nYou must produce an approval decision (approve or reject).\n");
    }

    prompt
}
