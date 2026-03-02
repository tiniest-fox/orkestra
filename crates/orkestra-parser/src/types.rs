//! Parser types shared across interactions and services.

use orkestra_types::domain::Question;
use serde::{Deserialize, Serialize};

use orkestra_types::domain::LogEntry;

// ============================================================================
// Stage Output
// ============================================================================

/// Error when parsing stage output.
#[derive(Debug, thiserror::Error)]
pub enum StageOutputError {
    /// JSON parsing failed.
    #[error("Failed to parse output JSON: {0}")]
    JsonParse(#[from] serde_json::Error),

    /// Schema validation failed.
    #[error("Schema validation failed: {0}")]
    SchemaValidation(String),

    /// Invalid schema provided.
    #[error("Invalid schema: {0}")]
    InvalidSchema(String),

    /// Output is missing required fields.
    #[error("Missing required field: {0}")]
    MissingField(String),
}

/// Parsed output from a stage agent.
///
/// This is stage-agnostic - any stage can produce these outputs
/// based on its capabilities in the workflow config.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum StageOutput {
    /// Agent produced an artifact (the stage's primary output).
    Artifact {
        /// The artifact content.
        content: String,
        /// Optional activity log.
        activity_log: Option<String>,
    },

    /// Agent is asking clarifying questions.
    /// Only valid if the stage has `ask_questions` capability.
    Questions {
        /// Questions for the user.
        questions: Vec<Question>,
    },

    /// Agent produced an approval decision (approve or reject).
    /// Only valid if the stage has `approval` capability.
    Approval {
        /// The decision: "approve" or "reject".
        decision: String,
        /// Review content: becomes artifact on approve, feedback on reject.
        content: String,
        /// Optional activity log.
        activity_log: Option<String>,
    },

    /// Agent produced subtasks for breakdown.
    /// Only valid if the stage has subtask capabilities.
    Subtasks {
        /// The artifact content (technical design, analysis, etc.).
        content: String,
        /// List of subtasks to create.
        subtasks: Vec<SubtaskOutput>,
        /// Reason for skipping breakdown (required if subtasks is empty).
        skip_reason: Option<String>,
        /// Optional activity log.
        activity_log: Option<String>,
    },

    /// Agent failed to complete.
    Failed {
        /// Error message.
        error: String,
    },

    /// Agent is blocked.
    Blocked {
        /// Reason for being blocked.
        reason: String,
    },
}

/// A subtask in breakdown output.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct SubtaskOutput {
    /// Subtask title.
    pub title: String,
    /// Subtask description.
    pub description: String,
    /// Per-subtask implementation brief (becomes the subtask's primary artifact).
    pub detailed_instructions: String,
    /// Indices of subtasks this depends on (0-based).
    #[serde(default)]
    pub depends_on: Vec<usize>,
}

