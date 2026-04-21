//! Public types for prompt building.
//!
//! All data types that cross interaction boundaries live here.

use orkestra_types::config::StageConfig;
use orkestra_types::runtime::TaskState;
use serde::Serialize;

// ============================================================================
// Build Types
// ============================================================================

/// Context for building a stage prompt.
#[derive(Debug, Clone, Serialize)]
pub struct StagePromptContext<'a> {
    /// Stage configuration.
    pub stage: &'a StageConfig,

    /// Task information.
    pub task_id: &'a str,

    /// Path to the materialized task definition file (`.orkestra/.artifacts/trak.md`).
    /// Absolute when `worktree_path` is available, relative otherwise.
    pub task_file_path: String,

    /// Whether any prior stage has a materialized artifact available (including activity log).
    /// Used to conditionally show "MUST read" instructions in the prompt.
    pub has_input_artifacts: bool,

    /// Path to the activity log file, if it has been materialized.
    /// The activity log accumulates entries across all prior stages.
    pub activity_log_path: Option<String>,

    /// Inline resource details for the prompt.
    /// Populated from the merged task + parent resource stores so agents see resources directly.
    pub resources: Vec<ResourceContext>,

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

    /// Workflow stage entries for the overview section.
    pub workflow_stages: Vec<WorkflowStageEntry>,

    /// Sibling subtasks (for subtasks only, empty for non-subtasks).
    pub sibling_tasks: Vec<SiblingTaskContext>,
}

/// Context for a resource in the prompt.
#[derive(Debug, Clone, Serialize)]
pub struct ResourceContext {
    /// Resource name.
    pub name: String,
    /// URL or file path. None for description-only resources.
    pub url: Option<String>,
    /// What this resource is.
    pub description: Option<String>,
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

/// A stage entry for the workflow overview in agent prompts.
#[derive(Debug, Clone, Serialize)]
pub struct WorkflowStageEntry {
    /// Stage name (e.g., "plan", "work").
    pub name: String,
    /// Title-cased display name derived from the stage name (e.g., "Work Review").
    pub display_name: String,
    /// Human-readable description of what this stage does.
    pub description: Option<String>,
    /// Whether this is the current stage being executed.
    pub is_current: bool,
    /// Path to the materialized artifact file for this stage, if it has already been produced.
    /// Only set for stages that precede the current stage and have a materialized artifact.
    pub artifact_path: Option<String>,
}

// ============================================================================
// Agent Config Types
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
    /// Dynamic prompt sections extracted from the prompt context.
    /// Non-empty only for fresh spawns with dynamic context (feedback, conflicts, etc.).
    pub dynamic_sections: Vec<orkestra_types::domain::PromptSection>,
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

// ============================================================================
// Resume Types
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
    /// Human retried a failed task, optionally with instructions.
    RetryFailed { instructions: Option<String> },
    /// Human retried a blocked task, optionally with instructions.
    RetryBlocked { instructions: Option<String> },
    /// User interrupted and resumed with optional guidance.
    ManualResume { message: Option<String> },
    /// User selected PR comments and/or failed CI checks to address.
    PrComments {
        comments: Vec<PrComment>,
        checks: Vec<PrCheckContext>,
        guidance: Option<String>,
    },
    /// User chatted with the agent and is returning to structured output.
    ///
    /// Carries the optional final message the user typed before clicking
    /// "Return to Work", injected into the resume prompt as a closing instruction.
    ReturnToWork { message: Option<String> },
    /// Agent output was malformed — corrective prompt with attempt count.
    MalformedOutput {
        error: String,
        attempt: u32,
        max_attempts: u32,
    },
    /// User sent a message directly; agent should address it and continue working.
    UserMessage { message: String },
}

/// A failed CI check to address in the resume prompt.
///
/// Type alias for `PrCheckData` — the fields are identical and there is no
/// normalization difference between the domain type and the prompt-layer type.
pub type PrCheckContext = orkestra_types::domain::PrCheckData;

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

// ============================================================================
// Helper Functions
// ============================================================================

/// Convert `TaskState` to a user-friendly display string for sibling context.
pub fn sibling_status_display(state: &TaskState) -> &'static str {
    match state {
        TaskState::Done | TaskState::Archived => "done",
        TaskState::Failed { .. } => "failed",
        TaskState::Blocked { .. } => "blocked",
        TaskState::WaitingOnChildren { .. } => "waiting",
        TaskState::AgentWorking { .. } => "working",
        TaskState::AwaitingApproval { .. }
        | TaskState::AwaitingQuestionAnswer { .. }
        | TaskState::AwaitingRejectionConfirmation { .. } => "reviewing",
        _ => "pending",
    }
}

/// Helper to convert `QuestionAnswer` to context.
impl<'a> From<&'a orkestra_types::domain::QuestionAnswer> for QuestionAnswerContext<'a> {
    fn from(qa: &'a orkestra_types::domain::QuestionAnswer) -> Self {
        Self {
            question: &qa.question,
            answer: &qa.answer,
        }
    }
}
