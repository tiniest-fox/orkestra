//! Agent configuration assembly.
//!
//! Composes context, system prompt, and user message into a complete
//! `ResolvedAgentConfig`. This is the pure assembly step — I/O (loading
//! agent definitions and schemas from disk) stays in orkestra-core.

use handlebars::Handlebars;

use orkestra_types::config::WorkflowConfig;
use orkestra_types::domain::Task;
use orkestra_types::runtime::ResourceStore;

use crate::types::{
    AgentConfigError, IntegrationErrorContext, ResolvedAgentConfig, SiblingTaskContext,
};

use super::context::PromptBuilder;

// ============================================================================
// Interaction
// ============================================================================

/// Build a complete agent configuration from pre-loaded inputs.
///
/// Takes agent definition content and JSON schema content (already loaded from
/// disk by the caller) and assembles the full `ResolvedAgentConfig`.
///
/// # Arguments
/// * `artifact_names` - Names of artifacts that have been materialized to the worktree.
///   These are used to construct file paths in the prompt.
/// * `universal_prompt` - Optional project-level instructions injected into every
///   stage's system prompt. Loaded from `.orkestra/ORKESTRA.md` by the caller.
/// * `parent_resources` - Resources from the parent task (for subtasks), merged into
///   the inline resources list in the prompt.
#[allow(clippy::too_many_arguments)]
pub fn execute(
    templates: &Handlebars<'static>,
    workflow: &WorkflowConfig,
    task: &Task,
    stage_name: &str,
    artifact_names: &[String],
    agent_definition: &str,
    json_schema: &str,
    universal_prompt: Option<&str>,
    feedback: Option<&str>,
    integration_error: Option<IntegrationErrorContext<'_>>,
    show_direct_structured_output_hint: bool,
    sibling_tasks: &[SiblingTaskContext],
    parent_resources: Option<&ResourceStore>,
) -> Result<ResolvedAgentConfig, AgentConfigError> {
    let stage = workflow
        .stage(&task.flow, stage_name)
        .ok_or_else(|| AgentConfigError::UnknownStage(stage_name.to_string()))?;

    // Build prompt context
    let builder = PromptBuilder::new(workflow);
    let ctx = builder
        .build_context_with_stage(
            stage,
            task,
            artifact_names,
            feedback,
            integration_error,
            show_direct_structured_output_hint,
            sibling_tasks,
            parent_resources,
        )
        .ok_or_else(|| AgentConfigError::PromptBuildError("Failed to build context".into()))?;

    // Build system prompt (agent definition + project instructions + output format)
    let system_prompt =
        super::system_prompt::execute(templates, agent_definition, universal_prompt, &ctx);

    // Build user message (task context only)
    let user_message = super::user_message::execute(templates, &ctx);

    // Extract dynamic sections for log entry metadata
    let dynamic_sections = super::dynamic_sections::execute(&ctx);

    Ok(ResolvedAgentConfig {
        system_prompt,
        prompt: user_message,
        json_schema: json_schema.to_string(),
        session_type: stage_name.to_string(),
        dynamic_sections,
    })
}

/// Build a complete agent configuration from a pre-resolved stage config.
///
/// Like `execute`, but accepts `stage` directly instead of looking it up
/// by name in the workflow. Use for virtual stages (e.g., vibe) that are
/// not registered in any flow's stage list.
#[allow(clippy::too_many_arguments)]
pub fn execute_with_stage<'a>(
    templates: &Handlebars<'static>,
    workflow: &'a WorkflowConfig,
    stage: &'a orkestra_types::config::StageConfig,
    task: &'a Task,
    stage_name: &str,
    artifact_names: &[String],
    agent_definition: &str,
    json_schema: &str,
    universal_prompt: Option<&str>,
    feedback: Option<&'a str>,
    integration_error: Option<IntegrationErrorContext<'a>>,
    show_direct_structured_output_hint: bool,
    sibling_tasks: &[SiblingTaskContext],
    parent_resources: Option<&ResourceStore>,
) -> Result<ResolvedAgentConfig, AgentConfigError> {
    let builder = PromptBuilder::new(workflow);
    let ctx = builder
        .build_context_with_stage(
            stage,
            task,
            artifact_names,
            feedback,
            integration_error,
            show_direct_structured_output_hint,
            sibling_tasks,
            parent_resources,
        )
        .ok_or_else(|| AgentConfigError::PromptBuildError("Failed to build context".into()))?;

    let system_prompt =
        super::system_prompt::execute(templates, agent_definition, universal_prompt, &ctx);
    let user_message = super::user_message::execute(templates, &ctx);
    let dynamic_sections = super::dynamic_sections::execute(&ctx);

    Ok(ResolvedAgentConfig {
        system_prompt,
        prompt: user_message,
        json_schema: json_schema.to_string(),
        session_type: stage_name.to_string(),
        dynamic_sections,
    })
}
