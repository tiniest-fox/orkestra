//! Stage output types.
//!
//! Defines the possible outputs from agents in a stage-agnostic way.
//! Any stage can produce these outputs based on its capabilities.
//!
//! Validation is schema-driven using the `jsonschema` crate - the same
//! schema sent to Claude is used to validate responses.

use jsonschema::Validator;
use serde::{Deserialize, Serialize};

use crate::workflow::domain::Question;

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
    /// Only valid if the stage has subtask capabilities.
    Subtasks {
        /// The artifact content (technical design, analysis, etc.).
        content: String,
        /// List of subtasks to create.
        subtasks: Vec<SubtaskOutput>,
        /// Reason for skipping breakdown (required if subtasks is empty).
        skip_reason: Option<String>,
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
    /// Indices of subtasks this depends on (0-based).
    #[serde(default)]
    pub depends_on: Vec<usize>,
}

impl StageOutput {
    /// Parse and validate stage output against a JSON schema.
    ///
    /// The schema is the single source of truth - it's the same schema
    /// we send to Claude via `--json-schema`. This ensures consistency
    /// between what we tell agents is valid and what we accept.
    ///
    /// # Arguments
    /// * `json` - The JSON output from the agent
    /// * `schema` - The JSON Schema (same one sent to Claude)
    pub fn parse(json: &str, schema: &serde_json::Value) -> Result<Self, StageOutputError> {
        let value: serde_json::Value = serde_json::from_str(json)?;

        // Validate against schema - this is the SINGLE source of truth
        let validator =
            Validator::new(schema).map_err(|e| StageOutputError::InvalidSchema(e.to_string()))?;

        // Collect all validation errors using iter_errors
        let errors: Vec<String> = validator
            .iter_errors(&value)
            .map(|e| format!("{} at {}", e, e.instance_path))
            .collect();

        if !errors.is_empty() {
            return Err(StageOutputError::SchemaValidation(errors.join("; ")));
        }

        // Schema validated - now extract into our types
        // We can use unwrap() safely because the schema validated these fields
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

                Ok(StageOutput::Subtasks {
                    content,
                    subtasks,
                    skip_reason,
                })
            }

            "restage" => Ok(StageOutput::Restage {
                target: value["target"]
                    .as_str()
                    .ok_or_else(|| StageOutputError::MissingField("target".into()))?
                    .to_string(),
                feedback: value["feedback"]
                    .as_str()
                    .ok_or_else(|| StageOutputError::MissingField("feedback".into()))?
                    .to_string(),
            }),

            // Any other type is an artifact (the schema validated the type is in the enum)
            _ => Ok(StageOutput::Artifact {
                content: value["content"]
                    .as_str()
                    .ok_or_else(|| StageOutputError::MissingField("content".into()))?
                    .to_string(),
            }),
        }
    }

    /// Parse stage output without schema validation (legacy/testing).
    ///
    /// This is kept for backwards compatibility and testing. Production code
    /// should use `parse()` with schema validation.
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

                Ok(StageOutput::Subtasks {
                    content,
                    subtasks,
                    skip_reason,
                })
            }

            "restage" => Ok(StageOutput::Restage {
                target: value["target"]
                    .as_str()
                    .ok_or_else(|| StageOutputError::MissingField("target".into()))?
                    .to_string(),
                feedback: value["feedback"]
                    .as_str()
                    .ok_or_else(|| StageOutputError::MissingField("feedback".into()))?
                    .to_string(),
            }),

            // Any other type with content is treated as an artifact
            _ => {
                let content = value["content"]
                    .as_str()
                    .ok_or_else(|| StageOutputError::MissingField("content".into()))?;

                Ok(StageOutput::Artifact {
                    content: content.to_string(),
                })
            }
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
    question: String,
    context: Option<String>,
    #[serde(default)]
    options: Vec<OptionJson>,
}

#[derive(Debug, Deserialize)]
struct OptionJson {
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

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    /// Create a minimal schema for testing that accepts specific types.
    fn test_schema(artifact_name: &str, include_subtasks: bool) -> serde_json::Value {
        let mut type_enum = vec![
            json!(artifact_name),
            json!("failed"),
            json!("blocked"),
            json!("questions"),
            json!("restage"),
        ];
        if include_subtasks {
            type_enum.push(json!("subtasks"));
        }

        json!({
            "type": "object",
            "properties": {
                "type": {
                    "type": "string",
                    "enum": type_enum
                },
                "content": { "type": "string" },
                "error": { "type": "string" },
                "reason": { "type": "string" },
                "target": { "type": "string" },
                "feedback": { "type": "string" },
                "questions": { "type": "array" },
                "subtasks": { "type": "array" },
                "skip_reason": { "type": "string" }
            },
            "required": ["type"]
        })
    }

    #[test]
    fn test_parse_artifact() {
        let schema = test_schema("plan", false);
        let json = r#"{"type": "plan", "content": "The plan content"}"#;
        let output = StageOutput::parse(json, &schema).unwrap();

        assert!(output.is_artifact());
        assert_eq!(output.artifact_content(), Some("The plan content"));
    }

    #[test]
    fn test_parse_questions() {
        let schema = test_schema("plan", false);
        let json = r#"{
            "type": "questions",
            "questions": [
                {"question": "What framework?", "options": [{"label": "React"}, {"label": "Vue"}]}
            ]
        }"#;
        let output = StageOutput::parse(json, &schema).unwrap();

