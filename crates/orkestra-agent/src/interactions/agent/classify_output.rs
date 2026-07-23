//! Classify agent output into success, extraction failure, plain text, or parse failure.

use orkestra_parser::interactions::output::parse_stage_output;
use orkestra_parser::{AgentParser, ExtractionResult, StageOutput};

/// Four-way classification of agent output.
#[derive(Debug, Clone)]
pub enum OutputClassification {
    /// Agent produced valid structured output.
    Success(StageOutput),
    /// Extraction encountered an error (API error, empty output, etc.). No retry.
    ExtractionFailed(String),
    /// Agent produced plain text with no structured output.
    PlainText(String),
    /// Structured output was extracted but failed schema validation or parsing.
    ParseFailed(String),
}

pub fn execute(
    parser: &dyn AgentParser,
    full_output: &str,
    schema: Option<&serde_json::Value>,
) -> OutputClassification {
    // Step 1: extract structured output from raw stream
    let json_str = match parser.extract_output(full_output) {
        ExtractionResult::Found(s) => s,
        ExtractionResult::NotFound => {
            return OutputClassification::PlainText(full_output.to_string())
        }
        ExtractionResult::Error(e) => return OutputClassification::ExtractionFailed(e),
        ExtractionResult::Malformed(msg) => return OutputClassification::ParseFailed(msg),
    };

    // Step 2: parse and validate the extracted JSON
    let result = match schema {
        Some(s) => parse_stage_output::execute(&json_str, s).map_err(|e| e.to_string()),
        None => StageOutput::parse_unvalidated(&json_str).map_err(|e| e.to_string()),
    };

    match result {
        Ok(output) => OutputClassification::Success(output),
        Err(e) => OutputClassification::ParseFailed(e),
    }
}

// ============================================================================
// Tests
// ============================================================================

#[cfg(test)]
mod tests {
    use orkestra_parser::ExtractionResult;

    use super::super::test_support::MockParser;
    use super::*;

    #[test]
    fn extraction_error_returns_extraction_failed() {
        let parser = MockParser {
            extract_result: ExtractionResult::Error("API error: rate limit".to_string()),
        };
        let schema = serde_json::json!({"type": "object"});

        let result = execute(&parser, "just prose output", Some(&schema));

        assert!(
            matches!(result, OutputClassification::ExtractionFailed(_)),
            "expected ExtractionFailed, got: {result:?}"
        );
    }

    #[test]
    fn extraction_not_found_returns_plain_text() {
        let parser = MockParser {
            extract_result: ExtractionResult::NotFound,
        };
        let schema = serde_json::json!({"type": "object"});

        let result = execute(&parser, "just prose output", Some(&schema));

        assert!(
            matches!(result, OutputClassification::PlainText(_)),
            "expected PlainText, got: {result:?}"
        );
    }

    #[test]
    fn parse_failure_after_extraction_returns_parse_failed() {
        let parser = MockParser {
            extract_result: ExtractionResult::Found(
                r#"{"type": "unknown_type_not_in_schema"}"#.to_string(),
            ),
        };
        let schema = serde_json::json!({
            "type": "object",
            "properties": {
                "type": {"type": "string", "enum": ["summary"]}
            },
            "required": ["type"]
        });

        let result = execute(&parser, "some output", Some(&schema));

        assert!(
            matches!(result, OutputClassification::ParseFailed(_)),
            "expected ParseFailed, got: {result:?}"
        );
    }

    #[test]
    fn valid_output_with_schema_returns_success() {
        let parser = MockParser {
            extract_result: ExtractionResult::Found(
                r#"{"type": "summary", "content": "done"}"#.to_string(),
            ),
        };
        let schema = serde_json::json!({
            "type": "object",
            "properties": {
                "type": {"type": "string", "enum": ["summary"]},
                "content": {"type": "string"}
            },
            "required": ["type"]
        });

        let result = execute(&parser, "some output", Some(&schema));

        assert!(
            matches!(result, OutputClassification::Success(_)),
            "expected Success, got: {result:?}"
        );
    }

    #[test]
    fn valid_output_without_schema_returns_success() {
        let parser = MockParser {
            extract_result: ExtractionResult::Found(
                r#"{"type": "summary", "content": "done"}"#.to_string(),
            ),
        };

        let result = execute(&parser, "some output", None);

        assert!(
            matches!(result, OutputClassification::Success(_)),
            "expected Success without schema, got: {result:?}"
        );
    }

    #[test]
    fn malformed_extraction_returns_parse_failed() {
        let parser = MockParser {
            extract_result: ExtractionResult::Malformed("Multiple ork fences".to_string()),
        };
        let schema = serde_json::json!({"type": "object"});
        let result = execute(&parser, "some output", Some(&schema));
        assert!(
            matches!(result, OutputClassification::ParseFailed(_)),
            "expected ParseFailed, got: {result:?}"
        );
    }

    #[test]
    fn invalid_json_without_schema_returns_parse_failed() {
        let parser = MockParser {
            extract_result: ExtractionResult::Found("not valid json at all".to_string()),
        };

        let result = execute(&parser, "some output", None);

        assert!(
            matches!(result, OutputClassification::ParseFailed(_)),
            "expected ParseFailed for invalid JSON, got: {result:?}"
        );
    }

    #[test]
    fn vibe_schema_rejects_artifact_type() {
        let schema = serde_json::json!({
            "type": "object",
            "properties": {
                "type": {"type": "string", "enum": ["proposed_exit", "questions", "failed", "blocked"]}
            },
            "required": ["type"]
        });
        let parser = MockParser {
            extract_result: ExtractionResult::Found(
                r#"{"type": "plan", "content": "some plan"}"#.to_string(),
            ),
        };
        let result = execute(&parser, "output", Some(&schema));
        assert!(
            matches!(result, OutputClassification::ParseFailed(_)),
            "vibe schema should reject artifact-like types, got: {result:?}"
        );
    }

    #[test]
    fn vibe_schema_accepts_proposed_exit() {
        let schema = serde_json::json!({
            "type": "object",
            "properties": {
                "type": {"type": "string", "enum": ["proposed_exit", "questions", "failed", "blocked"]},
                "destination": {"type": "string"},
                "rationale": {"type": "string"}
            },
            "required": ["type"]
        });
        let parser = MockParser {
            extract_result: ExtractionResult::Found(
                r#"{"type": "proposed_exit", "destination": "work", "rationale": "done"}"#
                    .to_string(),
            ),
        };
        let result = execute(&parser, "output", Some(&schema));
        assert!(
            matches!(result, OutputClassification::Success(_)),
            "vibe schema should accept proposed_exit, got: {result:?}"
        );
    }
}
