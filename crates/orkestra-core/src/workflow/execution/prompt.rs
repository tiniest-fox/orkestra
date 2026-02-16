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
use crate::workflow::runtime::{Phase, Status};

// =============================================================================
// Workflow Stage Entry (for prompt rendering)
// =============================================================================

/// A stage entry for the workflow overview in agent prompts.
/// Contains the stage name, description, and whether it's the current stage.
#[derive(Debug, Clone, Serialize)]
pub struct WorkflowStageEntry {
    /// Stage name (e.g., "plan", "work").
    pub name: String,
    /// Human-readable description of what this stage does.
    pub description: String,
    /// Whether this is the current stage being executed.
    pub is_current: bool,
}

/// Build workflow stage entries for the prompt overview.
///
/// Returns a list of all stages in the given flow (or default flow if None),
/// with their names, descriptions, and a flag indicating the current stage.
pub fn build_workflow_stage_entries(
    workflow: &WorkflowConfig,
    current_stage: &str,
    flow: Option<&str>,
) -> Vec<WorkflowStageEntry> {
    workflow
        .stages_in_flow(flow)
        .into_iter()
        .map(|stage| WorkflowStageEntry {
            name: stage.name.clone(),
            description: stage.description.clone().unwrap_or_else(|| stage.display()),
            is_current: stage.name == current_stage,
        })
        .collect()
}

// =============================================================================
// Template Loading
// =============================================================================

const OUTPUT_FORMAT_TEMPLATE: &str = include_str!("../../prompts/templates/output_format.md");
const INITIAL_PROMPT_TEMPLATE: &str = include_str!("../../prompts/templates/initial_prompt.md");
const SYSTEM_PROMPT_TEMPLATE: &str = include_str!("../../prompts/templates/system_prompt.md");

static TEMPLATES: LazyLock<Handlebars<'static>> = LazyLock::new(|| {
    let mut hb = Handlebars::new();
    hb.register_escape_fn(handlebars::no_escape);
    hb.register_template_string("output_format", OUTPUT_FORMAT_TEMPLATE)
        .expect("output_format template should be valid");
    hb.register_template_string("initial_prompt", INITIAL_PROMPT_TEMPLATE)
        .expect("initial_prompt template should be valid");
    hb.register_template_string("system_prompt", SYSTEM_PROMPT_TEMPLATE)
        .expect("system_prompt template should be valid");
    hb
});

/// Context for rendering the output format template.
#[derive(Debug, Serialize)]
#[allow(clippy::struct_excessive_bools)]
struct OutputFormatContext {
    artifact_name: String,
    can_ask_questions: bool,
    questions_example: Option<String>,
    can_produce_subtasks: bool,
    subtasks_example: Option<String>,
    skip_example: Option<String>,
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

    let (subtasks_example, skip_example) = if ctx.stage.capabilities.produces_subtasks() {
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
        show_direct_structured_output_hint: ctx.show_direct_structured_output_hint,
    }
}

/// Render the output format section using the template.
fn render_output_format(ctx: &StagePromptContext<'_>) -> String {
    let format_ctx = build_output_format_context(ctx);
    TEMPLATES
        .render("output_format", &format_ctx)
        .expect("output_format template should render")
}

/// Build the system prompt from agent definition and output format.
///
/// This renders the `system_prompt.md` template with agent definition and output format.
/// The system prompt contains instructions that survive session compaction.
pub fn build_system_prompt(agent_definition: &str, output_format: &str) -> String {
    #[derive(Serialize)]
    struct SystemPromptContext<'a> {
        agent_definition: &'a str,
        output_format: &'a str,
    }

    let ctx = SystemPromptContext {
        agent_definition,
        output_format,
    };

    TEMPLATES
        .render("system_prompt", &ctx)
        .expect("system_prompt template should render")
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

    /// Base branch this task was created from.
    pub base_branch: &'a str,

    /// Git commit SHA of the base branch at worktree creation time.
    pub base_commit: &'a str,

    /// Whether to show instructions for direct `StructuredOutput` usage (Claude Code specific).
    pub show_direct_structured_output_hint: bool,

    /// Activity logs from prior completed iterations.
    pub activity_logs: Vec<ActivityLogEntry>,

    /// Workflow stage entries for the overview section.
    pub workflow_stages: Vec<WorkflowStageEntry>,

    /// Sibling subtasks (for subtasks only, empty for non-subtasks).
    pub sibling_tasks: Vec<SiblingTaskContext>,
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
    /// Base branch to rebase onto.
    pub base_branch: &'a str,
}

/// Context for an activity log entry from a prior iteration.
#[derive(Debug, Clone, Serialize)]
pub struct ActivityLogEntry {
    /// Stage that produced this log (e.g., "planning", "work").
    pub stage: String,
    /// Iteration number within the stage.
    pub iteration_number: u32,
    /// The activity log content.
    pub content: String,
}

/// Context for a sibling subtask in the prompt.
#[derive(Debug, Clone, Serialize)]
pub struct SiblingTaskContext {
    /// Short display ID (e.g., "bird").
    pub short_id: String,
    /// Subtask title.
    pub title: String,
    /// Brief description (from breakdown, not `detailed_instructions`).
    pub description: String,
    /// Dependency relationship to current task: "depends on this task", "this task depends on", or None.
    pub dependency_relationship: Option<String>,
    /// User-friendly status display ("pending", "working", "done", etc.).
    pub status_display: String,
}

/// Convert Status and Phase to a user-friendly display string for sibling context.
pub fn sibling_status_display(status: &Status, phase: Phase) -> &'static str {
    match status {
        Status::Done | Status::Archived => "done",
        Status::Failed { .. } => "failed",
        Status::Blocked { .. } => "blocked",
        Status::WaitingOnChildren { .. } => "waiting",
        Status::Active { .. } => match phase {
            Phase::AgentWorking => "working",
            Phase::AwaitingReview => "reviewing",
            _ => "pending",
        },
    }
}

/// Consolidate activity logs, collapsing only consecutive same-stage entries.
///
/// Uses "intervening stage prevents deduplication" semantics: consecutive entries from
/// the same stage are collapsed (last wins), but if a different stage appears in between,
/// both entries are preserved.
///
/// Example: `work(A) → review(C) → work(B)` produces 3 entries (A, C, B) because
/// review intervened. But `work(A) → work(B)` produces 1 entry (B) because they're
/// consecutive.
///
/// **Important**: Callers must provide logs in chronological order (by `started_at`).
///
/// Empty or whitespace-only logs are filtered out.
pub fn deduplicate_activity_logs_by_stage(logs: Vec<ActivityLogEntry>) -> Vec<ActivityLogEntry> {
    let mut result: Vec<ActivityLogEntry> = Vec::new();

    for log in logs {
        // Skip empty/whitespace-only logs
        if log.content.trim().is_empty() {
            continue;
        }

        // Only collapse if the immediately previous entry was from the same stage
        if result.last().is_some_and(|prev| prev.stage == log.stage) {
            // Consecutive same-stage: replace previous entry
            *result.last_mut().unwrap() = log;
        } else {
            // Different stage (or first entry): keep both
            result.push(log);
        }
    }

    result
}

