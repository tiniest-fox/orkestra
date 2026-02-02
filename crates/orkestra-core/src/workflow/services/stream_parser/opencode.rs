//! OpenCode `--format json` stream parser.
//!
//! Parses OpenCode's JSON event output into `LogEntry` values.
//! Supports the v1.1+ event format where data is nested under a `.part` object.
//!
//! In v1.1+, `tool_use` events contain both input and output in `.part.state`,
//! so a single event emits both `LogEntry::ToolUse` and `LogEntry::ToolResult`.
//! Lifecycle events (`step_start`, `step_finish`) are silently skipped.

use crate::workflow::domain::LogEntry;
use crate::workflow::services::session_logs::{extract_tool_result_content, parse_tool_input};

use super::StreamParser;

/// Parses OpenCode `--format json` stdout events into `LogEntry` values.
pub struct OpenCodeStreamParser;

impl Default for OpenCodeStreamParser {
    fn default() -> Self {
        Self::new()
    }
}

impl OpenCodeStreamParser {
    pub fn new() -> Self {
        Self
    }

    /// Extract text content from a text/assistant event.
    ///
    /// Checks `.part.text` (v1.1+), then `.content`, `.text` (legacy).
    fn extract_text(v: &serde_json::Value) -> Option<String> {
        // v1.1+: content in .part.text
        if let Some(text) = v
            .get("part")
            .and_then(|p| p.get("text"))
            .and_then(|t| t.as_str())
        {
            let trimmed = text.trim();
            if !trimmed.is_empty() {
                return Some(trimmed.to_string());
            }
        }

        // Legacy: .content or .text at top level
        if let Some(text) = v
            .get("content")
            .or_else(|| v.get("text"))
            .and_then(|c| c.as_str())
        {
            let trimmed = text.trim();
            if !trimmed.is_empty() {
                return Some(trimmed.to_string());
            }
        }

        None
    }

    /// Extract tool use (and optionally tool result) from a tool_use event.
    ///
    /// v1.1+ nests tool info in `.part`: tool name at `.part.tool`, ID at
    /// `.part.callID`, input at `.part.state.input`, output at `.part.state.output`.
    /// When the state contains output, emits both ToolUse and ToolResult.
    fn extract_tool_use(v: &serde_json::Value) -> Vec<LogEntry> {
        let part = v.get("part");

        let tool_name = part
            .and_then(|p| p.get("tool"))
            .or_else(|| v.get("name"))
            .or_else(|| v.get("tool"))
            .and_then(|n| n.as_str())
            .unwrap_or("unknown")
            .to_string();

        let tool_id = part
            .and_then(|p| p.get("callID"))
            .or_else(|| v.get("id"))
            .and_then(|i| i.as_str())
            .unwrap_or("")
            .to_string();

        // v1.1+: input nested in .part.state.input
        let state = part.and_then(|p| p.get("state"));
        let input = state
            .and_then(|s| s.get("input"))
            .or_else(|| v.get("input"))
            .cloned()
            .unwrap_or(serde_json::json!({}));

        let tool_input = parse_tool_input(&tool_name, &input);

        let mut entries = vec![LogEntry::ToolUse {
            tool: tool_name.clone(),
            id: tool_id.clone(),
            input: tool_input,
        }];

        // v1.1+: completed tool_use events include output in .part.state.output
        if let Some(output) = state.and_then(|s| s.get("output")).and_then(|o| o.as_str()) {
            let trimmed = output.trim();
            if !trimmed.is_empty() {
                entries.push(LogEntry::ToolResult {
                    tool: tool_name,
                    tool_use_id: tool_id,
                    content: trimmed.to_string(),
                });
            }
        }

        entries
    }

    /// Extract a tool result from a standalone tool_result event (legacy format).
    fn extract_tool_result(v: &serde_json::Value) -> Option<LogEntry> {
        let tool_use_id = v
            .get("tool_use_id")
            .or_else(|| v.get("id"))
            .and_then(|i| i.as_str())
            .unwrap_or("")
            .to_string();
        let tool_name = v
            .get("name")
            .or_else(|| v.get("tool"))
            .and_then(|n| n.as_str())
            .unwrap_or("unknown")
            .to_string();
        let content = extract_tool_result_content(v);

        if content.trim().is_empty() {
            return None;
        }

        Some(LogEntry::ToolResult {
            tool: tool_name,
            tool_use_id,
            content,
        })
    }
}

