//! Agent output parsing.
//!
//! Handles parsing of Claude Code output in various formats:
//! - JSON array (current Claude Code format)
//! - Newline-delimited JSON objects
//! - Single JSON object with `structured_output`
//! - Direct `StageOutput` JSON
//!
//! When a schema is provided, output is validated against it (schema-driven validation).
//! Without a schema, basic parsing is done without type validation.

use super::StageOutput;

/// Strip markdown code fences from a string.
///
/// Handles patterns like:
/// - ```json\n{...}\n```
/// - ```\n{...}\n```
pub fn strip_markdown_code_fences(s: &str) -> String {
    let trimmed = s.trim();

    // Check if it starts with ``` and ends with ```
    if trimmed.starts_with("```") && trimmed.ends_with("```") {
        // Find the end of the opening fence line
        let start = trimmed.find('\n').map_or(3, |i| i + 1);
        // Find the start of the closing fence
        let end = trimmed.rfind("\n```").unwrap_or(trimmed.len() - 3);

        if start < end {
            return trimmed[start..end].trim().to_string();
        }
    }

    trimmed.to_string()
}

/// Parse agent output into a `StageOutput`.
///
/// Claude outputs JSON in multiple formats:
/// 1. JSON array: All stream events in a single array (current Claude Code format)
/// 2. Newline-delimited JSON: One JSON object per line
/// 3. Single JSON object with `structured_output` field
/// 4. Direct `StageOutput` JSON
///
/// When a schema is provided, the output is validated against it. This is the
/// recommended usage - the same schema sent to Claude is used to validate the response.
///
/// # Arguments
/// * `full_output` - The raw output from Claude
/// * `schema` - Optional JSON schema for validation (same schema sent to Claude)
pub fn parse_agent_output(
    full_output: &str,
    schema: Option<&serde_json::Value>,
) -> Result<StageOutput, String> {
    let trimmed = full_output.trim();

    // Check for empty output first
    if trimmed.is_empty() {
        return Err("Agent produced no output (process may have exited unexpectedly)".to_string());
    }

    // Check for API error in the last line (fallback for streaming detection)
    // API errors cause Claude to exit, so the error is always at the end
    if let Some(last_line) = trimmed.lines().next_back() {
        if let Some(error_msg) = check_for_api_error(last_line.trim()) {
            return Err(format!("API error: {error_msg}"));
        }
    }

    // Try to parse the whole output as JSON first
    if let Ok(v) = serde_json::from_str::<serde_json::Value>(trimmed) {
        if let Some(result) = extract_structured_output(&v, schema) {
            return result;
        }
    }

    // Try newline-delimited JSON (search from end for most recent)
    for line in trimmed.lines().rev() {
        let line = line.trim();
        if line.is_empty() {
            continue;
        }

        if let Ok(v) = serde_json::from_str::<serde_json::Value>(line) {
            if let Some(result) = extract_structured_output(&v, schema) {
                return result;
            }
        }
    }

    // Fallback: try to parse the entire output as StageOutput directly
    parse_json_output(trimmed, schema).map_err(|e| format!("Failed to parse agent output: {e}"))
}

/// Parse agent output with text fallback for providers without native `structured_output` events.
///
/// 1. Tries raw JSONL via [`parse_agent_output`] (works for Claude Code).
/// 2. Falls back to parsing `last_text` directly as a `StageOutput` (works for OpenCode
///    where the structured JSON is in `text` events, not a dedicated JSONL field).
///
/// Markdown code fences are stripped from `last_text` before parsing since agents
/// sometimes wrap JSON output in fences despite instructions.
pub fn parse_output_with_text_fallback(
    full_output: &str,
    last_text: Option<&str>,
    schema: Option<&serde_json::Value>,
) -> Result<StageOutput, String> {
    let raw_result = parse_agent_output(full_output, schema);
    if raw_result.is_ok() {
        return raw_result;
    }

    // Fall back: strip markdown fences from last text, parse directly as StageOutput
    if let Some(text) = last_text {
        let stripped = strip_markdown_code_fences(text);
        let text_result = match schema {
            Some(s) => StageOutput::parse(&stripped, s).map_err(|e| e.to_string()),
            None => StageOutput::parse_unvalidated(&stripped).map_err(|e| e.to_string()),
        };
        if text_result.is_ok() {
            return text_result;
        }
    }

    raw_result
}

