//! Stage-agnostic prompt builder.
//!
//! Generates prompts for any stage based on workflow configuration
//! and available artifacts.

use std::fmt::Write as _;
use std::fs;
use std::path::Path;
use std::sync::LazyLock;

use handlebars::Handlebars;
use serde::Serialize;

use crate::prompts::examples::{
    question_example, questions_output_example, subtask_example, subtasks_output_example,
};
use crate::workflow::config::{StageConfig, WorkflowConfig};
use crate::workflow::domain::{QuestionAnswer, Task};

// =============================================================================
// Template Loading
// =============================================================================

const OUTPUT_FORMAT_TEMPLATE: &str = include_str!("../../prompts/templates/output_format.md");

static TEMPLATES: LazyLock<Handlebars<'static>> = LazyLock::new(|| {
    let mut hb = Handlebars::new();
    hb.register_escape_fn(handlebars::no_escape);
    hb.register_template_string("output_format", OUTPUT_FORMAT_TEMPLATE)
        .expect("output_format template should be valid");
    hb
});

/// Context for rendering the output format template.
#[derive(Debug, Serialize)]
struct OutputFormatContext {
    artifact_name: String,
    can_ask_questions: bool,
    questions_example: Option<String>,
    can_produce_subtasks: bool,
    subtasks_example: Option<String>,
    skip_example: Option<String>,
    has_approval: bool,
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

    let (subtasks_example, skip_example) = if ctx.stage.capabilities.produces_subtasks() {
        let examples = vec![
            subtask_example("First task", "What needs to be done first", &[]),
            subtask_example("Second task", "Depends on first task", &[0]),
        ];
        (
            Some(subtasks_output_example(
                &examples,
                None,
                "# Technical Design\\n\\nYour detailed analysis and design content here...",
            )),
            Some(subtasks_output_example(
                &[],
                Some("Task is simple enough to complete directly"),
                "# Analysis\\n\\nBrief analysis of why this task doesn't need breakdown...",
            )),
        )
    } else {
        (None, None)
    };

    OutputFormatContext {
        artifact_name: ctx.stage.artifact.clone(),
        can_ask_questions: ctx.stage.capabilities.ask_questions,
        questions_example,
        can_produce_subtasks: ctx.stage.capabilities.produces_subtasks(),
        subtasks_example,
        skip_example,
        has_approval: ctx.stage.capabilities.has_approval(),
    }
}

/// Render the output format section using the template.
fn render_output_format(ctx: &StagePromptContext<'_>) -> String {
    let format_ctx = build_output_format_context(ctx);
    TEMPLATES
        .render("output_format", &format_ctx)
        .expect("output_format template should render")
}

/// Context for building a stage prompt.
#[derive(Debug, Clone, Serialize)]
pub struct StagePromptContext<'a> {
    /// Stage configuration.
    pub stage: &'a StageConfig,

    /// Task information.
    pub task_id: &'a str,
    pub title: &'a str,
    pub description: &'a str,

    /// Available artifacts from previous stages.
    pub artifacts: Vec<ArtifactContext<'a>>,

    /// Question history (if stage can ask questions).
    pub question_history: Vec<QuestionAnswerContext<'a>>,

    /// Feedback from rejection (if retrying).
    pub feedback: Option<&'a str>,

    /// Integration error (if resuming after merge conflict).
    pub integration_error: Option<IntegrationErrorContext<'a>>,

    /// Worktree path (for git worktree isolation).
    pub worktree_path: Option<&'a str>,
}

/// Context for an artifact available to the stage.
#[derive(Debug, Clone, Serialize)]
pub struct ArtifactContext<'a> {
    /// Artifact name.
    pub name: &'a str,
    /// Artifact content.
    pub content: &'a str,
}

/// Context for a question-answer pair.
#[derive(Debug, Clone, Serialize)]
pub struct QuestionAnswerContext<'a> {
    /// The question that was asked.
    pub question: &'a str,
    /// The user's answer.
    pub answer: &'a str,
}

/// Context for an integration error.
#[derive(Debug, Clone, Serialize)]
pub struct IntegrationErrorContext<'a> {
    /// Error message.
    pub message: &'a str,
    /// Files with conflicts.
    pub conflict_files: Vec<&'a str>,
}