impl StreamParser for OpenCodeStreamParser {
    fn parse_line(&mut self, line: &str) -> Vec<LogEntry> {
        let trimmed = line.trim();
        if trimmed.is_empty() {
            return Vec::new();
        }

        let v: serde_json::Value = match serde_json::from_str(trimmed) {
            Ok(v) => v,
            Err(_) => {
                // Non-JSON line — capture as raw text
                return vec![LogEntry::Text {
                    content: trimmed.to_string(),
                }];
            }
        };

        let event_type = v.get("type").and_then(|t| t.as_str()).unwrap_or("");

        match event_type {
            // Text content from the assistant
            "text" | "assistant" => {
                if let Some(content) = Self::extract_text(&v) {
                    vec![LogEntry::Text { content }]
                } else {
                    Vec::new()
                }
            }

            // Tool use — may include result in v1.1+ format
            "tool_use" => Self::extract_tool_use(&v),

            // Standalone tool result (legacy format)
            "tool_result" => {
                if let Some(entry) = Self::extract_tool_result(&v) {
                    vec![entry]
                } else {
                    Vec::new()
                }
            }

            // Error events
            "error" => {
                let message = v
                    .get("message")
                    .or_else(|| v.get("error"))
                    .or_else(|| v.get("content"))
                    .and_then(|m| m.as_str())
                    .unwrap_or("Unknown error")
                    .to_string();
                vec![LogEntry::Error { message }]
            }

            // Lifecycle events — skip silently
            "step_start" | "step_finish" => Vec::new(),

            // Unknown event type
            _ => {
                if let Some(content) = v.get("content").and_then(|c| c.as_str()) {
                    let t = content.trim();
                    if !t.is_empty() {
                        return vec![LogEntry::Text {
                            content: t.to_string(),
                        }];
                    }
                }
                Vec::new()
            }
        }
    }

    fn finalize(&mut self) -> Vec<LogEntry> {
        Vec::new()
    }
}

// ============================================================================
// Tests
// ============================================================================

#[cfg(test)]
mod tests {
    use super::*;
    use crate::workflow::domain::ToolInput;

    // ========================================================================
    // v1.1+ format tests (data nested in .part)
    // ========================================================================

    #[test]
    fn parses_v1_text_event() {
        let mut parser = OpenCodeStreamParser::new();
        let line = serde_json::json!({
            "type": "text",
            "timestamp": 1770052577999_i64,
            "sessionID": "ses_abc",
            "part": {
                "id": "prt_123",
                "sessionID": "ses_abc",
                "messageID": "msg_456",
                "type": "text",
                "text": " Hello! I'm ready to help.",
                "time": {"start": 1770052577998_i64, "end": 1770052577998_i64}
            }
        })
        .to_string();
        let entries = parser.parse_line(&line);
        assert_eq!(entries.len(), 1);
        assert_eq!(
            entries[0],
            LogEntry::Text {
                content: "Hello! I'm ready to help.".to_string()
            }
        );
    }

    #[test]
    fn parses_v1_tool_use_with_result() {
        let mut parser = OpenCodeStreamParser::new();
        let line = serde_json::json!({
            "type": "tool_use",
            "timestamp": 1770052699855_i64,
            "sessionID": "ses_abc",
            "part": {
                "id": "prt_789",
                "sessionID": "ses_abc",
                "messageID": "msg_456",
                "type": "tool",
                "callID": "functions.bash:0",
                "tool": "bash",
                "state": {
                    "status": "completed",
                    "input": {"command": "ls", "description": "List files"},
                    "output": "file1.rs\nfile2.rs\n",
                    "title": "List files",
                    "metadata": {},
                    "time": {"start": 1770052699528_i64, "end": 1770052699842_i64}
                }
            }
        })
        .to_string();

        let entries = parser.parse_line(&line);
        assert_eq!(entries.len(), 2);

        // First entry: tool use
        // Note: OpenCode uses lowercase tool names ("bash" not "Bash"), so
        // parse_tool_input falls through to Other since the match is case-sensitive.
        match &entries[0] {
            LogEntry::ToolUse { tool, id, .. } => {
                assert_eq!(tool, "bash");
                assert_eq!(id, "functions.bash:0");
            }
            other => panic!("Expected ToolUse, got {other:?}"),
        }

        // Second entry: tool result (from same event)
        match &entries[1] {
            LogEntry::ToolResult {
                tool,
                tool_use_id,
                content,
            } => {
                assert_eq!(tool, "bash");
                assert_eq!(tool_use_id, "functions.bash:0");
                assert_eq!(content, "file1.rs\nfile2.rs");
            }
            other => panic!("Expected ToolResult, got {other:?}"),
        }
    }

