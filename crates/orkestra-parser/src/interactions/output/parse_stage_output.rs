//! Parse and validate stage output against a JSON schema.

use jsonschema::Validator;

use crate::types::{QuestionJson, StageOutput, StageOutputError, SubtaskOutput};

/// Parse and validate stage output against a JSON schema.
///
/// The schema is the single source of truth - it's the same schema
/// we send to Claude via `--json-schema`. This ensures consistency
/// between what we tell agents is valid and what we accept.
pub fn execute(json: &str, schema: &serde_json::Value) -> Result<StageOutput, StageOutputError> {
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

    parse_from_json(&value)
}

// -- Helpers --

/// Extract typed `StageOutput` from a validated JSON value.
fn parse_from_json(value: &serde_json::Value) -> Result<StageOutput, StageOutputError> {
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

            let subtasks: Vec<SubtaskOutput> = serde_json::from_value(value["subtasks"].clone())
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

        // Any other type is an artifact (the schema validated the type is in the enum)
        _ => Ok(StageOutput::Artifact {
            content: value["content"]
                .as_str()
                .ok_or_else(|| StageOutputError::MissingField("content".into()))?
                .to_string(),
            activity_log: value["activity_log"].as_str().map(String::from),
        }),
    }
}

// ============================================================================
// Tests
// ============================================================================

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
            json!("approval"),
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
                "decision": { "type": "string" },
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
        let output = execute(json, &schema).unwrap();

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
        let output = execute(json, &schema).unwrap();

        assert!(output.is_questions());
        let questions = output.questions().unwrap();
        assert_eq!(questions.len(), 1);
        assert_eq!(questions[0].question, "What framework?");
    }

    #[test]
    fn test_parse_approval() {
        let schema = test_schema("plan", false);
        let json = r#"{"type": "approval", "decision": "approve", "content": "Looks good"}"#;
        let output = execute(json, &schema).unwrap();

        assert!(output.is_approval());
        match output {
            StageOutput::Approval {
                decision, content, ..
            } => {
                assert_eq!(decision, "approve");
                assert_eq!(content, "Looks good");
            }
            _ => panic!("Expected Approval"),
        }
    }

    #[test]
    fn test_parse_approval_reject() {
        let schema = test_schema("plan", false);
        let json = r#"{"type": "approval", "decision": "reject", "content": "Tests are failing"}"#;
        let output = execute(json, &schema).unwrap();

        match output {
            StageOutput::Approval {
                decision, content, ..
            } => {
                assert_eq!(decision, "reject");
                assert_eq!(content, "Tests are failing");
            }
            _ => panic!("Expected Approval"),
        }
    }

    #[test]
    fn test_parse_subtasks() {
        let schema = test_schema("breakdown", true);
        let json = r#"{
            "type": "subtasks",
            "content": "The technical design content",
            "subtasks": [
                {"title": "Task 1", "description": "Do first thing", "detailed_instructions": "Implement first thing"},
                {"title": "Task 2", "description": "Do second thing", "detailed_instructions": "Implement second thing", "depends_on": [0]}
            ]
        }"#;
        let output = execute(json, &schema).unwrap();

        match output {
            StageOutput::Subtasks {
                content,
                subtasks,
                skip_reason,
                ..
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
        let output = execute(json, &schema).unwrap();

        match output {
            StageOutput::Subtasks {
                content,
                subtasks,
                skip_reason,
                ..
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
        let output = execute(json, &schema).unwrap();

        match output {
            StageOutput::Failed { error } => assert_eq!(error, "Build error"),
            _ => panic!("Expected Failed"),
        }
    }

    #[test]
    fn test_parse_blocked() {
        let schema = test_schema("plan", false);
        let json = r#"{"type": "blocked", "reason": "Waiting on API access"}"#;
        let output = execute(json, &schema).unwrap();

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
        let result = execute(json, &schema);

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
        let result = execute(json, &schema);

        assert!(matches!(result, Err(StageOutputError::SchemaValidation(_))));
    }

    #[test]
    fn test_parse_missing_type() {
        let schema = test_schema("plan", false);
        let json = r#"{"content": "something"}"#;
        let result = execute(json, &schema);

        // Schema validation should catch missing "type"
        assert!(result.is_err());
    }

    #[test]
    fn test_parse_invalid_json() {
        let schema = test_schema("plan", false);
        let json = "not valid json";
        let result = execute(json, &schema);

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
                ..
            } => {
                assert!(content.contains("skipped"));
                assert!(subtasks.is_empty());
                assert_eq!(skip_reason, Some("Simple task".to_string()));
            }
            _ => panic!("Expected Subtasks"),
        }
    }
}
