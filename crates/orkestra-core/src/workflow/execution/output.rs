//! Stage output types.
//!
//! Defines the possible outputs from agents in a stage-agnostic way.
//! Any stage can produce these outputs based on its capabilities.

use serde::{Deserialize, Serialize};

use crate::workflow::domain::Question;

/// Error when parsing stage output.
#[derive(Debug, thiserror::Error)]
pub enum StageOutputError {
    /// JSON parsing failed.
    #[error("Failed to parse output JSON: {0}")]
    JsonParse(#[from] serde_json::Error),

    /// Output has an unknown type.
    #[error("Unknown output type: {0}")]
    UnknownType(String),

    /// Output is missing required fields.
    #[error("Missing required field: {0}")]
    MissingField(String),
}

/// Parsed output from a stage agent.
///
/// This is stage-agnostic - any stage can produce these outputs
/// based on its capabilities in the workflow config.
#[derive(Debug, Clone, PartialEq)]
pub enum StageOutput {
    /// Agent produced an artifact (the stage's primary output).
    Artifact {
        /// The artifact content.
        content: String,
    },

    /// Agent is asking clarifying questions.
    /// Only valid if the stage has `ask_questions` capability.
    Questions {
        /// Questions for the user.
        questions: Vec<Question>,
    },

    /// Agent wants to restage to a different stage.
    /// Only valid if the stage has the target in `supports_restage`.
    Restage {
        /// Target stage to go to.
        target: String,
        /// Feedback for the target stage.
        feedback: String,
    },

    /// Agent produced subtasks for breakdown.
    /// Only valid if the stage has `produce_subtasks` capability.
    Subtasks {
        /// List of subtasks to create.
        subtasks: Vec<SubtaskOutput>,
    },

