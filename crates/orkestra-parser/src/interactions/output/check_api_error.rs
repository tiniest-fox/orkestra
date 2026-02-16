//! Check if a stream line contains an API error.

/// Check if a stream line contains an API error.
///
/// Returns the error message if found, None otherwise.
/// API errors appear as assistant messages with an `error` field present.
pub fn execute(line: &str) -> Option<String> {
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
}