/// Flow-specific overrides for agent configuration.
///
/// When a task uses a named flow, the flow may override the prompt path,
/// capabilities, and/or inputs for specific stages.
#[derive(Debug, Default, Clone)]
pub struct FlowOverrides<'a> {
    /// Override the prompt template path.
    pub prompt: Option<&'a str>,
    /// Override the stage capabilities.
    pub capabilities: Option<&'a crate::workflow::config::StageCapabilities>,
    /// Override the stage inputs.
    pub inputs: Option<Vec<String>>,
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

        let workflow_stages =
            build_workflow_stage_entries(self.workflow, stage_name, task.flow.as_deref());

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
            base_branch: task.base_branch.as_str(),
            base_commit: task.base_commit.as_str(),
            show_direct_structured_output_hint,
            activity_logs,
            workflow_stages,
            sibling_tasks,
        })
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

        let workflow_stages =
            build_workflow_stage_entries(self.workflow, &stage.name, task.flow.as_deref());

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
            base_branch: task.base_branch.as_str(),
            base_commit: task.base_commit.as_str(),
            show_direct_structured_output_hint,
            activity_logs,
            workflow_stages,
            sibling_tasks,
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
        let ctx = self.build_context(
            stage_name,
            task,
            feedback,
            None,
            false,
            Vec::new(),
            Vec::new(),
        )?;

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
    /// The system prompt (agent definition + output format).
    pub system_prompt: String,
    /// The user message prompt (task context).
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
        false,      // Default to false for backward compatibility
        Vec::new(), // activity_logs - convenience wrapper doesn't use them
        Vec::new(), // sibling_tasks - convenience wrapper doesn't use them
    )
}

/// Resolve agent configuration for a specific stage with optional overrides.
///
/// Allows flow-specific prompt and capability overrides. When overrides
/// are `None`, the stage's own configuration is used.
#[allow(clippy::too_many_arguments)]
pub fn resolve_stage_agent_config_for(
    workflow: &WorkflowConfig,
    task: &Task,
    stage_name: &str,
    project_root: Option<&Path>,
    feedback: Option<&str>,
    integration_error: Option<IntegrationErrorContext<'_>>,
    flow_overrides: FlowOverrides<'_>,
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

    // Resolve prompt path: override > stage.prompt_path()
    let definition_path = flow_overrides
        .prompt
        .map(String::from)
        .or_else(|| stage.prompt_path())
        .unwrap_or_else(|| format!("{stage_name}.md"));

    let agent_def = load_agent_definition(project_root, &definition_path)
        .map_err(|e| AgentConfigError::DefinitionNotFound(e.to_string()))?;

    // Build effective stage config (with capability/input overrides for flows)
    let overridden_stage;
    let effective_stage =
        if flow_overrides.capabilities.is_some() || flow_overrides.inputs.is_some() {
            overridden_stage = {
                let mut s = stage.clone();
                if let Some(caps) = flow_overrides.capabilities {
                    s.capabilities = caps.clone();
                }
                if let Some(inputs) = flow_overrides.inputs {
                    s.inputs = inputs;
                }
                s
            };
            &overridden_stage
        } else {
            stage
        };

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

    // Render agent definition (may contain Handlebars templates)
    let rendered_definition = render_agent_definition(&agent_def, &ctx);

    // Render output format
    let output_format = render_output_format(&ctx);

    // Build system prompt (agent definition + output format)
    let system_prompt = build_system_prompt(&rendered_definition, &output_format);

    // Build user message (task context only - no agent def or output format)
    let user_message = build_user_message(&ctx);

    // Get JSON schema
    let json_schema = get_agent_schema(effective_stage, project_root).ok_or_else(|| {
        AgentConfigError::PromptBuildError(format!("No schema for agent stage '{stage_name}'"))
    })?;

    Ok(ResolvedAgentConfig {
        system_prompt,
        prompt: user_message,
        json_schema,
        session_type: stage_name.to_string(),
    })
}

/// Context for rendering the user message template (`initial_prompt.md`).
#[derive(Debug, Serialize)]
struct UserMessageContext<'a> {
    stage_name: &'a str,
    task_id: &'a str,
    title: &'a str,
    description: &'a str,
    artifacts: &'a [ArtifactContext<'a>],
    question_history: &'a [QuestionAnswerContext<'a>],
    feedback: Option<&'a str>,
    integration_error: Option<&'a IntegrationErrorContext<'a>>,
    worktree_path: Option<&'a str>,
    base_branch: &'a str,
    base_commit: &'a str,
    activity_logs: &'a [ActivityLogEntry],
    workflow_stages: &'a [WorkflowStageEntry],
    sibling_tasks: &'a [SiblingTaskContext],
}

/// Context available to agent definition Handlebars templates.
#[derive(Debug, Serialize)]
struct AgentDefinitionContext<'a> {
    stage_name: &'a str,
    task_id: &'a str,
    feedback: Option<&'a str>,
    has_artifacts: bool,
    artifact_names: Vec<&'a str>,
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
        has_artifacts: !ctx.artifacts.is_empty(),
        artifact_names: ctx.artifacts.iter().map(|a| a.name).collect(),
    };

    let mut hb = Handlebars::new();
    hb.register_escape_fn(handlebars::no_escape);
    hb.render_template(template, &def_ctx).unwrap_or_else(|e| {
        eprintln!("Warning: agent definition template error: {e}");
        template.to_string()
    })
}

/// Build a user message from task context.
///
/// This renders the `initial_prompt.md` template with only task context
/// (no agent definition or output format - those go in the system prompt).
pub fn build_user_message(ctx: &StagePromptContext<'_>) -> String {
    let template_ctx = UserMessageContext {
        stage_name: &ctx.stage.name,
        task_id: ctx.task_id,
        title: ctx.title,
        description: ctx.description,
        artifacts: &ctx.artifacts,
        question_history: &ctx.question_history,
        feedback: ctx.feedback,
        integration_error: ctx.integration_error.as_ref(),
        worktree_path: ctx.worktree_path,
        base_branch: ctx.base_branch,
        base_commit: ctx.base_commit,
        activity_logs: &ctx.activity_logs,
        workflow_stages: &ctx.workflow_stages,
        sibling_tasks: &ctx.sibling_tasks,
    };

    TEMPLATES
        .render("initial_prompt", &template_ctx)
        .expect("initial_prompt template should render")
}

