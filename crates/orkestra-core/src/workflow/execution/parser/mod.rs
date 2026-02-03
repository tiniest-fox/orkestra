//! Agent output parsing with provider-specific extraction.
//!
//! Two-layer parsing:
//! 1. **Provider-specific** (`AgentParser::extract_output`): Find the JSON in the
//!    provider's raw output format — handles `structured_output` wrapping (Claude)
//!    or text fallback (`OpenCode`).
//! 2. **Centralized generic** (`StageOutput::parse`): Interpret the JSON as a typed
//!    output (questions, artifact, failed, etc.) — one canonical location in `output.rs`.
//!
//! Stream parsing (line-by-line log extraction) is also provider-specific and lives
//! in each provider's `AgentParser` implementation.

mod claude;
mod opencode;

pub use claude::ClaudeAgentParser;
pub use opencode::OpenCodeAgentParser;

use super::StageOutput;
use crate::workflow::domain::LogEntry;

// ============================================================================
// AgentParser trait
// ============================================================================

/// Parsed result from a single stdout line during streaming.
pub struct ParsedUpdate {
    /// Log entries extracted from this line.
    pub log_entries: Vec<LogEntry>,
    /// Session ID extracted from the stream (populated once for providers like
    /// `OpenCode` that generate their own session IDs).
    pub session_id: Option<String>,
}

/// Provider-specific agent output parser.
///
/// Each provider implements this trait to handle:
/// - **Stream parsing**: Converting raw stdout lines into `LogEntry` values
/// - **Output extraction**: Finding the structured JSON in the provider's raw output
///
/// The trait does NOT interpret the JSON type (questions vs artifact vs failed) —
/// that happens in `StageOutput::parse()`, the single centralized location.
pub trait AgentParser: Send {
    /// Parse one stdout line during streaming.
    ///
    /// Returns log entries for the UI and an optional session ID (extracted once
    /// for providers that generate their own IDs).
    fn parse_line(&mut self, line: &str) -> ParsedUpdate;

    /// Flush any buffered entries when the stream ends.
    fn finalize(&mut self) -> Vec<LogEntry>;

    /// Extract the structured output JSON string from the provider's raw output.
    ///
    /// Returns the raw JSON string (e.g., `{"type":"questions","questions":[...]}`).
    /// Does NOT interpret the type — that's `StageOutput::parse()`'s job.
    fn extract_output(&self, full_output: &str) -> Result<String, String>;
}

// ============================================================================
// Generic completion handler
// ============================================================================

/// Parse a completed agent's output into a `StageOutput`.
///
/// This is the single entry point for completion parsing:
/// 1. Calls `parser.extract_output()` (provider-specific JSON extraction)
/// 2. Calls `StageOutput::parse()` (centralized type interpretation)
pub fn parse_completion(
    parser: &dyn AgentParser,
    full_output: &str,
    schema: &serde_json::Value,
) -> Result<StageOutput, String> {
    let json_str = parser.extract_output(full_output)?;
    StageOutput::parse(&json_str, schema).map_err(|e| e.to_string())
}

// ============================================================================
// Shared extraction helpers
// ============================================================================

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

/// Extract structured output JSON from a JSONL stream.
///
/// Searches the full output for lines containing `structured_output` or `result`
/// fields, handling:
/// - JSON arrays of stream events
/// - Newline-delimited JSON objects
/// - Single JSON objects
/// - Stream-json wrapping (`{content, type}` inside `structured_output`)
///
/// Returns the extracted JSON string, or None if no structured output was found.
pub(super) fn extract_from_jsonl(full_output: &str) -> Option<String> {
    let trimmed = full_output.trim();

    if trimmed.is_empty() {
        return None;
    }

    // Try to parse the whole output as JSON first
    if let Ok(v) = serde_json::from_str::<serde_json::Value>(trimmed) {
        if let Some(json_str) = extract_structured_output_json(&v) {
            return Some(json_str);
        }
    }

    // Try newline-delimited JSON (search from end for most recent)
    for line in trimmed.lines().rev() {
        let line = line.trim();
        if line.is_empty() {
            continue;
        }

        if let Ok(v) = serde_json::from_str::<serde_json::Value>(line) {
            if let Some(json_str) = extract_structured_output_json(&v) {
                return Some(json_str);
            }
        }
    }

    None
}