    /// Agent completed work successfully.
    Completed {
        /// Summary of what was done.
        summary: String,
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
    /// IDs of subtasks this depends on.
    #[serde(default)]
    pub depends_on: Vec<String>,
}

impl StageOutput {
    /// Parse stage output from JSON.
    ///
    /// The JSON should have a "type" field indicating the output type:
    /// - `"artifact"` or `"plan"` or `"verdict"` → Artifact
    /// - `"questions"` → Questions
    /// - `"restage"` → Restage
    /// - `"breakdown"` or `"subtasks"` → Subtasks
    /// - `"completed"` → Completed
    /// - `"failed"` → Failed
    /// - `"blocked"` → Blocked
    pub fn parse(json: &str) -> Result<Self, StageOutputError> {
        let value: serde_json::Value = serde_json::from_str(json)?;

        let output_type = value["type"]
            .as_str()
            .ok_or_else(|| StageOutputError::MissingField("type".into()))?;

        match output_type {
            // Artifact types (stage-specific names map to generic Artifact)
            "artifact" | "plan" | "verdict" | "summary" => {
                let content = value["content"]
                    .as_str()
                    .or_else(|| value["plan"].as_str())
                    .or_else(|| value["verdict"].as_str())
                    .or_else(|| value["summary"].as_str())
                    .ok_or_else(|| StageOutputError::MissingField("content".into()))?;

                Ok(StageOutput::Artifact {
                    content: content.to_string(),
                })
            }

            "questions" => {
                let questions: Vec<QuestionJson> = serde_json::from_value(
                    value["questions"]
                        .clone()
                )
                .map_err(|_| StageOutputError::MissingField("questions".into()))?;

                Ok(StageOutput::Questions {
                    questions: questions.into_iter().map(Into::into).collect(),
                })
            }

            "restage" => {
                let target = value["target"]
                    .as_str()
                    .ok_or_else(|| StageOutputError::MissingField("target".into()))?;
                let feedback = value["feedback"]
                    .as_str()
                    .ok_or_else(|| StageOutputError::MissingField("feedback".into()))?;

                Ok(StageOutput::Restage {
                    target: target.to_string(),
                    feedback: feedback.to_string(),
                })
            }

            "breakdown" | "subtasks" => {
                let subtasks: Vec<SubtaskOutput> = serde_json::from_value(
                    value["subtasks"]
                        .clone()
                )
                .map_err(|_| StageOutputError::MissingField("subtasks".into()))?;

                Ok(StageOutput::Subtasks { subtasks })
            }

            "completed" => {
                let summary = value["summary"]
                    .as_str()
                    .ok_or_else(|| StageOutputError::MissingField("summary".into()))?;

                Ok(StageOutput::Completed {
                    summary: summary.to_string(),
                })
            }

            "failed" => {
                let error = value["error"]
                    .as_str()
                    .ok_or_else(|| StageOutputError::MissingField("error".into()))?;

                Ok(StageOutput::Failed {
                    error: error.to_string(),
                })
            }

            "blocked" => {
                let reason = value["reason"]
                    .as_str()
                    .ok_or_else(|| StageOutputError::MissingField("reason".into()))?;

                Ok(StageOutput::Blocked {
                    reason: reason.to_string(),
                })
            }

            "approved" => {
                // Reviewer approved - treat as completed artifact
                Ok(StageOutput::Artifact {
                    content: "approved".to_string(),
                })
            }

            "rejected" => {
                // Reviewer rejected - maps to restage
                let feedback = value["feedback"]
                    .as_str()
                    .unwrap_or("No feedback provided");
                let target = value["target"]
                    .as_str()
                    .unwrap_or("work"); // Default to work stage

                Ok(StageOutput::Restage {
                    target: target.to_string(),
                    feedback: feedback.to_string(),
                })
            }

            "skip_breakdown" => {
                // Agent chose to skip breakdown
                Ok(StageOutput::Artifact {
                    content: "skip".to_string(),
                })
            }

            _ => Err(StageOutputError::UnknownType(output_type.to_string())),
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

    /// Check if this output is a restage request.
    pub fn is_restage(&self) -> bool {
        matches!(self, StageOutput::Restage { .. })
    }

    /// Get the artifact content if this is an artifact output.
    pub fn artifact_content(&self) -> Option<&str> {
        match self {
            StageOutput::Artifact { content } => Some(content),
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

    /// Get the restage target if this is a restage output.
    pub fn restage_target(&self) -> Option<&str> {
        match self {
            StageOutput::Restage { target, .. } => Some(target),
            _ => None,
        }
    }
}

/// JSON structure for questions in agent output.
#[derive(Debug, Deserialize)]
struct QuestionJson {
    id: Option<String>,
    question: String,
    context: Option<String>,
    #[serde(default)]
    options: Vec<OptionJson>,
}

#[derive(Debug, Deserialize)]
struct OptionJson {
    id: Option<String>,
    label: String,
    description: Option<String>,
}

impl From<QuestionJson> for Question {
    fn from(q: QuestionJson) -> Self {
        use std::sync::atomic::{AtomicU64, Ordering};
        static COUNTER: AtomicU64 = AtomicU64::new(1);

        let gen_id = || format!("q-{}", COUNTER.fetch_add(1, Ordering::SeqCst));

        let mut question = Question::new(q.id.unwrap_or_else(gen_id), &q.question);
        if let Some(ctx) = q.context {
            question = question.with_context(&ctx);
        }
        for opt in q.options {
            question = question.with_option(
                opt.id.unwrap_or_else(gen_id),
                &opt.label,
                opt.description.as_deref(),
            );
        }
        question
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_parse_artifact() {
        let json = r#"{"type": "artifact", "content": "The plan content"}"#;
        let output = StageOutput::parse(json).unwrap();

        assert!(output.is_artifact());
        assert_eq!(output.artifact_content(), Some("The plan content"));
    }

    #[test]
    fn test_parse_plan_as_artifact() {
        let json = r#"{"type": "plan", "plan": "Step 1. Do thing\nStep 2. Do other"}"#;
        let output = StageOutput::parse(json).unwrap();

        assert!(output.is_artifact());
        assert!(output.artifact_content().unwrap().contains("Step 1"));
    }

    #[test]
    fn test_parse_questions() {
        let json = r#"{
            "type": "questions",
            "questions": [
                {"question": "What framework?", "options": [{"label": "React"}, {"label": "Vue"}]}
            ]
        }"#;
        let output = StageOutput::parse(json).unwrap();

        assert!(output.is_questions());
        let questions = output.questions().unwrap();
        assert_eq!(questions.len(), 1);
        assert_eq!(questions[0].question, "What framework?");
    }

    #[test]
    fn test_parse_restage() {
        let json = r#"{"type": "restage", "target": "work", "feedback": "Tests failing"}"#;
        let output = StageOutput::parse(json).unwrap();

        assert!(output.is_restage());
        assert_eq!(output.restage_target(), Some("work"));
        match output {
            StageOutput::Restage { feedback, .. } => assert_eq!(feedback, "Tests failing"),
            _ => panic!("Expected Restage"),
        }
    }

    #[test]
    fn test_parse_subtasks() {
        let json = r#"{
            "type": "breakdown",
            "subtasks": [
                {"title": "Task 1", "description": "Do first thing"},
                {"title": "Task 2", "description": "Do second thing", "depends_on": ["Task 1"]}
            ]
        }"#;
        let output = StageOutput::parse(json).unwrap();

        match output {
            StageOutput::Subtasks { subtasks } => {
                assert_eq!(subtasks.len(), 2);
                assert_eq!(subtasks[0].title, "Task 1");
                assert_eq!(subtasks[1].depends_on, vec!["Task 1"]);
            }
            _ => panic!("Expected Subtasks"),
        }
    }

    #[test]
    fn test_parse_completed() {
        let json = r#"{"type": "completed", "summary": "All done!"}"#;
        let output = StageOutput::parse(json).unwrap();

        match output {
            StageOutput::Completed { summary } => assert_eq!(summary, "All done!"),
            _ => panic!("Expected Completed"),
        }
    }

    #[test]
    fn test_parse_failed() {
        let json = r#"{"type": "failed", "error": "Build error"}"#;
        let output = StageOutput::parse(json).unwrap();

        match output {
            StageOutput::Failed { error } => assert_eq!(error, "Build error"),
            _ => panic!("Expected Failed"),
        }
    }

    #[test]
    fn test_parse_blocked() {
        let json = r#"{"type": "blocked", "reason": "Waiting on API access"}"#;
        let output = StageOutput::parse(json).unwrap();

        match output {
            StageOutput::Blocked { reason } => assert_eq!(reason, "Waiting on API access"),
            _ => panic!("Expected Blocked"),
        }
    }

    #[test]
    fn test_parse_approved() {
        let json = r#"{"type": "approved"}"#;
        let output = StageOutput::parse(json).unwrap();

        assert!(output.is_artifact());
        assert_eq!(output.artifact_content(), Some("approved"));
    }

    #[test]
    fn test_parse_rejected() {
        let json = r#"{"type": "rejected", "feedback": "Fix tests", "target": "work"}"#;
        let output = StageOutput::parse(json).unwrap();

        assert!(output.is_restage());
        assert_eq!(output.restage_target(), Some("work"));
    }

    #[test]
    fn test_parse_skip_breakdown() {
        let json = r#"{"type": "skip_breakdown"}"#;
        let output = StageOutput::parse(json).unwrap();

        assert!(output.is_artifact());
        assert_eq!(output.artifact_content(), Some("skip"));
    }

    #[test]
    fn test_parse_unknown_type() {
        let json = r#"{"type": "unknown_thing"}"#;
        let result = StageOutput::parse(json);

        assert!(matches!(result, Err(StageOutputError::UnknownType(_))));
    }

    #[test]
    fn test_parse_missing_type() {
        let json = r#"{"content": "something"}"#;
        let result = StageOutput::parse(json);

        assert!(matches!(result, Err(StageOutputError::MissingField(_))));
    }

    #[test]
    fn test_parse_invalid_json() {
        let json = "not valid json";
        let result = StageOutput::parse(json);

        assert!(matches!(result, Err(StageOutputError::JsonParse(_))));
    }
}
