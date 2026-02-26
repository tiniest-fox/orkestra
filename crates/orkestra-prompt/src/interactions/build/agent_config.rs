//! Agent configuration assembly.
//!
//! Composes context, system prompt, and user message into a complete
//! `ResolvedAgentConfig`. This is the pure assembly step — I/O (loading
//! agent definitions and schemas from disk) stays in orkestra-core.

use handlebars::Handlebars;

use orkestra_types::config::{StageConfig, WorkflowConfig};
use orkestra_types::domain::Task;

use crate::types::{
    AgentConfigError, FlowOverrides, IntegrationErrorContext, ResolvedAgentConfig,
    SiblingTaskContext,
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
#[allow(clippy::too_many_arguments)]
pub fn execute(
    templates: &Handlebars<'static>,
    workflow: &WorkflowConfig,
    task: &Task,
    stage_name: &str,
    artifact_names: &[String],
    agent_definition: &str,
    json_schema: &str,
    feedback: Option<&str>,
    integration_error: Option<IntegrationErrorContext<'_>>,
    flow_overrides: &FlowOverrides<'_>,
    show_direct_structured_output_hint: bool,
    sibling_tasks: &[SiblingTaskContext],
) -> Result<ResolvedAgentConfig, AgentConfigError> {
    let stage = workflow
        .stage(stage_name)
        .ok_or_else(|| AgentConfigError::UnknownStage(stage_name.to_string()))?;

    // Build effective stage config (with capability overrides for flows)
    let overridden_stage = apply_overrides(stage, flow_overrides);
    let effective_stage = overridden_stage.as_ref().unwrap_or(stage);

    // Build prompt context
    let builder = PromptBuilder::new(workflow);
    let ctx = builder
        .build_context_with_stage(
            effective_stage,
            task,
            artifact_names,
            feedback,
            integration_error,
            show_direct_structured_output_hint,
            sibling_tasks,
        )
        .ok_or_else(|| AgentConfigError::PromptBuildError("Failed to build context".into()))?;

    // Build system prompt (agent definition + output format)
    let system_prompt = super::system_prompt::execute(templates, agent_definition, &ctx);

    // Build user message (task context only)
    let user_message = super::user_message::execute(templates, &ctx);

    Ok(ResolvedAgentConfig {
        system_prompt,
        prompt: user_message,
        json_schema: json_schema.to_string(),
        session_type: stage_name.to_string(),
    })
}

// -- Helpers --

/// Apply flow overrides to a stage config, returning Some if overrides were applied.
fn apply_overrides(stage: &StageConfig, flow_overrides: &FlowOverrides<'_>) -> Option<StageConfig> {
    // Only capabilities need overriding for prompt building.
    if flow_overrides.capabilities.is_some() {
        let mut s = stage.clone();
        if let Some(caps) = flow_overrides.capabilities {
            s.capabilities = caps.clone();
        }
        Some(s)
    } else {
        None
    }
}