/// Extract structured output JSON string from a JSON value.
///
/// Handles arrays (searches for `structured_output` in elements) and objects.
/// Returns the raw JSON string of the extracted output.
fn extract_structured_output_json(v: &serde_json::Value) -> Option<String> {
    match v {
        // JSON array: search all elements for structured_output (check from end first)
        serde_json::Value::Array(arr) => {
            for item in arr.iter().rev() {
                if let Some(json_str) = extract_from_object_json(item) {
                    return Some(json_str);
                }
            }
            None
        }
        // JSON object: check directly
        serde_json::Value::Object(_) => extract_from_object_json(v),
        _ => None,
    }
}

/// Extract structured output JSON string from a JSON object.
fn extract_from_object_json(v: &serde_json::Value) -> Option<String> {
    // Check for structured_output field
    if let Some(structured) = v.get("structured_output") {
        if !structured.is_null() {
            // In stream-json mode, Claude Code's StructuredOutput tool wraps the actual
            // output in {"content": "<json string>", "type": "<label>"}. The real output
            // is serialized inside the `content` field. Try parsing it first.
            if let Some(content_str) = structured.get("content").and_then(|c| c.as_str()) {
                // Verify it's valid JSON before returning
                if serde_json::from_str::<serde_json::Value>(content_str).is_ok() {
                    return Some(content_str.to_string());
                }
            }

            // Fall back to the structured_output value itself (works for json mode
            // where the output is not wrapped)
            return Some(structured.to_string());
        }
    }

    // Check for result field (older format)
    if let Some(result) = v.get("result") {
        if let Some(result_str) = result.as_str() {
            // Strip markdown code fences if present
            let cleaned = strip_markdown_code_fences(result_str);
            // Verify it's valid JSON
            if serde_json::from_str::<serde_json::Value>(&cleaned).is_ok() {
                return Some(cleaned);
            }
        }
    }

    None
}

// ============================================================================
// Tests
// ============================================================================

#[cfg(test)]
mod tests {
    use super::*;

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
    fn test_extract_from_jsonl_structured_output() {
        let output = r#"{"type":"system","subtype":"init","session_id":"abc"}
{"structured_output":{"type":"summary","content":"All done"}}"#;
        let result = extract_from_jsonl(output);
        assert!(result.is_some());
        let json: serde_json::Value = serde_json::from_str(&result.unwrap()).unwrap();
        assert_eq!(json["type"], "summary");
        assert_eq!(json["content"], "All done");
    }

    #[test]
    fn test_extract_from_jsonl_stream_json_unwrap() {
        // stream-json wraps in {content: "<json string>", type: "<label>"}
        let output = r#"{"type":"result","structured_output":{"content":"{\"type\":\"questions\",\"questions\":[{\"question\":\"What?\"}]}","type":"plan"}}"#;
        let result = extract_from_jsonl(output);
        assert!(result.is_some());
        let json: serde_json::Value = serde_json::from_str(&result.unwrap()).unwrap();
        assert_eq!(json["type"], "questions");
    }

    #[test]
    fn test_extract_from_jsonl_json_array() {
        let output =
            r#"[{"type":"system"},{"structured_output":{"type":"plan","content":"The plan"}}]"#;
        let result = extract_from_jsonl(output);
        assert!(result.is_some());
        let json: serde_json::Value = serde_json::from_str(&result.unwrap()).unwrap();
        assert_eq!(json["type"], "plan");
    }

    #[test]
    fn test_extract_from_jsonl_empty() {
        assert!(extract_from_jsonl("").is_none());
        assert!(extract_from_jsonl("   ").is_none());
    }

    #[test]
    fn test_extract_from_jsonl_bare_type_ignored() {
        // Bare objects with just a "type" field should NOT be extracted —
        // they could be stream events (e.g., OpenCode's step_finish).
        // Valid extraction requires structured_output or result fields.
        let output = r#"{"type":"summary","content":"Done"}"#;
        let result = extract_from_jsonl(output);
        assert!(result.is_none());
    }

    #[test]
    fn test_extract_from_jsonl_result_field_with_fences() {
        let output = r#"[{"type":"result","result":"```json\n{\"type\": \"myartifact\", \"content\": \"done\"}\n```"}]"#;
        let result = extract_from_jsonl(output);
        assert!(result.is_some());
        let json: serde_json::Value = serde_json::from_str(&result.unwrap()).unwrap();
        assert_eq!(json["content"], "done");
    }
}