impl StageOutput {
    /// Short label for the output variant (e.g. "artifact", "questions").
    pub fn type_label(&self) -> &'static str {
        match self {
            StageOutput::Artifact { .. } => "artifact",
            StageOutput::Questions { .. } => "questions",
            StageOutput::Subtasks { .. } => "subtasks",
            StageOutput::Approval { .. } => "approval",
            StageOutput::Failed { .. } => "failed",
            StageOutput::Blocked { .. } => "blocked",
        }
    }

    /// Check if this output is an artifact.
    pub fn is_artifact(&self) -> bool {
        matches!(self, StageOutput::Artifact { .. })
    }

    /// Check if this output contains questions.
    pub fn is_questions(&self) -> bool {
        matches!(self, StageOutput::Questions { .. })
    }

    /// Check if this output is an approval decision.
    pub fn is_approval(&self) -> bool {
        matches!(self, StageOutput::Approval { .. })
    }

    /// Get the artifact content if this is an artifact output.
    pub fn artifact_content(&self) -> Option<&str> {
        match self {
            StageOutput::Artifact { content, .. } => Some(content),
            _ => None,
        }
    }

    /// Get the questions if this is a questions output.
    pub fn questions(&self) -> Option<&[Question]> {
        match self {
            StageOutput::Questions { questions } => Some(questions),
            _ => None,
        }
    }

    /// Get the activity log, if present.
    pub fn activity_log(&self) -> Option<&str> {
        match self {
            StageOutput::Artifact { activity_log, .. }
            | StageOutput::Approval { activity_log, .. }
            | StageOutput::Subtasks { activity_log, .. } => activity_log.as_deref(),
            _ => None,
        }
    }

    /// Parse stage output without schema validation (legacy/testing).
    ///
    /// Production code should use `interactions::output::parse_stage_output::execute()`
    /// with schema validation.
    pub fn parse_unvalidated(json: &str) -> Result<Self, StageOutputError> {
        let value: serde_json::Value = serde_json::from_str(json)?;

        let output_type = value["type"]
            .as_str()
            .ok_or_else(|| StageOutputError::MissingField("type".into()))?;

        match output_type {
            "failed" => Ok(StageOutput::Failed {
                error: value["error"]
                    .as_str()
                    .ok_or_else(|| StageOutputError::MissingField("error".into()))?
                    .to_string(),
            }),

            "blocked" => Ok(StageOutput::Blocked {
                reason: value["reason"]
                    .as_str()
                    .ok_or_else(|| StageOutputError::MissingField("reason".into()))?
                    .to_string(),
            }),

            "questions" => {
                let questions: Vec<QuestionJson> =
                    serde_json::from_value(value["questions"].clone())
                        .map_err(|_| StageOutputError::MissingField("questions".into()))?;

                Ok(StageOutput::Questions {
                    questions: questions.into_iter().map(Into::into).collect(),
                })
            }

            "subtasks" => {
                let content = value["content"]
                    .as_str()
                    .ok_or_else(|| StageOutputError::MissingField("content".into()))?
                    .to_string();

                let subtasks: Vec<SubtaskOutput> =
                    serde_json::from_value(value["subtasks"].clone())
                        .map_err(|_| StageOutputError::MissingField("subtasks".into()))?;

                let skip_reason = value["skip_reason"].as_str().map(String::from);
                let activity_log = value["activity_log"].as_str().map(String::from);

                Ok(StageOutput::Subtasks {
                    content,
                    subtasks,
                    skip_reason,
                    activity_log,
                })
            }

            "approval" => Ok(StageOutput::Approval {
                decision: value["decision"]
                    .as_str()
                    .ok_or_else(|| StageOutputError::MissingField("decision".into()))?
                    .to_string(),
                content: value["content"]
                    .as_str()
                    .ok_or_else(|| StageOutputError::MissingField("content".into()))?
                    .to_string(),
                activity_log: value["activity_log"].as_str().map(String::from),
            }),

            // Any other type with content is treated as an artifact
            _ => {
                let content = value["content"]
                    .as_str()
                    .ok_or_else(|| StageOutputError::MissingField("content".into()))?;

                Ok(StageOutput::Artifact {
                    content: content.to_string(),
                    activity_log: value["activity_log"].as_str().map(String::from),
                })
            }
        }
    }
}

// ============================================================================
// Parsed Update
// ============================================================================

/// Parsed result from a single stdout line during streaming.
pub struct ParsedUpdate {
    /// Log entries extracted from this line.
    pub log_entries: Vec<LogEntry>,
    /// Session ID extracted from the stream (populated once for providers like
    /// `OpenCode` that generate their own session IDs).
    pub session_id: Option<String>,
}

// ============================================================================
// Resume Marker Types
// ============================================================================

/// Types of session resumption.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum ResumeMarkerType {
    /// Agent was interrupted, continue from where left off.
    Continue,
    /// Human provided feedback to address.
    Feedback,
    /// Integration failed with merge conflict.
    Integration,
    /// Human provided answers to questions.
    Answers,
    /// Human retried a failed task.
    RetryFailed,
    /// Human retried a blocked task.
    RetryBlocked,
    /// Initial agent prompt (first spawn, not a resume).
    Initial,
    /// User interrupted and resumed with optional guidance.
    ManualResume,
    /// Agent returned to structured work after a chat session.
    ReturnToWork,
}

impl ResumeMarkerType {
    /// Get the string representation for serialization.
    pub fn as_str(&self) -> &'static str {
        match self {
            Self::Continue => "continue",
            Self::Feedback => "feedback",
            Self::Integration => "integration",
            Self::Answers => "answers",
            Self::RetryFailed => "retry_failed",
            Self::RetryBlocked => "retry_blocked",
            Self::Initial => "initial",
            Self::ManualResume => "manual_resume",
            Self::ReturnToWork => "return_to_work",
        }
    }
}

/// Parsed resume marker from a user message.
#[derive(Debug, Clone)]
pub struct ResumeMarker {
    /// Type of resume (continue, feedback, integration).
    pub marker_type: ResumeMarkerType,
    /// Content after the marker.
    pub content: String,
}

// ============================================================================
// Internal JSON structures for question parsing
// ============================================================================

/// JSON structure for questions in agent output.
#[derive(Debug, Deserialize)]
pub(crate) struct QuestionJson {
    question: String,
    context: Option<String>,
    #[serde(default)]
    options: Vec<OptionJson>,
}

#[derive(Debug, Deserialize)]
pub(crate) struct OptionJson {
    label: String,
    description: Option<String>,
}

impl From<QuestionJson> for Question {
    fn from(q: QuestionJson) -> Self {
        let mut question = Question::new(&q.question);
        if let Some(ctx) = q.context {
            question = question.with_context(&ctx);
        }
        for opt in q.options {
            question = question.with_option(&opt.label, opt.description.as_deref());
        }
        question
    }
}
