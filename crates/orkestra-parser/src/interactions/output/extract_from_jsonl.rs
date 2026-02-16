//! Extract structured output JSON from a JSONL stream.

use super::strip_markdown_fences;

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
pub fn execute(full_output: &str) -> Option<String> {
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

// -- Helpers --

/// Extract structured output JSON string from a JSON value.
///
/// Handles arrays (searches for `structured_output` in elements) and objects.
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
            let cleaned = strip_markdown_fences::execute(result_str);
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
    fn test_extract_from_jsonl_structured_output() {
        let output = r#"{"type":"system","subtype":"init","session_id":"abc"}
{"structured_output":{"type":"summary","content":"All done"}}"#;
        let result = execute(output);
        assert!(result.is_some());
        let json: serde_json::Value = serde_json::from_str(&result.unwrap()).unwrap();
        assert_eq!(json["type"], "summary");
        assert_eq!(json["content"], "All done");
    }

    #[test]
    fn test_extract_from_jsonl_stream_json_unwrap() {
        // stream-json wraps in {content: "<json string>", type: "<label>"}
        let output = r#"{"type":"result","structured_output":{"content":"{\"type\":\"questions\",\"questions\":[{\"question\":\"What?\"}]}","type":"plan"}}"#;
        let result = execute(output);
        assert!(result.is_some());
        let json: serde_json::Value = serde_json::from_str(&result.unwrap()).unwrap();
        assert_eq!(json["type"], "questions");
    }

    #[test]
    fn test_extract_from_jsonl_json_array() {
        let output =
            r#"[{"type":"system"},{"structured_output":{"type":"plan","content":"The plan"}}]"#;
        let result = execute(output);
        assert!(result.is_some());
        let json: serde_json::Value = serde_json::from_str(&result.unwrap()).unwrap();
        assert_eq!(json["type"], "plan");
    }

    #[test]
    fn test_extract_from_jsonl_empty() {
        assert!(execute("").is_none());
        assert!(execute("   ").is_none());
    }

    #[test]
    fn test_extract_from_jsonl_bare_type_ignored() {
        // Bare objects with just a "type" field should NOT be extracted —
        // they could be stream events (e.g., OpenCode's step_finish).
        let output = r#"{"type":"summary","content":"Done"}"#;
        let result = execute(output);
        assert!(result.is_none());
    }

    #[test]
    fn test_extract_from_jsonl_result_field_with_fences() {
        let output = r#"[{"type":"result","result":"```json\n{\"type\": \"myartifact\", \"content\": \"done\"}\n```"}]"#;
        let result = execute(output);
        assert!(result.is_some());
        let json: serde_json::Value = serde_json::from_str(&result.unwrap()).unwrap();
        assert_eq!(json["content"], "done");
    }
}
