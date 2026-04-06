//! System prompt construction.
//!
//! Builds system prompts from agent definition and output format sections.

use handlebars::Handlebars;
use orkestra_schema::examples::{
    question_example, questions_output_example, subtask_example, subtasks_output_example,
};
use serde::Serialize;

use crate::types::StagePromptContext;

// ============================================================================
// Interaction
// ============================================================================

/// Build the system prompt from agent definition and output format.
///
/// Renders the `system_prompt.md` template with agent definition and output format.
/// The system prompt contains instructions that survive session compaction.
pub fn execute(
    templates: &Handlebars<'static>,
    agent_definition: &str,
    ctx: &StagePromptContext<'_>,
) -> String {
    let rendered_definition = render_agent_definition(agent_definition, ctx);
    let output_format = render_output_format(templates, ctx);
    render_system_prompt(templates, &rendered_definition, &output_format)
}

// -- Helpers --

/// Render the final system prompt template.
fn render_system_prompt(
    templates: &Handlebars<'static>,
    agent_definition: &str,
    output_format: &str,
) -> String {
    #[derive(Serialize)]
    struct SystemPromptContext<'a> {
        agent_definition: &'a str,
        output_format: &'a str,
    }

    let ctx = SystemPromptContext {
        agent_definition,
        output_format,
    };

    templates
        .render("system_prompt", &ctx)
        .expect("system_prompt template should render")
}

/// Context for rendering the output format template.
#[derive(Debug, Serialize)]
#[allow(clippy::struct_excessive_bools)]
struct OutputFormatContext {
    artifact_name: String,
    can_ask_questions: bool,
    questions_example: Option<String>,
    can_produce_subtasks: bool,
    subtasks_example: Option<String>,
    has_approval: bool,
    show_direct_structured_output_hint: bool,
}

/// Build the output format context with schema-validated examples.
fn build_output_format_context(ctx: &StagePromptContext<'_>) -> OutputFormatContext {
    let questions_example = if ctx.stage.capabilities.ask_questions {
        let examples = vec![question_example(
            "Which approach should we take?",
            &["Option A", "Option B"],
        )];
        Some(questions_output_example(&examples))
    } else {
        None
    };

    let subtasks_example = if ctx.stage.capabilities.produces_subtasks() {
        let examples = vec![
            subtask_example(
                "First task",
                "What needs to be done first",
                "Detailed implementation brief for the first task...",
                &[],
            ),
            subtask_example(
                "Second task",
                "Depends on first task",
                "Detailed implementation brief for the second task...",
                &[0],
            ),
        ];
        Some(subtasks_output_example(
            &examples,
            "# Technical Design\\n\\nYour detailed analysis and design content here...",
        ))
    } else {
        None
    };

    OutputFormatContext {
        artifact_name: ctx.stage.artifact_name().to_owned(),
        can_ask_questions: ctx.stage.capabilities.ask_questions,
        questions_example,
        can_produce_subtasks: ctx.stage.capabilities.produces_subtasks(),
        subtasks_example,
        has_approval: ctx.stage.capabilities.has_approval(),
        show_direct_structured_output_hint: ctx.show_direct_structured_output_hint,
    }
}

/// Render the output format section using the template.
fn render_output_format(templates: &Handlebars<'static>, ctx: &StagePromptContext<'_>) -> String {
    let format_ctx = build_output_format_context(ctx);
    templates
        .render("output_format", &format_ctx)
        .expect("output_format template should render")
}

/// Context available to agent definition Handlebars templates.
#[derive(Debug, Serialize)]
struct AgentDefinitionContext<'a> {
    stage_name: &'a str,
    task_id: &'a str,
    feedback: Option<&'a str>,
    has_artifacts: bool,
    stage_names_with_artifacts: Vec<&'a str>,
}

/// Render an agent definition as a Handlebars template.
///
/// If the definition contains no `{{` sequences, returns it unchanged (fast path).
/// On template errors, returns the raw definition with a warning logged.
fn render_agent_definition(template: &str, ctx: &StagePromptContext<'_>) -> String {
    if !template.contains("{{") {
        return template.to_string();
    }

    let def_ctx = AgentDefinitionContext {
        stage_name: &ctx.stage.name,
        task_id: ctx.task_id,
        feedback: ctx.feedback,
        has_artifacts: ctx.has_input_artifacts,
        stage_names_with_artifacts: ctx
            .workflow_stages
            .iter()
            .filter_map(|s| s.artifact_path.as_deref().map(|_| s.name.as_str()))
            .collect(),
    };

    let mut hb = Handlebars::new();
    hb.register_escape_fn(handlebars::no_escape);
    hb.render_template(template, &def_ctx).unwrap_or_else(|e| {
        eprintln!("Warning: agent definition template error: {e}");
        template.to_string()
    })
}