        assert!(output.is_questions());
        let questions = output.questions().unwrap();
        assert_eq!(questions.len(), 1);
        assert_eq!(questions[0].question, "What framework?");
    }

    #[test]
    fn test_parse_restage() {
        let schema = test_schema("plan", false);
        let json = r#"{"type": "restage", "target": "work", "feedback": "Tests failing"}"#;
        let output = StageOutput::parse(json, &schema).unwrap();

        assert!(output.is_restage());
        assert_eq!(output.restage_target(), Some("work"));
        match output {
            StageOutput::Restage { feedback, .. } => assert_eq!(feedback, "Tests failing"),
            _ => panic!("Expected Restage"),
        }
    }

    #[test]
    fn test_parse_subtasks() {
        let schema = test_schema("breakdown", true);
        let json = r#"{
            "type": "subtasks",
            "content": "The technical design content",
            "subtasks": [
                {"title": "Task 1", "description": "Do first thing"},
                {"title": "Task 2", "description": "Do second thing", "depends_on": [0]}
            ]
        }"#;
        let output = StageOutput::parse(json, &schema).unwrap();

        match output {
            StageOutput::Subtasks {
                content,
                subtasks,
                skip_reason,
            } => {
                assert_eq!(content, "The technical design content");
                assert_eq!(subtasks.len(), 2);
                assert_eq!(subtasks[0].title, "Task 1");
                assert_eq!(subtasks[1].depends_on, vec![0]);
                assert!(skip_reason.is_none());
            }
            _ => panic!("Expected Subtasks"),
        }
    }

    #[test]
    fn test_parse_subtasks_with_skip_reason() {
        let schema = test_schema("breakdown", true);
        let json = r#"{
            "type": "subtasks",
            "content": "Task is simple enough to handle directly",
            "subtasks": [],
            "skip_reason": "Task is simple enough to complete directly"
        }"#;
        let output = StageOutput::parse(json, &schema).unwrap();

        match output {
            StageOutput::Subtasks {
                content,
                subtasks,
                skip_reason,
            } => {
                assert!(content.contains("simple enough"));
                assert!(subtasks.is_empty());
                assert_eq!(
                    skip_reason,
                    Some("Task is simple enough to complete directly".to_string())
                );
            }
            _ => panic!("Expected Subtasks"),
        }
    }

    #[test]
    fn test_parse_failed() {
        let schema = test_schema("plan", false);
        let json = r#"{"type": "failed", "error": "Build error"}"#;
        let output = StageOutput::parse(json, &schema).unwrap();

        match output {
            StageOutput::Failed { error } => assert_eq!(error, "Build error"),
            _ => panic!("Expected Failed"),
        }
    }

    #[test]
    fn test_parse_blocked() {
        let schema = test_schema("plan", false);
        let json = r#"{"type": "blocked", "reason": "Waiting on API access"}"#;
        let output = StageOutput::parse(json, &schema).unwrap();

        match output {
            StageOutput::Blocked { reason } => assert_eq!(reason, "Waiting on API access"),
            _ => panic!("Expected Blocked"),
        }
    }

    #[test]
    fn test_schema_validation_rejects_invalid_type() {
        let schema = test_schema("plan", false);
        // "completed" is not in our schema's type enum
        let json = r#"{"type": "completed", "summary": "Done"}"#;
        let result = StageOutput::parse(json, &schema);

        assert!(matches!(result, Err(StageOutputError::SchemaValidation(_))));
        if let Err(StageOutputError::SchemaValidation(msg)) = result {
            assert!(
                msg.contains("completed"),
                "Error should mention invalid type"
            );
        }
    }

    #[test]
    fn test_schema_validation_rejects_wrong_artifact_type() {
        let schema = test_schema("plan", false);
        // "summary" is not valid for this stage (expects "plan")
        let json = r#"{"type": "summary", "content": "Work done"}"#;
        let result = StageOutput::parse(json, &schema);

        assert!(matches!(result, Err(StageOutputError::SchemaValidation(_))));
    }

    #[test]
    fn test_parse_missing_type() {
        let schema = test_schema("plan", false);
        let json = r#"{"content": "something"}"#;
        let result = StageOutput::parse(json, &schema);

        // Schema validation should catch missing "type"
        assert!(result.is_err());
    }

    #[test]
    fn test_parse_invalid_json() {
        let schema = test_schema("plan", false);
        let json = "not valid json";
        let result = StageOutput::parse(json, &schema);

        assert!(matches!(result, Err(StageOutputError::JsonParse(_))));
    }

    // Tests for parse_unvalidated (legacy compatibility)
    #[test]
    fn test_parse_unvalidated_artifact() {
        let json = r#"{"type": "myartifact", "content": "The content"}"#;
        let output = StageOutput::parse_unvalidated(json).unwrap();

        assert!(output.is_artifact());
        assert_eq!(output.artifact_content(), Some("The content"));
    }

    #[test]
    fn test_parse_unvalidated_subtasks_with_skip() {
        let json = r#"{
            "type": "subtasks",
            "content": "Breakdown skipped",
            "subtasks": [],
            "skip_reason": "Simple task"
        }"#;
        let output = StageOutput::parse_unvalidated(json).unwrap();

        match output {
            StageOutput::Subtasks {
                content,
                subtasks,
                skip_reason,
            } => {
                assert!(content.contains("skipped"));
                assert!(subtasks.is_empty());
                assert_eq!(skip_reason, Some("Simple task".to_string()));
            }
            _ => panic!("Expected Subtasks"),
        }
    }
}