/// Flow-specific overrides for agent configuration.
///
/// When a task uses a named flow, the flow may override the prompt path
/// and/or capabilities for specific stages.
#[derive(Debug, Default, Clone, Copy)]
pub struct FlowOverrides<'a> {
    /// Override the prompt template path.
    pub prompt: Option<&'a str>,
    /// Override the stage capabilities.
    pub capabilities: Option<&'a crate::workflow::config::StageCapabilities>,
}

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
    pub fn build_context(
        &self,
        stage_name: &'a str,
        task: &'a Task,
        feedback: Option<&'a str>,
        integration_error: Option<IntegrationErrorContext<'a>>,
    ) -> Option<StagePromptContext<'a>> {
        let stage = self.workflow.stage(stage_name)?;

        // Gather artifacts that this stage needs as inputs
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

        // Question history is now passed via resume prompts (IterationTrigger::Answers)
        // Initial prompts don't include question history since no questions have been asked yet
        let question_history = Vec::new();

        Some(StagePromptContext {
            stage,
            task_id: &task.id,
            title: &task.title,
            description: &task.description,
            artifacts,
            question_history,
            feedback,
            integration_error,
            worktree_path: task.worktree_path.as_deref(),
        })
    }

    /// Build context for a stage using an explicit stage config (for flow overrides).
    ///
    /// This is like `build_context` but accepts the stage directly instead of
    /// looking it up by name. Used when capabilities have been overridden by a flow.
    pub fn build_context_with_stage(
        &self,
        stage: &'a StageConfig,
        task: &'a Task,
        feedback: Option<&'a str>,
        integration_error: Option<IntegrationErrorContext<'a>>,
    ) -> Option<StagePromptContext<'a>> {
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

        let question_history = Vec::new();

        Some(StagePromptContext {
            stage,
            task_id: &task.id,
            title: &task.title,
            description: &task.description,
            artifacts,
            question_history,
            feedback,
            integration_error,
            worktree_path: task.worktree_path.as_deref(),
        })
    }

    /// Build a simple text prompt for a stage.
    ///
    /// This generates a basic prompt without using templates.
    /// For production use, you'd use Handlebars templates.
    pub fn build_simple_prompt(
        &self,
        stage_name: &'a str,
        task: &'a Task,
        feedback: Option<&'a str>,
    ) -> Option<String> {
        let ctx = self.build_context(stage_name, task, feedback, None)?;

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

        Some(prompt)
    }
}

/// Helper to convert `QuestionAnswer` to context.
impl<'a> From<&'a QuestionAnswer> for QuestionAnswerContext<'a> {
    fn from(qa: &'a QuestionAnswer) -> Self {
        Self {
            question: &qa.question,
            answer: &qa.answer,
        }
    }
}

// ============================================================================
// Agent Configuration Resolution
// ============================================================================

/// Resolved configuration for spawning an agent.
#[derive(Debug, Clone)]
pub struct ResolvedAgentConfig {
    /// The complete prompt to send to the agent.
    pub prompt: String,
    /// JSON schema for structured output (required).
    pub json_schema: String,
    /// Session type identifier (e.g., "planning", "work").
    pub session_type: String,
}

/// Error type for agent configuration resolution.
#[derive(Debug, Clone)]
pub enum AgentConfigError {
    /// Task is not in an active stage.
    NotInActiveStage,
    /// Stage not found in workflow.
    UnknownStage(String),
    /// Agent definition file not found.
    DefinitionNotFound(String),
    /// Failed to build prompt.
    PromptBuildError(String),
}

impl std::fmt::Display for AgentConfigError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::NotInActiveStage => write!(f, "Task is not in an active stage"),
            Self::UnknownStage(name) => write!(f, "Unknown stage: {name}"),
            Self::DefinitionNotFound(msg) => write!(f, "Agent definition not found: {msg}"),
            Self::PromptBuildError(msg) => write!(f, "Failed to build prompt: {msg}"),
        }
    }
}

impl std::error::Error for AgentConfigError {}

/// Load an agent definition from the agents directory.
///
/// Search order:
/// 1. `.orkestra/agents/{path}` in the project
/// 2. `~/.orkestra/agents/{path}` for global/default agents
pub fn load_agent_definition(project_root: Option<&Path>, path: &str) -> std::io::Result<String> {
    // Try project .orkestra/agents/ first
    if let Some(root) = project_root {
        let local_path = root.join(".orkestra/agents").join(path);
        if local_path.exists() {
            return fs::read_to_string(local_path);
        }
    }

    // Fall back to home directory for global/default agents
    if let Some(home) = dirs::home_dir() {
        let home_path = home.join(".orkestra/agents").join(path);
        if home_path.exists() {
            return fs::read_to_string(home_path);
        }
    }

    Err(std::io::Error::new(
        std::io::ErrorKind::NotFound,
        format!(
            "Agent definition not found: {path} (searched .orkestra/agents/ and ~/.orkestra/agents/)"
        ),
    ))
}

/// Load a custom JSON schema from the schemas directory.
pub fn load_custom_schema(project_root: Option<&Path>, path: &str) -> std::io::Result<String> {
    // Try project .orkestra/schemas/ first
    if let Some(root) = project_root {
        let local_path = root.join(".orkestra/schemas").join(path);
        if local_path.exists() {
            return fs::read_to_string(local_path);
        }
    }

    // Fall back to home directory
    if let Some(home) = dirs::home_dir() {
        let home_path = home.join(".orkestra/schemas").join(path);
        if home_path.exists() {
            return fs::read_to_string(home_path);
        }
    }

    Err(std::io::Error::new(
        std::io::ErrorKind::NotFound,
        format!("Custom schema not found: {path}"),
    ))
}