/// Parse a JSON string as `StageOutput` with optional schema validation.
fn parse_json_output(
    json: &str,
    schema: Option<&serde_json::Value>,
) -> Result<StageOutput, String> {
    match schema {
        Some(s) => StageOutput::parse(json, s).map_err(|e| e.to_string()),
        None => StageOutput::parse_unvalidated(json).map_err(|e| e.to_string()),
    }
}

/// Extract structured output from a JSON value.
/// Handles arrays (searches for `structured_output` in elements) and objects.
fn extract_structured_output(
    v: &serde_json::Value,
    schema: Option<&serde_json::Value>,
) -> Option<Result<StageOutput, String>> {
    match v {
        // JSON array: search all elements for structured_output (check from end first)
        serde_json::Value::Array(arr) => {
            for item in arr.iter().rev() {
                if let Some(result) = extract_from_object(item, schema) {
                    return Some(result);
                }
            }
            None
        }
        // JSON object: check directly
        serde_json::Value::Object(_) => extract_from_object(v, schema),
        _ => None,
    }
}

/// Extract structured output from a JSON object.
fn extract_from_object(
    v: &serde_json::Value,
    schema: Option<&serde_json::Value>,
) -> Option<Result<StageOutput, String>> {
    // Check for structured_output field
    if let Some(structured) = v.get("structured_output") {
        if !structured.is_null() {
            let structured_str = structured.to_string();
            return Some(
                parse_json_output(&structured_str, schema)
                    .map_err(|e| format!("Failed to parse structured_output: {e}")),
            );
        }
    }

    // Check for result field (older format)
    if let Some(result) = v.get("result") {
        if let Some(result_str) = result.as_str() {
            // Strip markdown code fences if present
            let cleaned = strip_markdown_code_fences(result_str);
            return Some(
                parse_json_output(&cleaned, schema)
                    .map_err(|e| format!("Failed to parse result: {e}")),
            );
        }
    }

    // Check if this object itself is a valid StageOutput (has "type" field)
    if v.get("type").is_some() {
        let v_str = v.to_string();
        if let Ok(output) = parse_json_output(&v_str, schema) {
            return Some(Ok(output));
        }
    }

    None
}

