//! Check if a stream line contains an API error.

/// Check if a stream line contains an API error.
///
/// Returns the error message if found, None otherwise.
/// Handles Claude's format (`type: "assistant"` with an `error` field) and
/// `OpenCode`'s format (`type: "error"` top-level event).
pub fn execute(line: &str) -> Option<String> {
    let v: serde_json::Value = serde_json::from_str(line).ok()?;
    let event_type = v.get("type").and_then(|t| t.as_str())?;

    match event_type {
        "assistant" => {
            // Claude path: assistant message with error field present
            v.get("error")?;
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
        "error" => {
            // OpenCode path: top-level error event
            Some(extract_flexible_error_message(&v))
        }
        _ => None,
    }
}

/// Extract an error message from an error event, handling multiple payload shapes.
///
/// Tries these paths in order:
/// 1. `error.data.message` — `OpenCode` nested format
/// 2. `error.message` — error object with message field
/// 3. `error` as string — direct error string
/// 4. `message` as string — top-level message field
/// 5. `content` as string — content fallback
/// 6. `"Unknown API error"` — final fallback
pub(crate) fn extract_flexible_error_message(v: &serde_json::Value) -> String {
    v["error"]["data"]["message"]
        .as_str()
        .or_else(|| v["error"]["message"].as_str())
        .or_else(|| v["error"].as_str())
        .or_else(|| v["message"].as_str())
        .or_else(|| v["content"].as_str())
        .unwrap_or("Unknown API error")
        .to_string()
}

// ============================================================================
// Tests
// ============================================================================

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_check_for_api_error_detected() {
        let line = r#"{"type":"assistant","error":"unknown","message":{"content":[{"text":"API rate limit exceeded"}]}}"#;
        let result = execute(line);
        assert_eq!(result, Some("API rate limit exceeded".to_string()));
    }

    #[test]
    fn test_check_for_api_error_no_error() {
        let line = r#"{"type":"assistant","message":{"content":[{"text":"Hello"}]}}"#;
        let result = execute(line);
        assert!(result.is_none());
    }

    #[test]
    fn test_check_for_api_error_wrong_type() {
        let line = r#"{"type":"system","error":"some error"}"#;
        let result = execute(line);
        assert!(result.is_none());
    }

    #[test]
    fn test_check_for_api_error_invalid_json() {
        let line = "not json at all";
        let result = execute(line);
        assert!(result.is_none());
    }

    #[test]
    fn test_opencode_nested_error() {
        let line = r#"{"type":"error","error":{"data":{"message":"Model not found: moonshot/kimi-k2.6"}}}"#;
        let result = execute(line);
        assert_eq!(
            result,
            Some("Model not found: moonshot/kimi-k2.6".to_string())
        );
    }

    #[test]
    fn test_opencode_error_with_message_field() {
        let line = r#"{"type":"error","message":"Rate limit exceeded"}"#;
        let result = execute(line);
        assert_eq!(result, Some("Rate limit exceeded".to_string()));
    }

    #[test]
    fn test_opencode_error_string() {
        let line = r#"{"type":"error","error":"Connection failed"}"#;
        let result = execute(line);
        assert_eq!(result, Some("Connection failed".to_string()));
    }

    #[test]
    fn test_opencode_error_unknown_shape() {
        let line = r#"{"type":"error"}"#;
        let result = execute(line);
        assert_eq!(result, Some("Unknown API error".to_string()));
    }
}