    #[test]
    fn skips_step_start_events() {
        let mut parser = OpenCodeStreamParser::new();
        let line = serde_json::json!({
            "type": "step_start",
            "timestamp": 1770052699369_i64,
            "sessionID": "ses_abc",
            "part": {
                "id": "prt_123",
                "type": "step-start",
                "snapshot": "abc123"
            }
        })
        .to_string();
        let entries = parser.parse_line(&line);
        assert!(entries.is_empty());
    }

    #[test]
    fn skips_step_finish_events() {
        let mut parser = OpenCodeStreamParser::new();
        let line = serde_json::json!({
            "type": "step_finish",
            "timestamp": 1770052700099_i64,
            "sessionID": "ses_abc",
            "part": {
                "id": "prt_456",
                "type": "step-finish",
                "reason": "stop",
                "cost": 0,
                "tokens": {"input": 13542, "output": 73}
            }
        })
        .to_string();
        let entries = parser.parse_line(&line);
        assert!(entries.is_empty());
    }

    #[test]
    fn skips_empty_v1_text() {
        let mut parser = OpenCodeStreamParser::new();
        let line = serde_json::json!({
            "type": "text",
            "timestamp": 1770052577999_i64,
            "sessionID": "ses_abc",
            "part": {
                "id": "prt_123",
                "type": "text",
                "text": "",
                "time": {"start": 0, "end": 0}
            }
        })
        .to_string();
        let entries = parser.parse_line(&line);
        assert!(entries.is_empty());
    }

    // ========================================================================
    // Legacy format tests (data at top level)
    // ========================================================================

    #[test]
    fn parses_legacy_text_event() {
        let mut parser = OpenCodeStreamParser::new();
        let line = serde_json::json!({
            "type": "text",
            "content": "Analyzing the code..."
        })
        .to_string();
        let entries = parser.parse_line(&line);
        assert_eq!(entries.len(), 1);
        assert_eq!(
            entries[0],
            LogEntry::Text {
                content: "Analyzing the code...".to_string()
            }
        );
    }

    #[test]
    fn parses_legacy_assistant_event() {
        let mut parser = OpenCodeStreamParser::new();
        let line = serde_json::json!({
            "type": "assistant",
            "content": "Working on it"
        })
        .to_string();
        let entries = parser.parse_line(&line);
        assert_eq!(entries.len(), 1);
        assert_eq!(
            entries[0],
            LogEntry::Text {
                content: "Working on it".to_string()
            }
        );
    }

    #[test]
    fn parses_legacy_tool_use_event() {
        let mut parser = OpenCodeStreamParser::new();
        let line = serde_json::json!({
            "type": "tool_use",
            "name": "Bash",
            "id": "oc_tu_1",
            "input": {"command": "ls -la"}
        })
        .to_string();
        let entries = parser.parse_line(&line);
        assert_eq!(entries.len(), 1);
        match &entries[0] {
            LogEntry::ToolUse { tool, id, input } => {
                assert_eq!(tool, "Bash");
                assert_eq!(id, "oc_tu_1");
                assert_eq!(
                    *input,
                    ToolInput::Bash {
                        command: "ls -la".to_string()
                    }
                );
            }
            other => panic!("Expected ToolUse, got {other:?}"),
        }
    }

    #[test]
    fn parses_legacy_tool_result_event() {
        let mut parser = OpenCodeStreamParser::new();
        let line = serde_json::json!({
            "type": "tool_result",
            "tool_use_id": "oc_tu_1",
            "name": "Bash",
            "content": "total 42\ndrwxr-xr-x ..."
        })
        .to_string();
        let entries = parser.parse_line(&line);
        assert_eq!(entries.len(), 1);
        match &entries[0] {
            LogEntry::ToolResult {
                tool,
                tool_use_id,
                content,
            } => {
                assert_eq!(tool, "Bash");
                assert_eq!(tool_use_id, "oc_tu_1");
                assert!(content.contains("total 42"));
            }
            other => panic!("Expected ToolResult, got {other:?}"),
        }
    }

