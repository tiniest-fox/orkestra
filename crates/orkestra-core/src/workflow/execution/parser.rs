//! Agent output parsing.
//!
//! Handles parsing of Claude Code output in various formats:
//! - JSON array (current Claude Code format)
//! - Newline-delimited JSON objects
//! - Single JSON object with `structured_output`
//! - Direct StageOutput JSON

use super::StageOutput;

/// Parse agent output into a StageOutput.
///
/// Claude outputs JSON in multiple formats:
/// 1. JSON array: All stream events in a single array (current Claude Code format)
/// 2. Newline-delimited JSON: One JSON object per line
/// 3. Single JSON object with `structured_output` field
/// 4. Direct StageOutput JSON
pub fn parse_agent_output(full_output: &str) -> Result<StageOutput, String> {
    let trimmed = full_output.trim();

    // Try to parse the whole output as JSON first
    if let Ok(v) = serde_json::from_str::<serde_json::Value>(trimmed) {
        if let Some(result) = extract_structured_output(&v) {
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
            if let Some(result) = extract_structured_output(&v) {
                return result;
            }
        }
    }

    // Fallback: try to parse the entire output as StageOutput directly
    StageOutput::parse(trimmed)
        .map_err(|e| format!("Failed to parse agent output: {e}"))
}

/// Extract structured output from a JSON value.
/// Handles arrays (searches for structured_output in elements) and objects.
fn extract_structured_output(v: &serde_json::Value) -> Option<Result<StageOutput, String>> {
    match v {
        // JSON array: search all elements for structured_output (check from end first)
        serde_json::Value::Array(arr) => {
            for item in arr.iter().rev() {
                if let Some(result) = extract_from_object(item) {
                    return Some(result);
                }
            }
            None
        }
        // JSON object: check directly
        serde_json::Value::Object(_) => extract_from_object(v),
        _ => None,
    }
}

/// Extract structured output from a JSON object.
fn extract_from_object(v: &serde_json::Value) -> Option<Result<StageOutput, String>> {
    // Check for structured_output field
    if let Some(structured) = v.get("structured_output") {
        if !structured.is_null() {
            let structured_str = structured.to_string();
            return Some(
                StageOutput::parse(&structured_str)
                    .map_err(|e| format!("Failed to parse structured_output: {e}"))
            );
        }
    }

    // Check for result field (older format)
    if let Some(result) = v.get("result") {
        if let Some(result_str) = result.as_str() {
            return Some(
                StageOutput::parse(result_str)
                    .map_err(|e| format!("Failed to parse result: {e}"))
            );
        }
    }

    // Check if this object itself is a valid StageOutput (has "type" field)
    if v.get("type").is_some() {
        let v_str = v.to_string();
        if let Ok(output) = StageOutput::parse(&v_str) {
            return Some(Ok(output));
        }
    }

    None
}

/// Extract session ID from JSON output.
/// Handles both single JSON objects and JSON arrays.
pub fn extract_session_id(json_str: &str) -> Option<String> {
    let v: serde_json::Value = serde_json::from_str(json_str.trim()).ok()?;

    match &v {
        // JSON array: search for session_id in any element
        serde_json::Value::Array(arr) => {
            for item in arr {
                if let Some(sid) = get_session_id_from_object(item) {
                    return Some(sid);
                }
            }
            None
        }
        // JSON object: check directly
        serde_json::Value::Object(_) => get_session_id_from_object(&v),
        _ => None,
    }
}

/// Extract session ID from a JSON object.
fn get_session_id_from_object(v: &serde_json::Value) -> Option<String> {
    // Try session_id field (snake_case)
    if let Some(sid) = v.get("session_id").and_then(|s| s.as_str()) {
        return Some(sid.to_string());
    }
    // Try sessionId field (camelCase)
    if let Some(sid) = v.get("sessionId").and_then(|s| s.as_str()) {
        return Some(sid.to_string());
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
    if v.get("error").is_none() {
        return None;
    }

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
{"structured_output": {"type": "completed", "summary": "Work done"}}"#;

        let result = parse_agent_output(output);
        assert!(result.is_ok());
        match result.unwrap() {
            StageOutput::Completed { summary } => assert_eq!(summary, "Work done"),
            _ => panic!("Expected Completed output"),
        }
    }

    #[test]
    fn test_parse_agent_output_artifact() {
        let output = r#"{"structured_output": {"type": "plan", "content": "The implementation plan"}}"#;

        let result = parse_agent_output(output);
        assert!(result.is_ok());
        match result.unwrap() {
            StageOutput::Artifact { content } => assert!(content.contains("implementation plan")),
            _ => panic!("Expected Artifact output"),
        }
    }

    #[test]
    fn test_parse_agent_output_direct_json() {
        let output = r#"{"type": "completed", "summary": "Done"}"#;

        let result = parse_agent_output(output);
        assert!(result.is_ok());
        match result.unwrap() {
            StageOutput::Completed { summary } => assert_eq!(summary, "Done"),
            _ => panic!("Expected Completed output"),
        }
    }

    #[test]
    fn test_parse_agent_output_json_array() {
        // Claude Code outputs a JSON array of stream events
        let output = r#"[{"type":"system","subtype":"init","session_id":"abc"},{"type":"assistant","message":"thinking..."},{"structured_output":{"type":"plan","content":"The plan content"}}]"#;

        let result = parse_agent_output(output);
        assert!(result.is_ok(), "Failed to parse: {:?}", result);
        match result.unwrap() {
            StageOutput::Artifact { content } => assert_eq!(content, "The plan content"),
            other => panic!("Expected Artifact output, got {:?}", other),
        }
    }

    #[test]
    fn test_parse_agent_output_json_array_completed() {
        let output = r#"[{"type":"system"},{"structured_output":{"type":"completed","summary":"All done"}}]"#;

        let result = parse_agent_output(output);
        assert!(result.is_ok());
        match result.unwrap() {
            StageOutput::Completed { summary } => assert_eq!(summary, "All done"),
            _ => panic!("Expected Completed output"),
        }
    }

    #[test]
    fn test_extract_session_id_from_object() {
        let json = r#"{"type":"system","subtype":"init","session_id":"abc-123"}"#;
        assert_eq!(extract_session_id(json), Some("abc-123".to_string()));
    }

    #[test]
    fn test_extract_session_id_camel_case() {
        let json = r#"{"type":"user","sessionId":"xyz-789"}"#;
        assert_eq!(extract_session_id(json), Some("xyz-789".to_string()));
    }

    #[test]
    fn test_extract_session_id_from_array() {
        let json = r#"[{"type":"other"},{"type":"system","subtype":"init","session_id":"found-it"}]"#;
        assert_eq!(extract_session_id(json), Some("found-it".to_string()));
    }

    #[test]
    fn test_extract_session_id_not_found() {
        let json = r#"{"type":"system","data":"no session"}"#;
        assert_eq!(extract_session_id(json), None);
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
}
