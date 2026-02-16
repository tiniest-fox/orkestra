//! Parse streaming JSON events from agent output.

use crate::types::ParsedStreamEvent;

/// Parse a streaming JSON event to extract useful information.
/// Only fires update events when meaningful content is produced.
pub fn execute(json_line: &str) -> ParsedStreamEvent {
    let v: serde_json::Value = match serde_json::from_str(json_line) {
        Ok(v) => v,
        Err(_) => return ParsedStreamEvent::default(),
    };

    let event_type = v.get("type").and_then(|t| t.as_str()).unwrap_or("");

    // Try to extract session ID from various formats:
    // - Old format: {"type":"system","subtype":"init","session_id":"abc"}
    // - New format: {"type":"user","sessionId":"abc",...} or {"type":"queue-operation","sessionId":"abc",...}
    let session_id = v
        .get("session_id")
        .or_else(|| v.get("sessionId"))
        .and_then(|s| s.as_str())
        .map(std::string::ToString::to_string);

    // Check for system init events which contain session_id
    if event_type == "system" && v.get("subtype").and_then(|s| s.as_str()) == Some("init") {
        return ParsedStreamEvent {
            session_id,
            has_new_content: true,
        };
    }

    // Check for queue-operation events (new format, has sessionId)
    if event_type == "queue-operation" && session_id.is_some() {
        return ParsedStreamEvent {
            session_id,
            has_new_content: false,
        };
    }

    // Check for user events (new format, has sessionId)
    if event_type == "user" && session_id.is_some() {
        return ParsedStreamEvent {
            session_id,
            has_new_content: true,
        };
    }

    // Check for assistant message events (these are written to session file)
    if event_type == "assistant" && v.get("message").is_some() {
        return ParsedStreamEvent {
            session_id,
            has_new_content: true,
        };
    }

    // Check for result events (tool results, which update the session)
    if event_type == "result" {
        return ParsedStreamEvent {
            session_id,
            has_new_content: true,
        };
    }

    ParsedStreamEvent::default()
}

// ============================================================================
// Tests
// ============================================================================

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_parse_stream_event_init() {
        let json = r#"{"type":"system","subtype":"init","session_id":"abc123"}"#;
        let parsed = execute(json);
        assert_eq!(parsed.session_id, Some("abc123".to_string()));
        assert!(parsed.has_new_content);
    }

    #[test]
    fn test_parse_stream_event_assistant() {
        let json = r#"{"type":"assistant","message":{"content":"hello"}}"#;
        let parsed = execute(json);
        assert!(parsed.session_id.is_none());
        assert!(parsed.has_new_content);
    }

    #[test]
    fn test_parse_stream_event_result() {
        let json = r#"{"type":"result","data":"some data"}"#;
        let parsed = execute(json);
        assert!(parsed.session_id.is_none());
        assert!(parsed.has_new_content);
    }

    #[test]
    fn test_parse_stream_event_invalid() {
        let json = "not valid json";
        let parsed = execute(json);
        assert!(parsed.session_id.is_none());
        assert!(!parsed.has_new_content);
    }

    #[test]
    fn test_parse_stream_event_queue_operation_camelcase() {
        // New Claude format with camelCase sessionId
        let json =
            r#"{"type":"queue-operation","operation":"dequeue","sessionId":"da966363-8e89-4469"}"#;
        let parsed = execute(json);
        assert_eq!(parsed.session_id, Some("da966363-8e89-4469".to_string()));
        assert!(!parsed.has_new_content); // queue-operation doesn't produce content
    }

    #[test]
    fn test_parse_stream_event_user_camelcase() {
        // New Claude format with camelCase sessionId in user events
        let json =
            r#"{"type":"user","sessionId":"abc123","message":{"role":"user","content":"hello"}}"#;
        let parsed = execute(json);
        assert_eq!(parsed.session_id, Some("abc123".to_string()));
        assert!(parsed.has_new_content);
    }

    #[test]
    fn test_parse_stream_event_assistant_with_session() {
        // Assistant event can also carry sessionId in new format
        let json = r#"{"type":"assistant","sessionId":"xyz789","message":{"content":"hello"}}"#;
        let parsed = execute(json);
        assert_eq!(parsed.session_id, Some("xyz789".to_string()));
        assert!(parsed.has_new_content);
    }
}