    #[test]
    fn parses_legacy_tool_field_as_fallback() {
        let mut parser = OpenCodeStreamParser::new();
        let line = serde_json::json!({
            "type": "tool_use",
            "tool": "Edit",
            "id": "oc_tu_2",
            "input": {"file_path": "/src/lib.rs"}
        })
        .to_string();
        let entries = parser.parse_line(&line);
        assert_eq!(entries.len(), 1);
        match &entries[0] {
            LogEntry::ToolUse { tool, .. } => assert_eq!(tool, "Edit"),
            other => panic!("Expected ToolUse, got {other:?}"),
        }
    }

    // ========================================================================
    // Common behavior tests
    // ========================================================================

    #[test]
    fn parses_error_event() {
        let mut parser = OpenCodeStreamParser::new();
        let line = serde_json::json!({
            "type": "error",
            "message": "Rate limit exceeded"
        })
        .to_string();
        let entries = parser.parse_line(&line);
        assert_eq!(entries.len(), 1);
        assert_eq!(
            entries[0],
            LogEntry::Error {
                message: "Rate limit exceeded".to_string()
            }
        );
    }

    #[test]
    fn error_with_fallback_fields() {
        let mut parser = OpenCodeStreamParser::new();

        // error field instead of message
        let line = serde_json::json!({
            "type": "error",
            "error": "Something broke"
        })
        .to_string();
        let entries = parser.parse_line(&line);
        assert_eq!(
            entries[0],
            LogEntry::Error {
                message: "Something broke".to_string()
            }
        );

        // content field as last fallback
        let line = serde_json::json!({
            "type": "error",
            "content": "Another failure"
        })
        .to_string();
        let entries = parser.parse_line(&line);
        assert_eq!(
            entries[0],
            LogEntry::Error {
                message: "Another failure".to_string()
            }
        );
    }

    #[test]
    fn captures_non_json_as_text() {
        let mut parser = OpenCodeStreamParser::new();
        let entries = parser.parse_line("Some raw output from opencode");
        assert_eq!(entries.len(), 1);
        assert_eq!(
            entries[0],
            LogEntry::Text {
                content: "Some raw output from opencode".to_string()
            }
        );
    }

    #[test]
    fn skips_empty_lines() {
        let mut parser = OpenCodeStreamParser::new();
        assert!(parser.parse_line("").is_empty());
        assert!(parser.parse_line("   ").is_empty());
    }

    #[test]
    fn skips_empty_text_content() {
        let mut parser = OpenCodeStreamParser::new();
        let line = serde_json::json!({
            "type": "text",
            "content": "  "
        })
        .to_string();
        let entries = parser.parse_line(&line);
        assert!(entries.is_empty());
    }

    #[test]
    fn skips_empty_tool_result_content() {
        let mut parser = OpenCodeStreamParser::new();
        let line = serde_json::json!({
            "type": "tool_result",
            "tool_use_id": "oc_tu_1",
            "name": "Read",
            "content": ""
        })
        .to_string();
        let entries = parser.parse_line(&line);
        assert!(entries.is_empty());
    }

    #[test]
    fn skips_unknown_events_without_content() {
        let mut parser = OpenCodeStreamParser::new();
        let line = serde_json::json!({
            "type": "metric",
            "tokens": 1500
        })
        .to_string();
        let entries = parser.parse_line(&line);
        assert!(entries.is_empty());
    }

    #[test]
    fn captures_unknown_event_with_content() {
        let mut parser = OpenCodeStreamParser::new();
        let line = serde_json::json!({
            "type": "status",
            "content": "Processing step 3/10"
        })
        .to_string();
        let entries = parser.parse_line(&line);
        assert_eq!(entries.len(), 1);
        assert_eq!(
            entries[0],
            LogEntry::Text {
                content: "Processing step 3/10".to_string()
            }
        );
    }

    #[test]
    fn finalize_returns_empty() {
        let mut parser = OpenCodeStreamParser::new();
        assert!(parser.finalize().is_empty());
    }
}
