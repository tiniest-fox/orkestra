//! Agent configuration assembly.
//!
//! Composes context, system prompt, and user message into a complete
//! `ResolvedAgentConfig`. This is the pure assembly step — I/O (loading
//! agent definitions and schemas from disk) stays in orkestra-core.

use handlebars::Handlebars;

use orkestra_types::config::{StageConfig, WorkflowConfig};
use orkestra_types::domain::Task;

use crate::types::{
    ActivityLogEntry, AgentConfigError, FlowOverrides, IntegrationErrorContext,
    ResolvedAgentConfig, SiblingTaskContext,
};

use super::context::PromptBuilder;

// ============================================================================
// Interaction
// ============================================================================

/// Build a complete agent configuration from pre-loaded inputs.
///
/// Takes agent definition content and JSON schema content (already loaded from
/// disk by the caller) and assembles the full `ResolvedAgentConfig`.
#[allow(clippy::too_many_arguments)]
pub fn execute(
    templates: &Handlebars<'static>,
    workflow: &WorkflowConfig,
    task: &Task,
    stage_name: &str,
    agent_definition: &str,
    json_schema: &str,
    feedback: Option<&str>,
    integration_error: Option<IntegrationErrorContext<'_>>,
    flow_overrides: &FlowOverrides<'_>,
    show_direct_structured_output_hint: bool,
    activity_logs: Vec<ActivityLogEntry>,
    sibling_tasks: Vec<SiblingTaskContext>,
) -> Result<ResolvedAgentConfig, AgentConfigError> {
    let stage = workflow
        .stage(stage_name)
        .ok_or_else(|| AgentConfigError::UnknownStage(stage_name.to_string()))?;

    // Script stages don't use agent config
    if stage.is_script_stage() {
        return Err(AgentConfigError::NotInActiveStage);
    }

    // Build effective stage config (with capability/input overrides for flows)
    let overridden_stage = apply_overrides(stage, flow_overrides);
    let effective_stage = overridden_stage.as_ref().unwrap_or(stage);

    // Build prompt context
    let builder = PromptBuilder::new(workflow);
    let ctx = builder
        .build_context_with_stage(
            effective_stage,
            task,
            feedback,
            integration_error,
            show_direct_structured_output_hint,
            activity_logs,
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

/// Build a complete prompt by combining agent definition with context.
///
/// This generates a combined prompt (system + user) for backward compatibility
/// with tests and simple use cases.
pub fn build_complete_prompt(
    templates: &Handlebars<'static>,
    agent_definition: &str,
    ctx: &crate::types::StagePromptContext<'_>,
) -> String {
    let system_prompt = super::system_prompt::execute(templates, agent_definition, ctx);
    let user_message = super::user_message::execute(templates, ctx);

    format!("{system_prompt}\n\n{user_message}")
}

// -- Helpers --

/// Apply flow overrides to a stage config, returning Some if overrides were applied.
fn apply_overrides(stage: &StageConfig, flow_overrides: &FlowOverrides<'_>) -> Option<StageConfig> {
    if flow_overrides.capabilities.is_some() || flow_overrides.inputs.is_some() {
        let mut s = stage.clone();
        if let Some(caps) = flow_overrides.capabilities {
            s.capabilities = caps.clone();
        }
        if let Some(ref inputs) = flow_overrides.inputs {
            s.inputs.clone_from(inputs);
        }
        Some(s)
    } else {
        None
    }
}