/// Check if a stream line contains an API error.
///
/// Returns the error message if found, None otherwise.
/// API errors appear as assistant messages with an `error` field present.
pub fn check_for_api_error(line: &str) -> Option<String> {
    let v: serde_json::Value = serde_json::from_str(line).ok()?;

    // Only check assistant messages
    if v.get("type").and_then(|t| t.as_str()) != Some("assistant") {
        return None;
    }

    // If there's an error field (not null), this is an API error
    v.get("error")?;

    // Extract error message from message.content[0].text
    let error_text = v
        .get("message")
        .and_then(|m| m.get("content"))
        .and_then(|c| c.as_array())
        .and_then(|arr| arr.first())
        .and_then(|item| item.get("text"))
        .and_then(|t| t.as_str())
        .unwrap_or("Unknown API error");

    Some(error_text.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_parse_agent_output_structured() {
        let output = r#"{"type": "system", "subtype": "init", "session_id": "abc"}
{"structured_output": {"type": "summary", "content": "Work done"}}"#;

        let result = parse_agent_output(output, None);
        assert!(result.is_ok());
        match result.unwrap() {
            StageOutput::Artifact { content } => assert_eq!(content, "Work done"),
            _ => panic!("Expected Artifact output"),
        }
    }

    #[test]
    fn test_parse_agent_output_artifact() {
        let output =
            r#"{"structured_output": {"type": "plan", "content": "The implementation plan"}}"#;

        let result = parse_agent_output(output, None);
        assert!(result.is_ok());
        match result.unwrap() {
            StageOutput::Artifact { content } => assert!(content.contains("implementation plan")),
            _ => panic!("Expected Artifact output"),
        }
    }

    #[test]
    fn test_parse_agent_output_direct_json() {
        let output = r#"{"type": "summary", "content": "Done"}"#;

        let result = parse_agent_output(output, None);
        assert!(result.is_ok());
        match result.unwrap() {
            StageOutput::Artifact { content } => assert_eq!(content, "Done"),
            _ => panic!("Expected Artifact output"),
        }
    }

    #[test]
    fn test_parse_agent_output_json_array() {
        // Claude Code outputs a JSON array of stream events
        let output = r#"[{"type":"system","subtype":"init","session_id":"abc"},{"type":"assistant","message":"thinking..."},{"structured_output":{"type":"plan","content":"The plan content"}}]"#;

        let result = parse_agent_output(output, None);
        assert!(result.is_ok(), "Failed to parse: {result:?}");
        match result.unwrap() {
            StageOutput::Artifact { content } => assert_eq!(content, "The plan content"),
            other => panic!("Expected Artifact output, got {other:?}"),
        }
    }

    #[test]
    fn test_parse_agent_output_json_array_artifact() {
        let output =
            r#"[{"type":"system"},{"structured_output":{"type":"summary","content":"All done"}}]"#;

        let result = parse_agent_output(output, None);
        assert!(result.is_ok());
        match result.unwrap() {
            StageOutput::Artifact { content } => assert_eq!(content, "All done"),
            _ => panic!("Expected Artifact output"),
        }
    }

    #[test]
    fn test_check_for_api_error_detected() {
        let line = r#"{"type":"assistant","error":"unknown","message":{"content":[{"text":"API rate limit exceeded"}]}}"#;
        let result = check_for_api_error(line);
        assert_eq!(result, Some("API rate limit exceeded".to_string()));
    }

    #[test]
    fn test_check_for_api_error_no_error() {
        let line = r#"{"type":"assistant","message":{"content":[{"text":"Hello"}]}}"#;
        let result = check_for_api_error(line);
        assert!(result.is_none());
    }

    #[test]
    fn test_check_for_api_error_wrong_type() {
        let line = r#"{"type":"system","error":"some error"}"#;
        let result = check_for_api_error(line);
        assert!(result.is_none());
    }

    #[test]
    fn test_check_for_api_error_invalid_json() {
        let line = "not json at all";
        let result = check_for_api_error(line);
        assert!(result.is_none());
    }

    #[test]
    fn test_strip_markdown_code_fences() {
        let input = "```json\n{\"type\": \"skip_breakdown\"}\n```";
        let result = strip_markdown_code_fences(input);
        assert_eq!(result, "{\"type\": \"skip_breakdown\"}");
    }

    #[test]
    fn test_strip_markdown_code_fences_no_lang() {
        let input = "```\n{\"type\": \"approved\"}\n```";
        let result = strip_markdown_code_fences(input);
        assert_eq!(result, "{\"type\": \"approved\"}");
    }

    #[test]
    fn test_strip_markdown_code_fences_none() {
        let input = "{\"type\": \"summary\", \"content\": \"done\"}";
        let result = strip_markdown_code_fences(input);
        assert_eq!(result, input);
    }

    #[test]
    fn test_parse_result_with_markdown_fences() {
        // This simulates what we get from Claude's result field
        // Now with the unified schema system, arbitrary artifact types work
        let output = r#"[{"type":"result","result":"```json\n{\"type\": \"myartifact\", \"content\": \"done\"}\n```"}]"#;

        let result = parse_agent_output(output, None);
        assert!(result.is_ok(), "Failed to parse: {result:?}");
        match result.unwrap() {
            StageOutput::Artifact { content } => assert_eq!(content, "done"),
            other => panic!("Expected Artifact output, got {other:?}"),
        }
    }

    #[test]
    fn test_parse_agent_output_empty() {
        let result = parse_agent_output("", None);
        assert!(result.is_err());
        assert!(result.unwrap_err().contains("no output"));
    }

    #[test]
    fn test_parse_agent_output_whitespace_only() {
        let result = parse_agent_output("   \n\t\n  ", None);
        assert!(result.is_err());
        assert!(result.unwrap_err().contains("no output"));
    }

    #[test]
    fn test_parse_agent_output_api_error_in_output() {
        // API error that might not be caught during streaming
        let output = r#"{"type":"assistant","error":"invalid_request","message":{"content":[{"type":"text","text":"Prompt is too long"}]}}"#;
        let result = parse_agent_output(output, None);
        assert!(result.is_err());
        let err = result.unwrap_err();
        assert!(err.contains("API error"), "Expected API error, got: {err}");
        assert!(
            err.contains("Prompt is too long"),
            "Expected 'Prompt is too long', got: {err}"
        );
    }

    #[test]
    fn test_parse_agent_output_api_error_after_init() {
        // API error after init message (Claude exits on error, so error is last)
        let output = r#"{"type":"system","subtype":"init","session_id":"abc"}
{"type":"assistant","error":"invalid_request","message":{"content":[{"type":"text","text":"Rate limit exceeded"}]}}"#;
        let result = parse_agent_output(output, None);
        assert!(result.is_err());
        let err = result.unwrap_err();
        assert!(
            err.contains("Rate limit exceeded"),
            "Expected rate limit error, got: {err}"
        );
    }

    // ========================================================================
    // parse_output_with_text_fallback tests
    // ========================================================================

    #[test]
    fn test_fallback_claude_structured_output_no_last_text() {
        // Claude Code: raw JSONL has structured_output, no last text needed
        let output = r#"{"type":"system","subtype":"init","session_id":"abc"}
{"structured_output":{"type":"summary","content":"All done"}}"#;
        let result = parse_output_with_text_fallback(output, None, None);
        assert!(result.is_ok(), "Expected success, got: {result:?}");
        match result.unwrap() {
            StageOutput::Artifact { content } => assert_eq!(content, "All done"),
            other => panic!("Expected Artifact, got {other:?}"),
        }
    }

    #[test]
    fn test_fallback_opencode_last_text_json() {
        // OpenCode: raw JSONL has no structured_output, but last text has the JSON
        let output = r#"{"type":"step_start","part":{"type":"step-start"}}
{"type":"text","part":{"text":"Let me check..."}}
{"type":"tool_use","part":{"tool":"bash","callID":"0","state":{"input":{"command":"ls"},"output":"file1.rs"}}}
{"type":"text","part":{"text":"{\"type\":\"artifact\",\"content\":\"Found 1 file\"}"}}
{"type":"step_finish","part":{"type":"step-finish","reason":"stop"}}"#;

        let last_text = r#"{"type":"artifact","content":"Found 1 file"}"#;

        let result = parse_output_with_text_fallback(output, Some(last_text), None);
        assert!(result.is_ok(), "Expected success, got: {result:?}");
        match result.unwrap() {
            StageOutput::Artifact { content } => assert_eq!(content, "Found 1 file"),
            other => panic!("Expected Artifact, got {other:?}"),
        }
    }

    #[test]
    fn test_fallback_last_text_with_markdown_fences() {
        // Agent wraps JSON in markdown fences despite instructions
        let output = r#"{"type":"text","part":{"text":"some stuff"}}"#;
        let last_text = "```json\n{\"type\":\"summary\",\"content\":\"Done\"}\n```";

        let result = parse_output_with_text_fallback(output, Some(last_text), None);
        assert!(result.is_ok(), "Expected success, got: {result:?}");
        match result.unwrap() {
            StageOutput::Artifact { content } => assert_eq!(content, "Done"),
            other => panic!("Expected Artifact, got {other:?}"),
        }
    }

    #[test]
    fn test_fallback_last_text_not_json() {
        // Both raw output and last text are not parseable — returns original error
        let output = r#"{"type":"text","part":{"text":"I couldn't complete the task"}}"#;
        let last_text = "I couldn't complete the task";

        let result = parse_output_with_text_fallback(output, Some(last_text), None);
        assert!(result.is_err());
    }

    #[test]
    fn test_fallback_no_last_text_fails() {
        // Raw output fails, no last text — returns error
        let output = r#"{"type":"step_start","part":{"type":"step-start"}}
{"type":"step_finish","part":{"type":"step-finish","reason":"stop"}}"#;

        let result = parse_output_with_text_fallback(output, None, None);
        assert!(result.is_err());
    }
}
