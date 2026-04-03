//! Prompt service.
//!
//! Thin dispatcher that owns the Handlebars template registry
//! and delegates to interactions.

use handlebars::Handlebars;

use orkestra_types::config::WorkflowConfig;
use orkestra_types::domain::{QuestionAnswer, Task};

use crate::interactions;
use crate::types::{
    AgentConfigError, IntegrationErrorContext, ResolvedAgentConfig, ResumeType, SiblingTaskContext,
    StagePromptContext,
};

// ============================================================================
// Template Constants
// ============================================================================

const OUTPUT_FORMAT_TEMPLATE: &str = include_str!("templates/output_format.md");
const INITIAL_PROMPT_TEMPLATE: &str = include_str!("templates/initial_prompt.md");
const SYSTEM_PROMPT_TEMPLATE: &str = include_str!("templates/system_prompt.md");

// ============================================================================
// PromptService
// ============================================================================

/// Service for building agent prompts.
///
/// Owns the pre-compiled Handlebars template registry and dispatches
/// to interaction functions for each operation.
pub struct PromptService {
    templates: Handlebars<'static>,
}

impl PromptService {
    /// Create a new prompt service with all templates pre-compiled.
    pub fn new() -> Self {
        let mut hb = Handlebars::new();
        hb.register_escape_fn(handlebars::no_escape);
        hb.register_template_string("output_format", OUTPUT_FORMAT_TEMPLATE)
            .expect("output_format template should be valid");
        hb.register_template_string("initial_prompt", INITIAL_PROMPT_TEMPLATE)
            .expect("initial_prompt template should be valid");
        hb.register_template_string("system_prompt", SYSTEM_PROMPT_TEMPLATE)
            .expect("system_prompt template should be valid");
        Self { templates: hb }
    }

    // -- Build --

    /// Build a complete agent configuration from pre-loaded inputs.
    ///
    /// # Arguments
    /// * `artifact_names` - Names of artifacts that have been materialized to the worktree.
    ///   These are used to construct file paths in the prompt.
    #[allow(clippy::too_many_arguments)]
    pub fn build_agent_config(
        &self,
        workflow: &WorkflowConfig,
        task: &Task,
        stage_name: &str,
        artifact_names: &[String],
        agent_definition: &str,
        json_schema: &str,
        feedback: Option<&str>,
        integration_error: Option<IntegrationErrorContext<'_>>,
        show_direct_structured_output_hint: bool,
        sibling_tasks: &[SiblingTaskContext],
    ) -> Result<ResolvedAgentConfig, AgentConfigError> {
        interactions::build::agent_config::execute(
            &self.templates,
            workflow,
            task,
            stage_name,
            artifact_names,
            agent_definition,
            json_schema,
            feedback,
            integration_error,
            show_direct_structured_output_hint,
            sibling_tasks,
        )
    }

    /// Build the system prompt from agent definition and context.
    pub fn build_system_prompt(
        &self,
        agent_definition: &str,
        ctx: &StagePromptContext<'_>,
    ) -> String {
        interactions::build::system_prompt::execute(&self.templates, agent_definition, ctx)
    }

    /// Build a user message from task context.
    pub fn build_user_message(&self, ctx: &StagePromptContext<'_>) -> String {
        interactions::build::user_message::execute(&self.templates, ctx)
    }

    // -- Resume --

    /// Build a resume prompt for session continuation.
    pub fn build_resume_prompt(
        &self,
        stage: &str,
        resume_type: &ResumeType,
        base_branch: &str,
        artifact_names: &[String],
        worktree_path: Option<&str>,
    ) -> Result<String, AgentConfigError> {
        interactions::resume::build_prompt::execute(
            stage,
            resume_type,
            base_branch,
            artifact_names,
            worktree_path,
        )
    }

    /// Determine the resume type from context.
    pub fn determine_resume_type(
        &self,
        feedback: Option<&str>,
        integration_error: Option<&IntegrationErrorContext<'_>>,
        question_history: &[QuestionAnswer],
    ) -> ResumeType {
        interactions::resume::determine_type::execute(feedback, integration_error, question_history)
    }
}

impl Default for PromptService {
    fn default() -> Self {
        Self::new()
    }
}