/// Build a complete prompt by combining agent definition with context.
///
/// DEPRECATED: This function is kept for backward compatibility with existing tests.
/// New code should use `build_system_prompt()` and `build_user_message()` separately.
pub fn build_complete_prompt(agent_definition: &str, ctx: &StagePromptContext<'_>) -> String {
    let rendered_definition = render_agent_definition(agent_definition, ctx);
    let output_format = render_output_format(ctx);
    let system_prompt = build_system_prompt(&rendered_definition, &output_format);
    let user_message = build_user_message(ctx);

    // Combine them in the old format for backward compatibility
    format!("{system_prompt}\n\n{user_message}")
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
    /// Stage is being re-run after the full cycle completed (untriggered re-entry).
    Recheck,
    /// Human retried a failed task, optionally with instructions.
    RetryFailed { instructions: Option<String> },
    /// Human retried a blocked task, optionally with instructions.
    RetryBlocked { instructions: Option<String> },
    /// User interrupted and resumed with optional guidance.
    ManualResume { message: Option<String> },
    /// User selected PR comments to address.
    PrComments {
        comments: Vec<PrComment>,
        guidance: Option<String>,
    },
}

/// A PR comment to address in the resume prompt.
#[derive(Debug, Clone, serde::Serialize)]
pub struct PrComment {
    /// The author of the comment.
    pub author: String,
    /// The file path the comment is on (empty for PR-level comments).
    pub path: String,
    /// The line number (if a line comment).
    pub line: Option<u32>,
    /// The comment body text.
    pub body: String,
}

/// Owned question-answer pair for use in resume prompts.
#[derive(Debug, Clone, serde::Serialize)]
pub struct ResumeQuestionAnswer {
    pub question: String,
    pub answer: String,
}

// Resume prompt templates (compiled in from prompts/templates/resume/)
const RESUME_CONTINUE: &str = include_str!("../../prompts/templates/resume/continue.md");
const RESUME_FEEDBACK: &str = include_str!("../../prompts/templates/resume/feedback.md");
const RESUME_INTEGRATION: &str = include_str!("../../prompts/templates/resume/integration.md");
const RESUME_ANSWERS: &str = include_str!("../../prompts/templates/resume/answers.md");
const RESUME_RECHECK: &str = include_str!("../../prompts/templates/resume/recheck.md");
const RESUME_RETRY_FAILED: &str = include_str!("../../prompts/templates/resume/retry_failed.md");
const RESUME_RETRY_BLOCKED: &str = include_str!("../../prompts/templates/resume/retry_blocked.md");
const RESUME_MANUAL_RESUME: &str = include_str!("../../prompts/templates/resume/manual_resume.md");
const RESUME_PR_COMMENTS: &str = include_str!("../../prompts/templates/resume/pr_comments.md");

