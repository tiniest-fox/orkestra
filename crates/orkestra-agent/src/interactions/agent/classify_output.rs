//! Classify agent output into success, extraction failure, or parse failure.

use orkestra_parser::interactions::output::parse_stage_output;
use orkestra_parser::{AgentParser, StageOutput};

/// Three-way classification of agent output.
#[derive(Debug, Clone)]
pub enum OutputClassification {
    /// Agent produced valid structured output.
    Success(StageOutput),
    /// No structured output could be extracted (agent crashed, produced prose, or errored).
    ExtractionFailed(String),
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
        Ok(s) => s,
        Err(e) => return OutputClassification::ExtractionFailed(e),
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
    use orkestra_parser::types::ParsedUpdate;
    use orkestra_types::domain::LogEntry;

    use super::*;

    struct MockParser {
        extract_result: Result<String, String>,
    }

    impl AgentParser for MockParser {
        fn parse_line(&mut self, _line: &str) -> ParsedUpdate {
            ParsedUpdate {
                log_entries: Vec::new(),
                session_id: None,
            }
        }
        fn finalize(&mut self) -> Vec<LogEntry> {
            Vec::new()
        }
        fn extract_output(&self, _full_output: &str) -> Result<String, String> {
            self.extract_result.clone()
        }
    }

    #[test]
    fn extraction_failure_returns_extraction_failed() {
        let parser = MockParser {
            extract_result: Err("no structured output found".to_string()),
        };
        let schema = serde_json::json!({"type": "object"});

        let result = execute(&parser, "just prose output", Some(&schema));

        assert!(
            matches!(result, OutputClassification::ExtractionFailed(_)),
            "expected ExtractionFailed, got: {result:?}"
        );
    }

    #[test]
    fn parse_failure_after_extraction_returns_parse_failed() {
        let parser = MockParser {
            extract_result: Ok(r#"{"type": "unknown_type_not_in_schema"}"#.to_string()),
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
            extract_result: Ok(r#"{"type": "summary", "content": "done"}"#.to_string()),
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
            extract_result: Ok(r#"{"type": "summary", "content": "done"}"#.to_string()),
        };

        let result = execute(&parser, "some output", None);

        assert!(
            matches!(result, OutputClassification::Success(_)),
            "expected Success without schema, got: {result:?}"
        );
    }

    #[test]
    fn invalid_json_without_schema_returns_parse_failed() {
        let parser = MockParser {
            extract_result: Ok("not valid json at all".to_string()),
        };

        let result = execute(&parser, "some output", None);

        assert!(
            matches!(result, OutputClassification::ParseFailed(_)),
            "expected ParseFailed for invalid JSON, got: {result:?}"
        );
    }
}