/// Get the JSON schema for a stage's agent.
///
/// Generates schema dynamically based on stage configuration,
/// or loads custom schema if specified.
///
/// Returns None for script stages (they don't use JSON schemas).
pub fn get_agent_schema(stage_config: &StageConfig, project_root: Option<&Path>) -> Option<String> {
    // Script stages don't have schemas
    if stage_config.is_script_stage() {
        return None;
    }

    // Check for custom schema file first
    if let Some(schema_file) = &stage_config.schema_file {
        if let Ok(custom_schema) = load_custom_schema(project_root, schema_file) {
            return Some(custom_schema);
        }
        // Fall through to dynamic generation if custom file not found
        crate::orkestra_debug!(
            "prompt",
            "Custom schema file '{schema_file}' not found, using generated schema"
        );
    }

    // Generate schema dynamically based on stage config
    let schema_config = crate::prompts::SchemaConfig {
        artifact_name: &stage_config.artifact,
        capabilities: &stage_config.capabilities,
    };
    Some(crate::prompts::generate_stage_schema(&schema_config))
}

/// Resolve complete agent configuration for a stage.
///
/// This is the main entry point for the orchestrator to get everything
/// needed to spawn an agent: prompt, schema, and session type.
pub fn resolve_stage_agent_config(
    workflow: &WorkflowConfig,
    task: &Task,
    project_root: Option<&Path>,
    feedback: Option<&str>,
    integration_error: Option<IntegrationErrorContext<'_>>,
) -> Result<ResolvedAgentConfig, AgentConfigError> {
    // Get current stage
    let stage_name = task
        .current_stage()
        .ok_or(AgentConfigError::NotInActiveStage)?;

    resolve_stage_agent_config_for(
        workflow,
        task,
        stage_name,
        project_root,
        feedback,
        integration_error,
        FlowOverrides::default(),
    )
}

/// Resolve agent configuration for a specific stage with optional overrides.
///
/// Allows flow-specific prompt and capability overrides. When overrides
/// are `None`, the stage's own configuration is used.
pub fn resolve_stage_agent_config_for(
    workflow: &WorkflowConfig,
    task: &Task,
    stage_name: &str,
    project_root: Option<&Path>,
    feedback: Option<&str>,
    integration_error: Option<IntegrationErrorContext<'_>>,
    flow_overrides: FlowOverrides<'_>,
) -> Result<ResolvedAgentConfig, AgentConfigError> {
    let stage = workflow
        .stage(stage_name)
        .ok_or_else(|| AgentConfigError::UnknownStage(stage_name.to_string()))?;

    // Script stages don't use agent config
    if stage.is_script_stage() {
        return Err(AgentConfigError::NotInActiveStage);
    }

    // Resolve prompt path: override > stage.prompt_path()
    let definition_path = flow_overrides
        .prompt
        .map(String::from)
        .or_else(|| stage.prompt_path())
        .unwrap_or_else(|| format!("{stage_name}.md"));

    let agent_def = load_agent_definition(project_root, &definition_path)
        .map_err(|e| AgentConfigError::DefinitionNotFound(e.to_string()))?;

    // Build effective stage config (with capability overrides for flows)
    let overridden_stage;
    let effective_stage = if let Some(caps) = flow_overrides.capabilities {
        overridden_stage = {
            let mut s = stage.clone();
            s.capabilities = caps.clone();
            s
        };
        &overridden_stage
    } else {
        stage
    };

    // Build prompt context
    let builder = PromptBuilder::new(workflow);
    let ctx = builder
        .build_context_with_stage(effective_stage, task, feedback, integration_error)
        .ok_or_else(|| AgentConfigError::PromptBuildError("Failed to build context".into()))?;

    let prompt = build_complete_prompt(&agent_def, &ctx);

    // Get JSON schema
    let json_schema =
        get_agent_schema(effective_stage, project_root).expect("Agent stage should have schema");

    Ok(ResolvedAgentConfig {
        prompt,
        json_schema,
        session_type: stage_name.to_string(),
    })
}