/// Load and render a resume prompt template.
///
/// This loads the appropriate template for the resume type and renders it
/// with any required context (feedback, error details, etc.).
pub fn build_resume_prompt(
    stage: &str,
    resume_type: &ResumeType,
    base_branch: &str,
    artifacts: &[(String, String)],
    activity_logs: &[ActivityLogEntry],
) -> Result<String, AgentConfigError> {
    let (template, mut context) = match &resume_type {
        ResumeType::Continue => (RESUME_CONTINUE, serde_json::json!({})),
        ResumeType::Feedback { feedback } => {
            (RESUME_FEEDBACK, serde_json::json!({ "feedback": feedback }))
        }
        ResumeType::Integration {
            message,
            conflict_files,
        } => (
            RESUME_INTEGRATION,
            serde_json::json!({
                "error_message": message,
                "conflict_files": conflict_files,
                "base_branch": base_branch,
            }),
        ),
        ResumeType::Answers { answers } => {
            (RESUME_ANSWERS, serde_json::json!({ "answers": answers }))
        }
        ResumeType::Recheck => (RESUME_RECHECK, serde_json::json!({})),
        ResumeType::RetryFailed { instructions } => (
            RESUME_RETRY_FAILED,
            serde_json::json!({ "instructions": instructions }),
        ),
        ResumeType::RetryBlocked { instructions } => (
            RESUME_RETRY_BLOCKED,
            serde_json::json!({ "instructions": instructions }),
        ),
        ResumeType::ManualResume { message } => (
            RESUME_MANUAL_RESUME,
            serde_json::json!({ "message": message }),
        ),
        ResumeType::PrComments { comments, guidance } => (
            RESUME_PR_COMMENTS,
            serde_json::json!({ "comments": comments, "guidance": guidance }),
        ),
    };

    // All resume templates need the stage name for the marker
    context["stage_name"] = serde_json::json!(stage);

    // Inject artifacts if present
    if !artifacts.is_empty() {
        let artifact_values: Vec<serde_json::Value> = artifacts
            .iter()
            .map(|(name, content)| serde_json::json!({"name": name, "content": content}))
            .collect();
        context["artifacts"] = serde_json::json!(artifact_values);
    }

    // Inject activity logs for Recheck resume type
    if matches!(resume_type, ResumeType::Recheck) && !activity_logs.is_empty() {
        context["activity_logs"] = serde_json::json!(activity_logs);
    }

    render_template(template, &context)
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
    use crate::workflow::config::{
        FlowConfig, FlowStageEntry, StageCapabilities, StageConfig, WorkflowConfig,
    };
    use crate::workflow::runtime::Artifact;
    use indexmap::IndexMap;

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
            .build_context("planning", &task, None, None, false, Vec::new(), Vec::new())
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

        let ctx = builder
            .build_context("work", &task, None, None, false, Vec::new(), Vec::new())
            .unwrap();

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
            .build_context(
                "planning",
                &task,
                Some("Add more detail"),
                None,
                false,
                Vec::new(),
                Vec::new(),
            )
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

        let ctx = builder
            .build_context("review", &task, None, None, false, Vec::new(), Vec::new())
            .unwrap();

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

        let ctx = builder.build_context(
            "nonexistent",
            &task,
            None,
            None,
            false,
            Vec::new(),
            Vec::new(),
        );
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
            .build_context("planning", &task, None, None, false, Vec::new(), Vec::new())
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

        let ctx = builder
            .build_context("work", &task, None, None, false, Vec::new(), Vec::new())
            .unwrap();
        let agent_def = "You are a worker agent. Implement the plan.";
        let prompt = build_complete_prompt(agent_def, &ctx);

        // Combined prompt (for backward compat) contains both system and user sections
        // System prompt section:
        assert!(prompt.contains("You are a worker agent"));
        assert!(prompt.contains("Output Format"));
        assert!(prompt.contains("summary")); // The stage artifact

        // User message section:
        assert!(prompt.contains("<!orkestra:spawn:work>"));
        assert!(prompt.contains("Task ID"));
        assert!(prompt.contains("task-1"));
        assert!(prompt.contains("Implement login"));
        assert!(prompt.contains("Input Artifacts"));
        assert!(prompt.contains("The implementation plan"));
    }

    #[test]
    fn test_build_complete_prompt_with_feedback() {
        let workflow = test_workflow();
        let builder = PromptBuilder::new(&workflow);

        let task = Task::new("task-1", "Test", "Description", "planning", "now");
        let ctx = builder
            .build_context(
                "planning",
                &task,
                Some("Add more detail"),
                None,
                false,
                Vec::new(),
                Vec::new(),
            )
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
            base_branch: "feature/parent-branch",
        };

        let ctx = builder
            .build_context(
                "work",
                &task,
                None,
                Some(error),
                false,
                Vec::new(),
                Vec::new(),
            )
            .unwrap();

        let agent_def = "Worker agent";
        let prompt = build_complete_prompt(agent_def, &ctx);

        assert!(prompt.contains("MERGE CONFLICT"));
        assert!(prompt.contains("Merge conflict in src/main.rs"));
        assert!(prompt.contains("src/main.rs"));
        assert!(prompt.contains("src/lib.rs"));
        assert!(prompt.contains("git rebase feature/parent-branch"));
    }

    #[test]
    fn test_build_complete_prompt_with_questions_capability() {
        let workflow = test_workflow();
        let builder = PromptBuilder::new(&workflow);

        let task = Task::new("task-1", "Test", "Description", "planning", "now");
        let ctx = builder
            .build_context("planning", &task, None, None, false, Vec::new(), Vec::new())
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

        let ctx = builder
            .build_context("review", &task, None, None, false, Vec::new(), Vec::new())
            .unwrap();

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
            .with_worktree("/path/to/worktree/task-1")
            .with_base_branch("main")
            .with_base_commit("abc123def456");

        let ctx = builder
            .build_context("planning", &task, None, None, false, Vec::new(), Vec::new())
            .unwrap();

        let agent_def = "Planner agent";
        let prompt = build_complete_prompt(agent_def, &ctx);

        // Should contain worktree note with base branch
        assert!(prompt.contains("Worktree Context"));
        assert!(prompt.contains("/path/to/worktree/task-1"));
        assert!(prompt.contains("branched from `main`"));
        assert!(prompt.contains("git diff --merge-base main"));
        assert!(prompt.contains("subagents"));
    }

    #[test]
    fn test_build_complete_prompt_without_worktree() {
        let workflow = test_workflow();
        let builder = PromptBuilder::new(&workflow);

        let task = Task::new("task-1", "Test", "Description", "planning", "now");
        // No worktree set

        let ctx = builder
            .build_context("planning", &task, None, None, false, Vec::new(), Vec::new())
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
        let artifacts = vec![(
            "plan".to_string(),
            "The implementation plan content".to_string(),
        )];
        let prompt =
            build_resume_prompt("work", &ResumeType::Continue, "main", &artifacts, &[]).unwrap();
        assert!(prompt.starts_with("<!orkestra:resume:work:continue>"));
        assert!(prompt.contains("interrupted"));
        assert!(prompt.contains("JSON"));
        assert!(!prompt.contains("Updated Input Artifacts"));
    }

    #[test]
    fn test_build_resume_prompt_feedback() {
        let artifacts = vec![("summary".to_string(), "Work completion summary".to_string())];
        let prompt = build_resume_prompt(
            "review",
            &ResumeType::Feedback {
                feedback: "Add more error handling".to_string(),
            },
            "main",
            &artifacts,
            &[],
        )
        .unwrap();
        assert!(prompt.starts_with("<!orkestra:resume:review:feedback>"));
        assert!(prompt.contains("Add more error handling"));
        assert!(prompt.contains("revision"));
        assert!(!prompt.contains("Updated Input Artifacts"));
    }

    #[test]
    fn test_build_resume_prompt_integration() {
        let artifacts = vec![(
            "breakdown".to_string(),
            "Task breakdown details".to_string(),
        )];
        let prompt = build_resume_prompt(
            "work",
            &ResumeType::Integration {
                message: "Merge conflict detected".to_string(),
                conflict_files: vec!["src/main.rs".to_string(), "src/lib.rs".to_string()],
            },
            "feature/parent-branch",
            &artifacts,
            &[],
        )
        .unwrap();
        assert!(prompt.starts_with("<!orkestra:resume:work:integration>"));
        assert!(prompt.contains("Merge conflict detected"));
        assert!(prompt.contains("src/main.rs"));
        assert!(prompt.contains("src/lib.rs"));
        assert!(prompt.contains("git rebase feature/parent-branch"));
        assert!(!prompt.contains("Updated Input Artifacts"));
    }

    #[test]
    fn test_build_resume_prompt_answers() {
        let artifacts = vec![(
            "requirements".to_string(),
            "User requirements specification".to_string(),
        )];
        let prompt = build_resume_prompt(
            "planning",
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
            "main",
            &artifacts,
            &[],
        )
        .unwrap();
        assert!(prompt.starts_with("<!orkestra:resume:planning:answers>"));
        assert!(prompt.contains("Which database?"));
        assert!(prompt.contains("PostgreSQL"));
        assert!(prompt.contains("Add caching?"));
        assert!(prompt.contains("Yes, use Redis"));
        assert!(!prompt.contains("Updated Input Artifacts"));
    }

    #[test]
    fn test_build_resume_prompt_recheck() {
        let artifacts = vec![
            ("summary".to_string(), "Updated work summary".to_string()),
            (
                "check_results".to_string(),
                "Check results output".to_string(),
            ),
        ];
        let prompt =
            build_resume_prompt("review", &ResumeType::Recheck, "main", &artifacts, &[]).unwrap();
        assert!(prompt.starts_with("<!orkestra:resume:review:recheck>"));
        assert!(prompt.contains("re-run"));
        assert!(prompt.contains("re-examine"));
        assert!(prompt.contains("JSON"));
        assert!(prompt.contains("Updated Input Artifacts"));
        assert!(prompt.contains("### summary"));
        assert!(prompt.contains("Updated work summary"));
        assert!(prompt.contains("### check_results"));
        assert!(prompt.contains("Check results output"));
    }

    #[test]
    fn test_build_resume_prompt_recheck_with_activity_logs() {
        let artifacts = vec![("summary".to_string(), "Updated work summary".to_string())];
        let activity_logs = vec![
            ActivityLogEntry {
                stage: "work".to_string(),
                iteration_number: 1,
                content: "- Implemented the feature\n- Added tests".to_string(),
            },
            ActivityLogEntry {
                stage: "review".to_string(),
                iteration_number: 1,
                content: "- Found issue with error handling\n- Requested changes".to_string(),
            },
        ];
        let prompt = build_resume_prompt(
            "review",
            &ResumeType::Recheck,
            "main",
            &artifacts,
            &activity_logs,
        )
        .unwrap();
        assert!(prompt.starts_with("<!orkestra:resume:review:recheck>"));
        assert!(prompt.contains("Activity Log"));
        assert!(prompt.contains("Prior stages have recorded the following activity"));
        assert!(prompt.contains("[work]"));
        assert!(prompt.contains("Implemented the feature"));
        assert!(prompt.contains("[review]"));
        assert!(prompt.contains("Found issue with error handling"));
        assert!(prompt.contains("Updated Input Artifacts"));
    }

    #[test]
    fn test_build_resume_prompt_no_artifacts() {
        let prompt = build_resume_prompt("work", &ResumeType::Continue, "main", &[], &[]).unwrap();
        assert!(prompt.starts_with("<!orkestra:resume:work:continue>"));
        assert!(prompt.contains("interrupted"));
        assert!(prompt.contains("JSON"));
        assert!(!prompt.contains("Updated Input Artifacts"));
    }

    #[test]
    fn test_build_resume_prompt_manual_resume_with_message() {
        let artifacts = vec![("plan".to_string(), "Implementation plan".to_string())];
        let prompt = build_resume_prompt(
            "work",
            &ResumeType::ManualResume {
                message: Some("Fix the validation logic".to_string()),
            },
            "main",
            &artifacts,
            &[],
        )
        .unwrap();
        assert!(prompt.starts_with("<!orkestra:resume:work:manual_resume>"));
        assert!(prompt.contains("interrupted by the user"));
        assert!(prompt.contains("Message from the user"));
        assert!(prompt.contains("Fix the validation logic"));
        assert!(prompt.contains("JSON"));
        assert!(!prompt.contains("Updated Input Artifacts"));
    }

    #[test]
    fn test_build_resume_prompt_manual_resume_no_message() {
        let artifacts = vec![];
        let prompt = build_resume_prompt(
            "review",
            &ResumeType::ManualResume { message: None },
            "main",
            &artifacts,
            &[],
        )
        .unwrap();
        assert!(prompt.starts_with("<!orkestra:resume:review:manual_resume>"));
        assert!(prompt.contains("interrupted by the user"));
        assert!(prompt.contains("JSON"));
        // Should not contain the message section when None
        assert!(!prompt.contains("Message from the user"));
    }

    #[test]
    fn test_build_resume_prompt_pr_comments() {
        let comments = vec![
            PrComment {
                author: "reviewer1".to_string(),
                path: "src/main.rs".to_string(),
                line: Some(42),
                body: "This function needs error handling".to_string(),
            },
            PrComment {
                author: "reviewer2".to_string(),
                path: "src/lib.rs".to_string(),
                line: None,
                body: "Consider adding tests for this module".to_string(),
            },
        ];
        let prompt = build_resume_prompt(
            "work",
            &ResumeType::PrComments {
                comments,
                guidance: Some("Focus on the error handling first".to_string()),
            },
            "main",
            &[],
            &[],
        )
        .unwrap();
        assert!(prompt.starts_with("<!orkestra:resume:work:pr_comments>"));
        assert!(prompt.contains("reviewer1"));
        assert!(prompt.contains("src/main.rs"));
        assert!(prompt.contains("line 42"));
        assert!(prompt.contains("This function needs error handling"));
        assert!(prompt.contains("reviewer2"));
        assert!(prompt.contains("src/lib.rs"));
        assert!(prompt.contains("Consider adding tests"));
        assert!(prompt.contains("Focus on the error handling first"));
    }

    #[test]
    fn test_build_resume_prompt_pr_comments_no_guidance() {
        let comments = vec![PrComment {
            author: "reviewer".to_string(),
            path: "README.md".to_string(),
            line: None,
            body: "Typo in documentation".to_string(),
        }];
        let prompt = build_resume_prompt(
            "work",
            &ResumeType::PrComments {
                comments,
                guidance: None,
            },
            "main",
            &[],
            &[],
        )
        .unwrap();
        assert!(prompt.starts_with("<!orkestra:resume:work:pr_comments>"));
        assert!(prompt.contains("reviewer"));
        assert!(prompt.contains("README.md"));
        assert!(prompt.contains("Typo in documentation"));
        // Should not contain guidance section when None
        assert!(!prompt.contains("User guidance"));
    }

    #[test]
    fn test_determine_resume_type_integration_takes_priority() {
        use crate::workflow::domain::QuestionAnswer;
        let error = IntegrationErrorContext {
            message: "conflict",
            conflict_files: vec!["file.rs"],
            base_branch: "main",
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

    // ========================================================================
    // Agent Definition Handlebars Rendering tests
    // ========================================================================

    #[test]
    fn test_render_agent_definition_passthrough() {
        let workflow = test_workflow();
        let builder = PromptBuilder::new(&workflow);
        let task = Task::new("task-1", "Test", "Description", "planning", "now");
        let ctx = builder
            .build_context("planning", &task, None, None, false, Vec::new(), Vec::new())
            .unwrap();

        // No {{ markers — should pass through unchanged
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
                Some("Fix this"),
                None,
                false,
                Vec::new(),
                Vec::new(),
            )
            .unwrap();
        let template = "Base instructions.\n\n{{#if feedback}}\nFEEDBACK_SECTION\n{{/if}}";
        let result = render_agent_definition(template, &ctx);
        assert!(result.contains("FEEDBACK_SECTION"));
        assert!(result.contains("Base instructions."));

        // Without feedback
        let ctx = builder
            .build_context("planning", &task, None, None, false, Vec::new(), Vec::new())
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
            .build_context("planning", &task, None, None, false, Vec::new(), Vec::new())
            .unwrap();

        // Invalid template — should return raw definition
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
            .build_context("planning", &task, None, None, false, Vec::new(), Vec::new())
            .unwrap();

        let template = "Stage: {{stage_name}}, Task: {{task_id}}";
        let result = render_agent_definition(template, &ctx);
        assert_eq!(result, "Stage: planning, Task: task-1");
    }

    // ========================================================================
    // System Prompt Split tests
    // ========================================================================

    #[test]
    fn test_build_system_prompt() {
        let agent_def = "You are a planner agent. Create implementation plans.";
        let output_format = "## Output Format\n\nProduce JSON with a `plan` field.";

        let system_prompt = build_system_prompt(agent_def, output_format);

        assert!(system_prompt.contains(agent_def));
        assert!(system_prompt.contains(output_format));
    }

    #[test]
    fn test_resolved_agent_config_has_system_prompt() {
        use tempfile::TempDir;

        let workflow = test_workflow();
        let temp_dir = TempDir::new().unwrap();

        // Create a minimal agent definition file
        let agents_dir = temp_dir.path().join(".orkestra/agents");
        std::fs::create_dir_all(&agents_dir).unwrap();
        std::fs::write(
            agents_dir.join("planning.md"),
            "You are a planning agent. Create implementation plans.",
        )
        .unwrap();

        let mut task = Task::new("task-1", "Test", "Description", "planning", "now");
        task.worktree_path = Some(temp_dir.path().to_string_lossy().to_string());

        // Resolve agent config
        let config = resolve_stage_agent_config_for(
            &workflow,
            &task,
            "planning",
            Some(temp_dir.path()),
            None,
            None,
            FlowOverrides::default(),
            false,
            Vec::new(),
            Vec::new(),
        )
        .unwrap();

        // ASSERT: system_prompt field is populated
        assert!(
            !config.system_prompt.is_empty(),
            "system_prompt should not be empty"
        );

        // ASSERT: system_prompt contains agent definition
        assert!(
            config.system_prompt.contains("planning agent"),
            "system_prompt should contain agent definition"
        );

        // ASSERT: system_prompt contains output format
        assert!(
            config.system_prompt.contains("Output Format")
                || config.system_prompt.contains("output format"),
            "system_prompt should contain output format instructions"
        );

        // ASSERT: system_prompt contains artifact name
        assert!(
            config.system_prompt.contains("plan"),
            "system_prompt should reference the artifact name 'plan'"
        );
    }

    #[test]
    fn test_system_prompt_not_in_user_message() {
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

        let ctx = builder
            .build_context("work", &task, None, None, false, Vec::new(), Vec::new())
            .unwrap();

        let user_message = build_user_message(&ctx);

        // User message should NOT contain output format or agent definition
        assert!(!user_message.contains("Output Format"));
        assert!(!user_message.contains("worker agent"));

        // But it should contain task context
        assert!(user_message.contains("Task ID"));
        assert!(user_message.contains("task-1"));
        assert!(user_message.contains("Implement login"));
    }

    #[test]
    fn test_build_user_message_contains_task_context() {
        let workflow = test_workflow();
        let builder = PromptBuilder::new(&workflow);

        let mut task = Task::new(
            "task-1",
            "Implement feature",
            "Add new feature",
            "work",
            "now",
        );
        task.artifacts.set(Artifact::new(
            "plan",
            "Step 1: Do this\nStep 2: Do that",
            "planning",
            "now",
        ));

        let ctx = builder
            .build_context("work", &task, None, None, false, Vec::new(), Vec::new())
            .unwrap();

        let user_message = build_user_message(&ctx);

        // Should contain all task context elements
        assert!(user_message.contains("task-1"));
        assert!(user_message.contains("Implement feature"));
        assert!(user_message.contains("Add new feature"));
        assert!(user_message.contains("Step 1: Do this"));
        assert!(user_message.contains("Input Artifacts"));
    }

    #[test]
    fn test_resume_prompt_has_no_system_prompt() {
        let prompt = build_resume_prompt("work", &ResumeType::Continue, "main", &[], &[]).unwrap();

        // Resume prompts are just short user messages
        assert!(prompt.starts_with("<!orkestra:resume:work:continue>"));

        // Should NOT contain system prompt elements
        assert!(!prompt.contains("Output Format"));
        assert!(!prompt.contains("agent definition"));
    }

    #[test]
    fn test_workflow_overview_in_prompt() {
        let workflow = WorkflowConfig::new(vec![
            StageConfig::new("plan", "plan").with_description("Create a plan"),
            StageConfig::new("work", "summary").with_description("Implement the plan"),
            StageConfig::new("review", "verdict").with_description("Review the work"),
        ]);
        let builder = PromptBuilder::new(&workflow);

        let task = Task::new("task-1", "Test", "Description", "work", "now");
        let ctx = builder
            .build_context("work", &task, None, None, false, Vec::new(), Vec::new())
            .unwrap();

        let user_message = build_user_message(&ctx);

        // Should contain workflow overview section
        assert!(user_message.contains("## Your Workflow"));
        assert!(user_message.contains("[plan] — Create a plan"));
        assert!(user_message.contains("[work] ← YOU ARE HERE — Implement the plan"));
        assert!(user_message.contains("[review] — Review the work"));
    }

    #[test]
    fn test_workflow_overview_with_flow() {
        let mut flows = IndexMap::new();
        flows.insert(
            "quick".into(),
            FlowConfig {
                description: "Quick flow".into(),
                icon: Some("zap".into()),
                stages: vec![
                    FlowStageEntry {
                        stage_name: "plan".into(),
                        overrides: None,
                    },
                    FlowStageEntry {
                        stage_name: "work".into(),
                        overrides: None,
                    },
                ],
                on_failure: None,
            },
        );

        let workflow = WorkflowConfig::new(vec![
            StageConfig::new("plan", "plan").with_description("Create a plan"),
            StageConfig::new("task", "breakdown"),
            StageConfig::new("work", "summary").with_description("Implement the plan"),
            StageConfig::new("review", "verdict"),
        ])
        .with_flows(flows);
        let builder = PromptBuilder::new(&workflow);

        let mut task = Task::new("task-1", "Test", "Description", "work", "now");
        task.flow = Some("quick".into());

        let ctx = builder
            .build_context("work", &task, None, None, false, Vec::new(), Vec::new())
            .unwrap();

        let user_message = build_user_message(&ctx);

        // Should only show stages in the quick flow
        assert!(user_message.contains("## Your Workflow"));
        assert!(user_message.contains("[plan] — Create a plan"));
        assert!(user_message.contains("[work] ← YOU ARE HERE — Implement the plan"));

        // Should NOT contain stages not in the flow
        assert!(!user_message.contains("[task]"));
        assert!(!user_message.contains("[review]"));
    }

    #[test]
    fn test_workflow_overview_description_fallback() {
        let workflow = WorkflowConfig::new(vec![
            StageConfig::new("planning", "plan"), // No description, should use display()
            StageConfig::new("work", "summary").with_display_name("Work Stage"),
        ]);
        let builder = PromptBuilder::new(&workflow);

        let task = Task::new("task-1", "Test", "Description", "work", "now");
        let ctx = builder
            .build_context("work", &task, None, None, false, Vec::new(), Vec::new())
            .unwrap();

        let user_message = build_user_message(&ctx);

        // Should use display() fallback for stages without description
        assert!(user_message.contains("[planning] — Planning"));
        assert!(user_message.contains("[work] ← YOU ARE HERE — Work Stage"));
    }

    // ========================================================================
    // build_workflow_stage_entries tests
    // ========================================================================

    #[test]
    fn test_build_workflow_stage_entries_default_flow() {
        let workflow = WorkflowConfig::new(vec![
            StageConfig::new("plan", "plan").with_description("Create a plan"),
            StageConfig::new("work", "summary").with_description("Implement the plan"),
            StageConfig::new("review", "verdict"),
        ]);

        let entries = build_workflow_stage_entries(&workflow, "work", None);
        assert_eq!(entries.len(), 3);

        // Check first stage
        assert_eq!(entries[0].name, "plan");
        assert_eq!(entries[0].description, "Create a plan");
        assert!(!entries[0].is_current);

        // Check current stage
        assert_eq!(entries[1].name, "work");
        assert_eq!(entries[1].description, "Implement the plan");
        assert!(entries[1].is_current);

        // Check stage without description (should use display())
        assert_eq!(entries[2].name, "review");
        assert_eq!(entries[2].description, "Review");
        assert!(!entries[2].is_current);
    }

    #[test]
    fn test_build_workflow_stage_entries_with_flow() {
        let mut flows = IndexMap::new();
        flows.insert(
            "quick".into(),
            FlowConfig {
                description: "Skip breakdown".into(),
                icon: Some("zap".into()),
                stages: vec![
                    FlowStageEntry {
                        stage_name: "plan".into(),
                        overrides: None,
                    },
                    FlowStageEntry {
                        stage_name: "work".into(),
                        overrides: None,
                    },
                ],
                on_failure: None,
            },
        );

        let workflow = WorkflowConfig::new(vec![
            StageConfig::new("plan", "plan").with_description("Create a plan"),
            StageConfig::new("task", "breakdown"),
            StageConfig::new("work", "summary").with_description("Implement the plan"),
            StageConfig::new("review", "verdict"),
        ])
        .with_flows(flows);

        let entries = build_workflow_stage_entries(&workflow, "work", Some("quick"));
        assert_eq!(entries.len(), 2);

        // Should only include plan and work, not task or review
        assert_eq!(entries[0].name, "plan");
        assert_eq!(entries[0].description, "Create a plan");
        assert!(!entries[0].is_current);

        assert_eq!(entries[1].name, "work");
        assert_eq!(entries[1].description, "Implement the plan");
        assert!(entries[1].is_current);
    }

    #[test]
    fn test_build_workflow_stage_entries_nonexistent_flow() {
        let workflow = WorkflowConfig::new(vec![StageConfig::new("plan", "plan")]);

        let entries = build_workflow_stage_entries(&workflow, "plan", Some("nonexistent"));
        assert!(entries.is_empty());
    }

    #[test]
    fn test_build_workflow_stage_entries_description_fallback() {
        let workflow = WorkflowConfig::new(vec![
            StageConfig::new("planning", "plan"), // No display_name, should fall back to "Planning"
            StageConfig::new("work", "summary").with_display_name("Work Stage"), // Should fall back to "Work Stage"
        ]);

        let entries = build_workflow_stage_entries(&workflow, "work", None);
        assert_eq!(entries[0].description, "Planning");
        assert_eq!(entries[1].description, "Work Stage");
    }

    // ========================================================================
    // Sibling Context tests
    // ========================================================================

    #[test]
    fn test_sibling_status_display_done() {
        assert_eq!(sibling_status_display(&Status::Done, Phase::Idle), "done");
        assert_eq!(
            sibling_status_display(&Status::Archived, Phase::Idle),
            "done"
        );
    }

    #[test]
    fn test_sibling_status_display_failed() {
        assert_eq!(
            sibling_status_display(
                &Status::Failed {
                    error: Some("error".into())
                },
                Phase::Idle
            ),
            "failed"
        );
        assert_eq!(
            sibling_status_display(&Status::Failed { error: None }, Phase::Idle),
            "failed"
        );
    }

    #[test]
    fn test_sibling_status_display_blocked() {
        assert_eq!(
            sibling_status_display(
                &Status::Blocked {
                    reason: Some("reason".into())
                },
                Phase::Idle
            ),
            "blocked"
        );
        assert_eq!(
            sibling_status_display(&Status::Blocked { reason: None }, Phase::Idle),
            "blocked"
        );
    }

    #[test]
    fn test_sibling_status_display_waiting() {
        assert_eq!(
            sibling_status_display(
                &Status::WaitingOnChildren {
                    stage: "work".into()
                },
                Phase::Idle
            ),
            "waiting"
        );
    }

    #[test]
    fn test_sibling_status_display_active_phases() {
        let active = Status::Active {
            stage: "work".into(),
        };

        // AgentWorking -> "working"
        assert_eq!(
            sibling_status_display(&active, Phase::AgentWorking),
            "working"
        );

        // AwaitingReview -> "reviewing"
        assert_eq!(
            sibling_status_display(&active, Phase::AwaitingReview),
            "reviewing"
        );

        // Other phases -> "pending"
        assert_eq!(sibling_status_display(&active, Phase::Idle), "pending");
        assert_eq!(
            sibling_status_display(&active, Phase::Integrating),
            "pending"
        );
        assert_eq!(sibling_status_display(&active, Phase::SettingUp), "pending");
        assert_eq!(
            sibling_status_display(&active, Phase::AwaitingSetup),
            "pending"
        );
    }

    #[test]
    fn test_build_user_message_with_siblings() {
        let workflow = test_workflow();
        let builder = PromptBuilder::new(&workflow);

        let task = Task::new("task-1", "Test", "Description", "planning", "now");

        let siblings = vec![
            SiblingTaskContext {
                short_id: "bird".into(),
                title: "First subtask".into(),
                description: "Do the first thing".into(),
                dependency_relationship: None,
                status_display: "pending".into(),
            },
            SiblingTaskContext {
                short_id: "cat".into(),
                title: "Second subtask".into(),
                description: "Depends on first".into(),
                dependency_relationship: Some("this task depends on".into()),
                status_display: "done".into(),
            },
        ];

        let ctx = builder
            .build_context("planning", &task, None, None, false, Vec::new(), siblings)
            .unwrap();

        let user_message = build_user_message(&ctx);

        // Should contain sibling section
        assert!(user_message.contains("## Sibling Subtasks"));
        assert!(user_message.contains("This task is part of a breakdown"));
        assert!(user_message.contains("**bird** First subtask"));
        assert!(user_message.contains("(pending)"));
        assert!(user_message.contains("Do the first thing"));
        assert!(user_message.contains("**cat** Second subtask"));
        assert!(user_message.contains("[this task depends on]"));
        assert!(user_message.contains("(done)"));
    }

    #[test]
    fn test_build_user_message_without_siblings() {
        let workflow = test_workflow();
        let builder = PromptBuilder::new(&workflow);

        let task = Task::new("task-1", "Test", "Description", "planning", "now");

        let ctx = builder
            .build_context("planning", &task, None, None, false, Vec::new(), Vec::new())
            .unwrap();

        let user_message = build_user_message(&ctx);

        // Should NOT contain sibling section when empty
        assert!(!user_message.contains("## Sibling Subtasks"));
        assert!(!user_message.contains("This task is part of a breakdown"));
    }

    #[test]
    fn test_sibling_dependency_relationship_display() {
        let workflow = test_workflow();
        let builder = PromptBuilder::new(&workflow);

        let task = Task::new("task-1", "Test", "Description", "planning", "now");

        let siblings = vec![
            SiblingTaskContext {
                short_id: "dep".into(),
                title: "Dependent task".into(),
                description: "Depends on current".into(),
                dependency_relationship: Some("depends on this task".into()),
                status_display: "pending".into(),
            },
            SiblingTaskContext {
                short_id: "prereq".into(),
                title: "Prerequisite task".into(),
                description: "Current depends on this".into(),
                dependency_relationship: Some("this task depends on".into()),
                status_display: "done".into(),
            },
            SiblingTaskContext {
                short_id: "unrelated".into(),
                title: "Unrelated task".into(),
                description: "No dependency".into(),
                dependency_relationship: None,
                status_display: "working".into(),
            },
        ];

        let ctx = builder
            .build_context("planning", &task, None, None, false, Vec::new(), siblings)
            .unwrap();

        let user_message = build_user_message(&ctx);

        // Check dependency markers appear correctly
        assert!(user_message.contains("[depends on this task]"));
        assert!(user_message.contains("[this task depends on]"));
        // Unrelated task should not have a dependency marker
        assert!(user_message.contains("**unrelated** Unrelated task (working)"));
    }

    // ========================================================================
    // Activity Log Deduplication tests
    // ========================================================================

    #[test]
    fn test_deduplicate_activity_logs_empty_input() {
        let logs: Vec<ActivityLogEntry> = vec![];
        let result = deduplicate_activity_logs_by_stage(logs);
        assert!(result.is_empty());
    }

    #[test]
    fn test_deduplicate_activity_logs_single_stage() {
        let logs = vec![
            ActivityLogEntry {
                stage: "work".into(),
                iteration_number: 1,
                content: "Log A".into(),
            },
            ActivityLogEntry {
                stage: "work".into(),
                iteration_number: 2,
                content: "Log B".into(),
            },
        ];
        let result = deduplicate_activity_logs_by_stage(logs);
        assert_eq!(result.len(), 1);
        assert_eq!(result[0].content, "Log B");
    }

    #[test]
    fn test_deduplicate_activity_logs_multiple_stages() {
        let logs = vec![
            ActivityLogEntry {
                stage: "plan".into(),
                iteration_number: 1,
                content: "Plan log".into(),
            },
            ActivityLogEntry {
                stage: "work".into(),
                iteration_number: 2,
                content: "Work log".into(),
            },
        ];
        let result = deduplicate_activity_logs_by_stage(logs);
        assert_eq!(result.len(), 2);
    }

    #[test]
    fn test_deduplicate_activity_logs_interleaved() {
        // work(A) -> review(C) -> work(B) -> work(D)
        // Review intervenes between A and B, so A is preserved.
        // B and D are consecutive same-stage, so D replaces B.
        let logs = vec![
            ActivityLogEntry {
                stage: "work".into(),
                iteration_number: 1,
                content: "A".into(),
            },
            ActivityLogEntry {
                stage: "review".into(),
                iteration_number: 2,
                content: "C".into(),
            },
            ActivityLogEntry {
                stage: "work".into(),
                iteration_number: 3,
                content: "B".into(),
            },
            ActivityLogEntry {
                stage: "work".into(),
                iteration_number: 4,
                content: "D".into(),
            },
        ];
        let result = deduplicate_activity_logs_by_stage(logs);
        // Should have: work:A, review:C, work:D (B replaced by D since consecutive)
        assert_eq!(result.len(), 3);
        assert_eq!(result[0].stage, "work");
        assert_eq!(result[0].content, "A");
        assert_eq!(result[1].stage, "review");
        assert_eq!(result[1].content, "C");
        assert_eq!(result[2].stage, "work");
        assert_eq!(result[2].content, "D");
    }

    #[test]
    fn test_deduplicate_activity_logs_preserves_intervening_stages() {
        // work -> review -> check -> work
        // The second work is NOT collapsed with the first because review and check intervened.
        let logs = vec![
            ActivityLogEntry {
                stage: "work".into(),
                iteration_number: 1,
                content: "Work 1".into(),
            },
            ActivityLogEntry {
                stage: "review".into(),
                iteration_number: 2,
                content: "Review".into(),
            },
            ActivityLogEntry {
                stage: "check".into(),
                iteration_number: 3,
                content: "Check".into(),
            },
            ActivityLogEntry {
                stage: "work".into(),
                iteration_number: 4,
                content: "Work 2".into(),
            },
        ];
        let result = deduplicate_activity_logs_by_stage(logs);
        // All 4 entries preserved because intervening stages prevent collapse
        assert_eq!(result.len(), 4);
        assert_eq!(result[0].stage, "work");
        assert_eq!(result[0].content, "Work 1");
        assert_eq!(result[1].stage, "review");
        assert_eq!(result[2].stage, "check");
        assert_eq!(result[3].stage, "work");
        assert_eq!(result[3].content, "Work 2");
    }

    #[test]
    fn test_deduplicate_activity_logs_empty_content() {
        let logs = vec![
            ActivityLogEntry {
                stage: "work".into(),
                iteration_number: 1,
                content: "Valid".into(),
            },
            ActivityLogEntry {
                stage: "plan".into(),
                iteration_number: 2,
                content: "  ".into(), // whitespace only
            },
        ];
        let result = deduplicate_activity_logs_by_stage(logs);
        assert_eq!(result.len(), 1);
        assert_eq!(result[0].stage, "work");
    }

    #[test]
    fn test_deduplicate_activity_logs_all_empty_content() {
        let logs = vec![
            ActivityLogEntry {
                stage: "work".into(),
                iteration_number: 1,
                content: String::new(),
            },
            ActivityLogEntry {
                stage: "plan".into(),
                iteration_number: 2,
                content: "\n\t  ".into(),
            },
        ];
        let result = deduplicate_activity_logs_by_stage(logs);
        assert!(result.is_empty());
    }

    #[test]
    fn test_deduplicate_activity_logs_consecutive_same_stage() {
        // Consecutive same-stage entries are collapsed (last wins)
        let logs = vec![
            ActivityLogEntry {
                stage: "work".into(),
                iteration_number: 1,
                content: "Oldest".into(),
            },
            ActivityLogEntry {
                stage: "work".into(),
                iteration_number: 2,
                content: "Middle".into(),
            },
            ActivityLogEntry {
                stage: "work".into(),
                iteration_number: 3,
                content: "Latest".into(),
            },
        ];
        let result = deduplicate_activity_logs_by_stage(logs);
        assert_eq!(result.len(), 1);
        // Should keep the last entry (latest) since all are consecutive
        assert_eq!(result[0].content, "Latest");
    }
}
