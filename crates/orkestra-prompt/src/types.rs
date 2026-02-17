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

/// A stage entry for the workflow overview in agent prompts.
#[derive(Debug, Clone, Serialize)]
pub struct WorkflowStageEntry {
    /// Stage name (e.g., "plan", "work").
    pub name: String,
    /// Human-readable description of what this stage does.
    pub description: String,
    /// Whether this is the current stage being executed.
    pub is_current: bool,
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
    pub capabilities: Option<&'a orkestra_types::config::StageCapabilities>,
    /// Override the stage inputs.
    pub inputs: Option<Vec<String>>,
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

/// Consolidate activity logs, collapsing only consecutive same-stage entries.
///
/// Uses "intervening stage prevents deduplication" semantics: consecutive entries from
/// the same stage are collapsed (last wins), but if a different stage appears in between,
/// both entries are preserved.
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

/// Helper to convert `QuestionAnswer` to context.
impl<'a> From<&'a orkestra_types::domain::QuestionAnswer> for QuestionAnswerContext<'a> {
    fn from(qa: &'a orkestra_types::domain::QuestionAnswer) -> Self {
        Self {
            question: &qa.question,
            answer: &qa.answer,
        }
    }
}