/// Build a complete prompt by combining agent definition with context.
pub fn build_complete_prompt(agent_definition: &str, ctx: &StagePromptContext<'_>) -> String {
    let mut prompt = String::new();

    // Marker for session log parser to identify initial prompts
    prompt.push_str("<!orkestra-initial>\n\n");

    // Agent definition first (system instructions)
    prompt.push_str(agent_definition);
    prompt.push_str("\n\n---\n\n");

    // Task information
    prompt.push_str("## Your Current Task\n\n");
    let _ = writeln!(prompt, "**Task ID**: {}", ctx.task_id);
    let _ = writeln!(prompt, "**Title**: {}\n", ctx.title);
    prompt.push_str("### Description\n");
    prompt.push_str(ctx.description);
    prompt.push_str("\n\n");

    // Input artifacts
    if !ctx.artifacts.is_empty() {
        prompt.push_str("## Input Artifacts\n\n");
        for artifact in &ctx.artifacts {
            let _ = write!(prompt, "### {}\n\n", artifact.name);
            prompt.push_str(artifact.content);
            prompt.push_str("\n\n");
        }
    }

    // Question history
    if !ctx.question_history.is_empty() {
        prompt.push_str("## Previous Questions and Answers\n\n");
        for qa in &ctx.question_history {
            let _ = writeln!(prompt, "**Q: {}**", qa.question);
            let _ = writeln!(prompt, "A: {}\n", qa.answer);
        }
    }

    // Feedback
    if let Some(fb) = ctx.feedback {
        prompt.push_str("## Feedback to Address\n\n");
        prompt.push_str(fb);
        prompt.push_str("\n\n");
    }

    // Integration error
    if let Some(ref err) = ctx.integration_error {
        prompt.push_str("## MERGE CONFLICT - Resolution Required\n\n");
        prompt.push_str(err.message);
        prompt.push_str("\n\n");
        if !err.conflict_files.is_empty() {
            prompt.push_str("**Conflicting files:**\n");
            for file in &err.conflict_files {
                let _ = writeln!(prompt, "- {file}");
            }
            prompt.push('\n');
        }
        prompt.push_str(
            "Run `git rebase main` and resolve the conflicts, then continue your work.\n\n",
        );
    }

    // Output format section (rendered from template with validated examples)
    prompt.push_str("---\n\n");
    prompt.push_str(&render_output_format(ctx));

    // Worktree note for subagent awareness (Claude Code subagents don't inherit cwd)
    if let Some(worktree) = ctx.worktree_path {
        prompt.push_str("\n---\n\n");
        prompt.push_str("## Important: Worktree Context\n\n");
        let _ = writeln!(prompt, "You are working in a git worktree at: `{worktree}`");
        prompt.push('\n');
        prompt.push_str(
            "If you spawn any subagents (via the Task tool), you MUST explicitly tell them \
             this worktree path. Subagents do not automatically inherit your working directory \
             and may otherwise operate on the wrong codebase.\n",
        );
    }

    prompt
}

// ============================================================================
// Resume Prompts
// ============================================================================

/// Type of resume prompt to use.
///
/// When resuming a session (via Claude Code's --resume), we send a SHORT prompt
/// since Claude already remembers the full task context. The resume type determines
/// what the short prompt should say.
#[derive(Debug, Clone)]
pub enum ResumeType {
    /// Agent was interrupted, continue from where left off.
    Continue,
    /// Human provided feedback to address.
    Feedback { feedback: String },
    /// Integration failed with merge conflict.
    Integration {
        message: String,
        conflict_files: Vec<String>,
    },
    /// Human provided answers to questions the agent asked.
    Answers { answers: Vec<ResumeQuestionAnswer> },
}

/// Owned question-answer pair for use in resume prompts.
#[derive(Debug, Clone, serde::Serialize)]
pub struct ResumeQuestionAnswer {
    pub question: String,
    pub answer: String,
}

// Builtin default templates (used when .orkestra/agents/resume/ doesn't exist)
const DEFAULT_CONTINUE_PROMPT: &str = r"<!orkestra-resume:continue>

Your previous session was interrupted. Please continue from where you left off and produce your final output as valid JSON.";

const DEFAULT_FEEDBACK_PROMPT: &str = r"<!orkestra-resume:feedback>

Your previous output needs revision. Please address this feedback:

{{feedback}}

Make the requested changes and produce your revised output as valid JSON.";

const DEFAULT_INTEGRATION_PROMPT: &str = r"<!orkestra-resume:integration>

Integration failed: {{error_message}}