// ============================================================================
// Tests
// ============================================================================

#[cfg(test)]
mod tests {
    use super::*;
    use crate::interactions::build::context::PromptBuilder;
    use orkestra_types::config::{StageCapabilities, StageConfig, WorkflowConfig};
    use orkestra_types::domain::Task;

    fn test_templates() -> Handlebars<'static> {
        let mut hb = Handlebars::new();
        hb.register_escape_fn(handlebars::no_escape);
        hb.register_template_string(
            "output_format",
            include_str!("../../templates/output_format.md"),
        )
        .unwrap();
        hb.register_template_string(
            "system_prompt",
            include_str!("../../templates/system_prompt.md"),
        )
        .unwrap();
        hb
    }

    fn test_workflow() -> WorkflowConfig {
        WorkflowConfig::new(vec![
            StageConfig::new("planning", "plan")
                .with_capabilities(StageCapabilities::with_questions()),
            StageConfig::new("work", "summary"),
            StageConfig::new("review", "verdict")
                .with_capabilities(StageCapabilities::with_approval(Some("work".into())))
                .automated(),
        ])
    }

    #[test]
    fn test_build_system_prompt() {
        let templates = test_templates();
        let agent_def = "You are a planner agent. Create implementation plans.";
        let output_format = "## Output Format\n\nProduce JSON with a `plan` field.";

        let system_prompt = render_system_prompt(&templates, agent_def, output_format);

        assert!(system_prompt.contains(agent_def));
        assert!(system_prompt.contains(output_format));
    }

    #[test]
    fn test_system_prompt_contains_visual_communication() {
        let templates = test_templates();
        let agent_def = "You are a worker agent.";
        let output_format = "## Output Format\n\nProduce JSON.";

        let system_prompt = render_system_prompt(&templates, agent_def, output_format);

        assert!(
            system_prompt.contains("Visual Communication"),
            "system prompt should include Visual Communication section"
        );
        assert!(system_prompt.contains("wireframe"));
        assert!(system_prompt.contains("mermaid"));
        assert!(system_prompt.contains("Tailwind"));
    }

    #[test]
    fn test_render_agent_definition_passthrough() {
        let workflow = test_workflow();
        let builder = PromptBuilder::new(&workflow);
        let task = Task::new("task-1", "Test", "Description", "planning", "now");
        let ctx = builder
            .build_context("planning", &task, &[], None, None, false, &[], None)
            .unwrap();

        let input = "You are a planner agent. Do planning.";
        let result = render_agent_definition(input, &ctx);
        assert_eq!(result, input);
    }

    #[test]
    fn test_render_agent_definition_with_feedback_conditional() {
        let workflow = test_workflow();
        let builder = PromptBuilder::new(&workflow);
        let task = Task::new("task-1", "Test", "Description", "planning", "now");

        // With feedback
        let ctx = builder
            .build_context(
                "planning",
                &task,
                &[],
                Some("Fix this"),
                None,
                false,
                &[],
                None,
            )
            .unwrap();
        let template = "Base instructions.\n\n{{#if feedback}}\nFEEDBACK_SECTION\n{{/if}}";
        let result = render_agent_definition(template, &ctx);
        assert!(result.contains("FEEDBACK_SECTION"));
        assert!(result.contains("Base instructions."));

        // Without feedback
        let ctx = builder
            .build_context("planning", &task, &[], None, None, false, &[], None)
            .unwrap();
        let result = render_agent_definition(template, &ctx);
        assert!(!result.contains("FEEDBACK_SECTION"));
        assert!(result.contains("Base instructions."));
    }

    #[test]
    fn test_render_agent_definition_template_error_fallback() {
        let workflow = test_workflow();
        let builder = PromptBuilder::new(&workflow);
        let task = Task::new("task-1", "Test", "Description", "planning", "now");
        let ctx = builder
            .build_context("planning", &task, &[], None, None, false, &[], None)
            .unwrap();

        let bad_template = "Start {{#if}} missing close";
        let result = render_agent_definition(bad_template, &ctx);
        assert_eq!(result, bad_template);
    }

    #[test]
    fn test_render_agent_definition_context_variables() {
        let workflow = test_workflow();
        let builder = PromptBuilder::new(&workflow);
        let task = Task::new("task-1", "Test", "Description", "planning", "now");
        let ctx = builder
            .build_context("planning", &task, &[], None, None, false, &[], None)
            .unwrap();

        let template = "Stage: {{stage_name}}, Task: {{task_id}}";
        let result = render_agent_definition(template, &ctx);
        assert_eq!(result, "Stage: planning, Task: task-1");
    }
}