{{#if conflict_files}}
Conflicting files:
{{#each conflict_files}}
- {{this}}
{{/each}}
{{/if}}

Please run `git rebase main` to resolve conflicts, then continue and output your result.";

const DEFAULT_ANSWERS_PROMPT: &str = r"<!orkestra-resume:answers>

Here are the answers to your questions:

{{#each answers}}
**Q: {{this.question}}**
A: {{this.answer}}

{{/each}}

Please continue your work with this information and produce your final output as valid JSON.";

/// Load and render a resume prompt template.
///
/// This loads the appropriate template for the resume type and renders it
/// with any required context (feedback, error details, etc.).
pub fn build_resume_prompt(
    resume_type: &ResumeType,
    project_root: Option<&Path>,
) -> Result<String, AgentConfigError> {
    let (template_name, context) = match &resume_type {
        ResumeType::Continue => ("continue.md", serde_json::json!({})),
        ResumeType::Feedback { feedback } => {
            ("feedback.md", serde_json::json!({ "feedback": feedback }))
        }
        ResumeType::Integration {
            message,
            conflict_files,
        } => (
            "integration.md",
            serde_json::json!({
                "error_message": message,
                "conflict_files": conflict_files
            }),
        ),
        ResumeType::Answers { answers } => {
            ("answers.md", serde_json::json!({ "answers": answers }))
        }
    };

    let template = load_resume_template(project_root, template_name)?;
    render_template(&template, &context)
}

/// Load a resume template from file or return builtin default.
fn load_resume_template(
    project_root: Option<&Path>,
    name: &str,
) -> Result<String, AgentConfigError> {
    // Try project .orkestra/agents/resume/ first
    if let Some(root) = project_root {
        let path = root.join(".orkestra/agents/resume").join(name);
        if path.exists() {
            let content = fs::read_to_string(&path).map_err(|e| {
                AgentConfigError::DefinitionNotFound(format!(
                    "Failed to read {}: {}",
                    path.display(),
                    e
                ))
            })?;
            // Warn if custom template missing marker
            if !content.starts_with("<!orkestra-resume:") {
                crate::orkestra_debug!("prompt", "Resume template {name} missing marker prefix");
            }
            return Ok(content);
        }
    }

    // Fall back to builtin defaults
    match name {
        "continue.md" => Ok(DEFAULT_CONTINUE_PROMPT.to_string()),
        "feedback.md" => Ok(DEFAULT_FEEDBACK_PROMPT.to_string()),
        "integration.md" => Ok(DEFAULT_INTEGRATION_PROMPT.to_string()),
        "answers.md" => Ok(DEFAULT_ANSWERS_PROMPT.to_string()),
        _ => Err(AgentConfigError::DefinitionNotFound(format!(
            "Unknown resume template: {name}"
        ))),
    }
}

/// Render a Handlebars template with the given context.
fn render_template(
    template: &str,
    context: &serde_json::Value,
) -> Result<String, AgentConfigError> {
    let reg = handlebars::Handlebars::new();
    reg.render_template(template, context)
        .map_err(|e| AgentConfigError::PromptBuildError(e.to_string()))
}

/// Determine the resume type from context.
///
/// This is used by `TaskExecutionService` to decide which resume prompt to use.
/// Priority: `integration_error` > feedback > answers > continue
pub fn determine_resume_type(
    feedback: Option<&str>,
    integration_error: Option<&IntegrationErrorContext<'_>>,
    question_history: &[crate::workflow::domain::QuestionAnswer],
) -> ResumeType {
    if let Some(err) = integration_error {
        ResumeType::Integration {
            message: err.message.to_string(),
            conflict_files: err
                .conflict_files
                .iter()
                .map(|s| (*s).to_string())
                .collect(),
        }
    } else if let Some(fb) = feedback {
        ResumeType::Feedback {
            feedback: fb.to_string(),
        }
    } else if !question_history.is_empty() {
        ResumeType::Answers {
            answers: question_history
                .iter()
                .map(|qa| ResumeQuestionAnswer {
                    question: qa.question.clone(),
                    answer: qa.answer.clone(),
                })
                .collect(),
        }
    } else {
        ResumeType::Continue
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::workflow::config::{StageCapabilities, StageConfig, WorkflowConfig};
    use crate::workflow::runtime::Artifact;

    fn test_workflow() -> WorkflowConfig {
        WorkflowConfig::new(vec![
            StageConfig::new("planning", "plan")
                .with_display_name("Planning")
                .with_capabilities(StageCapabilities::with_questions()),
            StageConfig::new("work", "summary")
                .with_display_name("Working")
                .with_inputs(vec!["plan".into()]),
            StageConfig::new("review", "verdict")
                .with_display_name("Reviewing")
                .with_inputs(vec!["plan".into(), "summary".into()])
                .with_capabilities(StageCapabilities::with_approval(Some("work".into())))
                .automated(),
        ])
    }

    #[test]
    fn test_build_context_planning() {
        let workflow = test_workflow();
        let builder = PromptBuilder::new(&workflow);

        let task = Task::new(
            "task-1",
            "Implement login",
            "Add login feature",
            "planning",
            "now",
        );

        let ctx = builder
            .build_context("planning", &task, None, None)
            .unwrap();

        assert_eq!(ctx.stage.name, "planning");
        assert_eq!(ctx.task_id, "task-1");
        assert_eq!(ctx.title, "Implement login");
        assert!(ctx.artifacts.is_empty()); // Planning has no inputs
        assert!(ctx.feedback.is_none());
    }

    #[test]
    fn test_build_context_with_artifacts() {
        let workflow = test_workflow();
        let builder = PromptBuilder::new(&workflow);

        let mut task = Task::new(
            "task-1",
            "Implement login",
            "Add login feature",
            "work",
            "now",
        );
        task.artifacts.set(Artifact::new(
            "plan",
            "Step 1: Add form\nStep 2: Add validation",
            "planning",
            "now",
        ));

        let ctx = builder.build_context("work", &task, None, None).unwrap();

        assert_eq!(ctx.stage.name, "work");
        assert_eq!(ctx.artifacts.len(), 1);
        assert_eq!(ctx.artifacts[0].name, "plan");
        assert!(ctx.artifacts[0].content.contains("Step 1"));
    }

    #[test]
    fn test_build_context_with_feedback() {
        let workflow = test_workflow();
        let builder = PromptBuilder::new(&workflow);

        let task = Task::new(
            "task-1",
            "Implement login",
            "Add login feature",
            "planning",
            "now",
        );

        let ctx = builder
            .build_context("planning", &task, Some("Add more detail"), None)
            .unwrap();

        assert_eq!(ctx.feedback, Some("Add more detail"));
    }

    #[test]
    fn test_build_context_review_stage() {
        let workflow = test_workflow();
        let builder = PromptBuilder::new(&workflow);

        let mut task = Task::new(
            "task-1",
            "Implement login",
            "Add login feature",
            "review",
            "now",
        );
        task.artifacts
            .set(Artifact::new("plan", "The plan", "planning", "t1"));
        task.artifacts
            .set(Artifact::new("summary", "Work done", "work", "t2"));

        let ctx = builder.build_context("review", &task, None, None).unwrap();

        assert_eq!(ctx.stage.name, "review");
        assert_eq!(ctx.artifacts.len(), 2);
        assert!(ctx.stage.capabilities.has_approval());
        assert_eq!(ctx.stage.capabilities.rejection_stage(), Some("work"));
    }

    #[test]
    fn test_build_context_missing_stage() {
        let workflow = test_workflow();
        let builder = PromptBuilder::new(&workflow);

        let task = Task::new("task-1", "Test", "Desc", "planning", "now");

        let ctx = builder.build_context("nonexistent", &task, None, None);
        assert!(ctx.is_none());
    }

    #[test]
    fn test_build_simple_prompt() {
        let workflow = test_workflow();
        let builder = PromptBuilder::new(&workflow);

        let mut task = Task::new(
            "task-1",
            "Implement login",
            "Add login feature",
            "work",
            "now",
        );
        task.artifacts.set(Artifact::new(
            "plan",
            "The implementation plan",
            "planning",
            "now",
        ));

        let prompt = builder.build_simple_prompt("work", &task, None).unwrap();

        assert!(prompt.contains("# Stage: Working"));
        assert!(prompt.contains("**ID:** task-1"));
        assert!(prompt.contains("Implement login"));
        assert!(prompt.contains("### plan"));
        assert!(prompt.contains("The implementation plan"));
        assert!(prompt.contains("Produce the `summary` artifact"));
    }

    #[test]
    fn test_build_simple_prompt_with_capabilities() {
        let workflow = test_workflow();
        let builder = PromptBuilder::new(&workflow);

        let task = Task::new("task-1", "Test", "Description", "planning", "now");

        let prompt = builder
            .build_simple_prompt("planning", &task, None)
            .unwrap();

        assert!(prompt.contains("ask clarifying questions"));
    }

    #[test]
    fn test_build_simple_prompt_with_approval() {
        let workflow = test_workflow();
        let builder = PromptBuilder::new(&workflow);

        let mut task = Task::new("task-1", "Test", "Description", "review", "now");
        task.artifacts
            .set(Artifact::new("plan", "plan", "planning", "now"));
        task.artifacts
            .set(Artifact::new("summary", "summary", "work", "now"));

        let prompt = builder.build_simple_prompt("review", &task, None).unwrap();

        assert!(prompt.contains("approval decision"));
    }

    #[test]
    fn test_build_simple_prompt_with_feedback() {
        let workflow = test_workflow();
        let builder = PromptBuilder::new(&workflow);

        let task = Task::new("task-1", "Test", "Description", "planning", "now");

        let prompt = builder
            .build_simple_prompt("planning", &task, Some("Please add more detail"))
            .unwrap();

        assert!(prompt.contains("## Feedback to Address"));
        assert!(prompt.contains("Please add more detail"));
    }

    #[test]
    fn test_context_question_history_is_empty() {
        // Question history is now passed via resume prompts (IterationTrigger::Answers),
        // not in the initial prompt context. So question_history is always empty.
        let workflow = test_workflow();
        let builder = PromptBuilder::new(&workflow);

        let task = Task::new("task-1", "Test", "Description", "planning", "now");
        let ctx = builder
            .build_context("planning", &task, None, None)
            .unwrap();

        assert!(ctx.question_history.is_empty());
    }

    // ========================================================================
    // Agent Configuration Resolution tests
    // ========================================================================

    #[test]
    fn test_get_agent_schema_generates_dynamically() {
        // Planning stage with questions capability
        let planning = StageConfig::new("planning", "plan")
            .with_capabilities(StageCapabilities::with_questions());
        let schema = get_agent_schema(&planning, None).unwrap();
        // Should contain the artifact name in the type enum
        assert!(schema.contains("\"plan\""));
        // Should have questions capability
        assert!(schema.contains("\"questions\""));

        // Work stage without questions
        let work = StageConfig::new("work", "summary");
        let schema = get_agent_schema(&work, None).unwrap();
        assert!(schema.contains("\"summary\""));
        // Should NOT have questions (no capability)
        assert!(!schema.contains("\"questions\""));

        // Review stage with approval capability
        let review = StageConfig::new("review", "verdict")
            .with_capabilities(StageCapabilities::with_approval(Some("work".into())));
        let schema = get_agent_schema(&review, None).unwrap();
        assert!(schema.contains("\"approval\"")); // approval type
        assert!(!schema.contains("\"verdict\"")); // artifact name excluded
    }

    #[test]
    fn test_get_agent_schema_returns_none_for_script_stage() {
        let script_stage = StageConfig::new_script("checks", "check_results", "./run.sh");
        assert!(get_agent_schema(&script_stage, None).is_none());
    }

    #[test]
    fn test_build_complete_prompt() {
        let workflow = test_workflow();
        let builder = PromptBuilder::new(&workflow);

        let mut task = Task::new(
            "task-1",
            "Implement login",
            "Add login feature",
            "work",
            "now",
        );
        task.artifacts.set(Artifact::new(
            "plan",
            "The implementation plan",
            "planning",
            "now",
        ));

        let ctx = builder.build_context("work", &task, None, None).unwrap();
        let agent_def = "You are a worker agent. Implement the plan.";
        let prompt = build_complete_prompt(agent_def, &ctx);

        // Should contain initial prompt marker
        assert!(prompt.starts_with("<!orkestra-initial>"));

        // Should contain agent definition
        assert!(prompt.contains("You are a worker agent"));

        // Should contain task info
        assert!(prompt.contains("Task ID"));
        assert!(prompt.contains("task-1"));
        assert!(prompt.contains("Implement login"));

        // Should contain artifacts
        assert!(prompt.contains("Input Artifacts"));
        assert!(prompt.contains("The implementation plan"));

        // Should contain output format
        assert!(prompt.contains("Output Format"));
        assert!(prompt.contains("summary")); // The stage artifact
    }

    #[test]
    fn test_build_complete_prompt_with_feedback() {
        let workflow = test_workflow();
        let builder = PromptBuilder::new(&workflow);

        let task = Task::new("task-1", "Test", "Description", "planning", "now");
        let ctx = builder
            .build_context("planning", &task, Some("Add more detail"), None)
            .unwrap();

        let agent_def = "Planner agent";
        let prompt = build_complete_prompt(agent_def, &ctx);

        assert!(prompt.contains("Feedback to Address"));
        assert!(prompt.contains("Add more detail"));
    }

    #[test]
    fn test_build_complete_prompt_with_integration_error() {
        let workflow = test_workflow();
        let builder = PromptBuilder::new(&workflow);

        let mut task = Task::new("task-1", "Test", "Description", "work", "now");
        task.artifacts
            .set(Artifact::new("plan", "Plan", "planning", "now"));

        let error = IntegrationErrorContext {
            message: "Merge conflict in src/main.rs",
            conflict_files: vec!["src/main.rs", "src/lib.rs"],
        };

        let ctx = builder
            .build_context("work", &task, None, Some(error))
            .unwrap();

        let agent_def = "Worker agent";
        let prompt = build_complete_prompt(agent_def, &ctx);

        assert!(prompt.contains("MERGE CONFLICT"));
        assert!(prompt.contains("Merge conflict in src/main.rs"));
        assert!(prompt.contains("src/main.rs"));
        assert!(prompt.contains("src/lib.rs"));
    }

    #[test]
    fn test_build_complete_prompt_with_questions_capability() {
        let workflow = test_workflow();
        let builder = PromptBuilder::new(&workflow);

        let task = Task::new("task-1", "Test", "Description", "planning", "now");
        let ctx = builder
            .build_context("planning", &task, None, None)
            .unwrap();

        let agent_def = "Planner agent";
        let prompt = build_complete_prompt(agent_def, &ctx);

        // Planning stage has ask_questions capability
        assert!(prompt.contains("Ask clarifying questions"));
        assert!(prompt.contains("questions"));
    }

    #[test]
    fn test_build_complete_prompt_with_approval_capability() {
        let workflow = test_workflow();
        let builder = PromptBuilder::new(&workflow);

        let mut task = Task::new("task-1", "Test", "Description", "review", "now");
        task.artifacts
            .set(Artifact::new("plan", "Plan", "planning", "now"));
        task.artifacts
            .set(Artifact::new("summary", "Summary", "work", "now"));

        let ctx = builder.build_context("review", &task, None, None).unwrap();

        let agent_def = "Reviewer agent";
        let prompt = build_complete_prompt(agent_def, &ctx);

        // Review stage has approval capability
        assert!(prompt.contains("Approve or reject"));
        assert!(prompt.contains("approval"));
    }

    #[test]
    fn test_build_complete_prompt_with_worktree() {
        let workflow = test_workflow();
        let builder = PromptBuilder::new(&workflow);

        let task = Task::new("task-1", "Test", "Description", "planning", "now")
            .with_worktree("/path/to/worktree/task-1");

        let ctx = builder
            .build_context("planning", &task, None, None)
            .unwrap();

        let agent_def = "Planner agent";
        let prompt = build_complete_prompt(agent_def, &ctx);

        // Should contain worktree note
        assert!(prompt.contains("Worktree Context"));
        assert!(prompt.contains("/path/to/worktree/task-1"));
        assert!(prompt.contains("subagents"));
    }

    #[test]
    fn test_build_complete_prompt_without_worktree() {
        let workflow = test_workflow();
        let builder = PromptBuilder::new(&workflow);

        let task = Task::new("task-1", "Test", "Description", "planning", "now");
        // No worktree set

        let ctx = builder
            .build_context("planning", &task, None, None)
            .unwrap();

        let agent_def = "Planner agent";
        let prompt = build_complete_prompt(agent_def, &ctx);

        // Should NOT contain worktree note
        assert!(!prompt.contains("Worktree Context"));
    }

    #[test]
    fn test_agent_config_error_display() {
        let err = AgentConfigError::NotInActiveStage;
        assert_eq!(err.to_string(), "Task is not in an active stage");

        let err = AgentConfigError::UnknownStage("foo".into());
        assert_eq!(err.to_string(), "Unknown stage: foo");

        let err = AgentConfigError::DefinitionNotFound("missing.md".into());
        assert!(err.to_string().contains("missing.md"));
    }

    // ========================================================================
    // Resume Prompt tests
    // ========================================================================

    #[test]
    fn test_build_resume_prompt_continue() {
        let prompt = build_resume_prompt(&ResumeType::Continue, None).unwrap();
        assert!(prompt.starts_with("<!orkestra-resume:continue>"));
        assert!(prompt.contains("interrupted"));
        assert!(prompt.contains("JSON"));
    }

    #[test]
    fn test_build_resume_prompt_feedback() {
        let prompt = build_resume_prompt(
            &ResumeType::Feedback {
                feedback: "Add more error handling".to_string(),
            },
            None,
        )
        .unwrap();
        assert!(prompt.starts_with("<!orkestra-resume:feedback>"));
        assert!(prompt.contains("Add more error handling"));
        assert!(prompt.contains("revision"));
    }

    #[test]
    fn test_build_resume_prompt_integration() {
        let prompt = build_resume_prompt(
            &ResumeType::Integration {
                message: "Merge conflict detected".to_string(),
                conflict_files: vec!["src/main.rs".to_string(), "src/lib.rs".to_string()],
            },
            None,
        )
        .unwrap();
        assert!(prompt.starts_with("<!orkestra-resume:integration>"));
        assert!(prompt.contains("Merge conflict detected"));
        assert!(prompt.contains("src/main.rs"));
        assert!(prompt.contains("src/lib.rs"));
        assert!(prompt.contains("git rebase main"));
    }

    #[test]
    fn test_build_resume_prompt_answers() {
        let prompt = build_resume_prompt(
            &ResumeType::Answers {
                answers: vec![
                    ResumeQuestionAnswer {
                        question: "Which database?".to_string(),
                        answer: "PostgreSQL".to_string(),
                    },
                    ResumeQuestionAnswer {
                        question: "Add caching?".to_string(),
                        answer: "Yes, use Redis".to_string(),
                    },
                ],
            },
            None,
        )
        .unwrap();
        assert!(prompt.starts_with("<!orkestra-resume:answers>"));
        assert!(prompt.contains("Which database?"));
        assert!(prompt.contains("PostgreSQL"));
        assert!(prompt.contains("Add caching?"));
        assert!(prompt.contains("Yes, use Redis"));
    }

    #[test]
    fn test_determine_resume_type_integration_takes_priority() {
        use crate::workflow::domain::QuestionAnswer;
        let error = IntegrationErrorContext {
            message: "conflict",
            conflict_files: vec!["file.rs"],
        };
        let answers = vec![QuestionAnswer::new("What?", "Something", "now")];
        let result = determine_resume_type(Some("feedback"), Some(&error), &answers);
        // Integration error takes priority over everything
        assert!(matches!(result, ResumeType::Integration { .. }));
    }

    #[test]
    fn test_determine_resume_type_feedback_over_answers() {
        use crate::workflow::domain::QuestionAnswer;
        let answers = vec![QuestionAnswer::new("What?", "Something", "now")];
        let result = determine_resume_type(Some("please fix"), None, &answers);
        // Feedback takes priority over answers
        match result {
            ResumeType::Feedback { feedback } => assert_eq!(feedback, "please fix"),
            _ => panic!("Expected Feedback variant"),
        }
    }

    #[test]
    fn test_determine_resume_type_answers() {
        use crate::workflow::domain::QuestionAnswer;
        let answers = vec![
            QuestionAnswer::new("Which DB?", "PostgreSQL", "now"),
            QuestionAnswer::new("Add cache?", "Yes", "now"),
        ];
        let result = determine_resume_type(None, None, &answers);
        match result {
            ResumeType::Answers { answers } => {
                assert_eq!(answers.len(), 2);
                assert_eq!(answers[0].question, "Which DB?");
                assert_eq!(answers[0].answer, "PostgreSQL");
            }
            _ => panic!("Expected Answers variant"),
        }
    }

    #[test]
    fn test_determine_resume_type_continue() {
        let result = determine_resume_type(None, None, &[]);
        assert!(matches!(result, ResumeType::Continue));
    }
}
