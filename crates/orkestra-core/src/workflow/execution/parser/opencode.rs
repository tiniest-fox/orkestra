//! `OpenCode` agent parser.
//!
//! Handles both stream parsing (`--format json` events → `LogEntry`) and output
//! extraction (JSONL scan + text fallback → raw JSON string).
//!
//! Tracks `last_text` internally during streaming so that `extract_output` can
//! fall back to it when the JSONL stream has no `structured_output` field.

use crate::workflow::domain::LogEntry;
use crate::workflow::services::session_logs::{extract_tool_result_content, parse_tool_input};

use super::{extract_from_jsonl, strip_markdown_code_fences, AgentParser, ParsedUpdate};

/// `OpenCode` agent parser.
///
/// Combines stream parsing and output extraction for `OpenCode`'s `--format json` output.
///
/// During streaming, tracks:
/// - `session_id`: extracted from the first event containing `sessionID`
/// - `last_text`: the most recent text content (used as fallback for output extraction)
pub struct OpenCodeAgentParser {
    /// The session ID extracted from the stream, if any.
    session_id: Option<String>,
    /// Whether the session ID has been emitted via `ParsedUpdate`.
    session_id_emitted: bool,
    /// The last text content seen during streaming (used as extraction fallback).
    last_text: Option<String>,
}

impl Default for OpenCodeAgentParser {
    fn default() -> Self {
        Self::new()
    }
}

impl OpenCodeAgentParser {
    pub fn new() -> Self {
        Self {
            session_id: None,
            session_id_emitted: false,
            last_text: None,
        }
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

    /// Extract tool use (and optionally tool result) from a `tool_use` event.
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

    /// Extract a tool result from a standalone `tool_result` event (legacy format).
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

    /// Parse a single JSON line into log entries, tracking `last_text` internally.
    fn parse_line_entries(&mut self, line: &str) -> Vec<LogEntry> {
        let trimmed = line.trim();
        if trimmed.is_empty() {
            return Vec::new();
        }

        let Ok(v) = serde_json::from_str::<serde_json::Value>(trimmed) else {
            // Non-JSON line — capture as raw text
            self.last_text = Some(trimmed.to_string());
            return vec![LogEntry::Text {
                content: trimmed.to_string(),
            }];
        };

        // Extract session ID from the first event that has one.
        if self.session_id.is_none() {
            if let Some(sid) = v.get("sessionID").and_then(|s| s.as_str()) {
                if !sid.is_empty() {
                    self.session_id = Some(sid.to_string());
                }
            }
        }

        let event_type = v.get("type").and_then(|t| t.as_str()).unwrap_or("");

        match event_type {
            // Text content from the assistant
            "text" | "assistant" => {
                if let Some(content) = Self::extract_text(&v) {
                    self.last_text = Some(content.clone());
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
                        self.last_text = Some(t.to_string());
                        return vec![LogEntry::Text {
                            content: t.to_string(),
                        }];
                    }
                }
                Vec::new()
            }
        }
    }
}

impl AgentParser for OpenCodeAgentParser {
    fn parse_line(&mut self, line: &str) -> ParsedUpdate {
        let log_entries = self.parse_line_entries(line);

        // Emit the session ID exactly once
        let session_id = if self.session_id_emitted {
            None
        } else if let Some(ref sid) = self.session_id {
            self.session_id_emitted = true;
            Some(sid.clone())
        } else {
            None
        };

        ParsedUpdate {
            log_entries,
            session_id,
        }
    }

    fn finalize(&mut self) -> Vec<LogEntry> {
        Vec::new()
    }

    fn extract_output(&self, full_output: &str) -> Result<String, String> {
        let trimmed = full_output.trim();

        if trimmed.is_empty() {
            return Err(
                "Agent produced no output (process may have exited unexpectedly)".to_string(),
            );
        }

        // Try JSONL scan first (same as Claude, for compatibility)
        if let Some(json_str) = extract_from_jsonl(trimmed) {
            return Ok(json_str);
        }

        // Fall back to last_text (accumulated during streaming)
        if let Some(ref text) = self.last_text {
            let stripped = strip_markdown_code_fences(text);
            // Verify it's valid JSON
            if serde_json::from_str::<serde_json::Value>(&stripped).is_ok() {
                return Ok(stripped);
            }
        }

        Err(format!(
            "Failed to parse agent output: no structured output found in {} bytes of output",
            trimmed.len()
        ))
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
    // Stream parsing tests — v1.1+ format
    // ========================================================================

    #[test]
    fn parses_v1_text_event() {
        let mut parser = OpenCodeAgentParser::new();
        let line = serde_json::json!({
            "type": "text",
            "timestamp": 1_770_052_577_999_i64,
            "sessionID": "ses_abc",
            "part": {
                "id": "prt_123",
                "sessionID": "ses_abc",
                "messageID": "msg_456",
                "type": "text",
                "text": " Hello! I'm ready to help.",
                "time": {"start": 1_770_052_577_998_i64, "end": 1_770_052_577_998_i64}
            }
        })
        .to_string();
        let update = parser.parse_line(&line);
        assert_eq!(update.log_entries.len(), 1);
        assert_eq!(
            update.log_entries[0],
            LogEntry::Text {
                content: "Hello! I'm ready to help.".to_string()
            }
        );
        // Session ID should be emitted on first event
        assert_eq!(update.session_id, Some("ses_abc".to_string()));
    }

    #[test]
    fn session_id_emitted_once() {
        let mut parser = OpenCodeAgentParser::new();
        let line1 = serde_json::json!({
            "type": "text",
            "sessionID": "ses_abc",
            "part": {"type": "text", "text": "First"}
        })
        .to_string();
        let line2 = serde_json::json!({
            "type": "text",
            "sessionID": "ses_abc",
            "part": {"type": "text", "text": "Second"}
        })
        .to_string();

        let update1 = parser.parse_line(&line1);
        assert_eq!(update1.session_id, Some("ses_abc".to_string()));

        let update2 = parser.parse_line(&line2);
        assert!(update2.session_id.is_none());
    }

    #[test]
    fn parses_v1_tool_use_with_result() {
        let mut parser = OpenCodeAgentParser::new();
        let line = serde_json::json!({
            "type": "tool_use",
            "timestamp": 1_770_052_699_855_i64,
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
                    "time": {"start": 1_770_052_699_528_i64, "end": 1_770_052_699_842_i64}
                }
            }
        })
        .to_string();

        let update = parser.parse_line(&line);
        assert_eq!(update.log_entries.len(), 2);

        match &update.log_entries[0] {
            LogEntry::ToolUse { tool, id, .. } => {
                assert_eq!(tool, "bash");
                assert_eq!(id, "functions.bash:0");
            }
            other => panic!("Expected ToolUse, got {other:?}"),
        }

        match &update.log_entries[1] {
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
        let mut parser = OpenCodeAgentParser::new();
        let line = serde_json::json!({
            "type": "step_start",
            "timestamp": 1_770_052_699_369_i64,
            "sessionID": "ses_abc",
            "part": {
                "id": "prt_123",
                "type": "step-start",
                "snapshot": "abc123"
            }
        })
        .to_string();
        let update = parser.parse_line(&line);
        assert!(update.log_entries.is_empty());
    }

    #[test]
    fn skips_step_finish_events() {
        let mut parser = OpenCodeAgentParser::new();
        let line = serde_json::json!({
            "type": "step_finish",
            "timestamp": 1_770_052_700_099_i64,
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
        let update = parser.parse_line(&line);
        assert!(update.log_entries.is_empty());
    }

    #[test]
    fn skips_empty_v1_text() {
        let mut parser = OpenCodeAgentParser::new();
        let line = serde_json::json!({
            "type": "text",
            "timestamp": 1_770_052_577_999_i64,
            "sessionID": "ses_abc",
            "part": {
                "id": "prt_123",
                "type": "text",
                "text": "",
                "time": {"start": 0, "end": 0}
            }
        })
        .to_string();
        let update = parser.parse_line(&line);
        assert!(update.log_entries.is_empty());
    }

    // ========================================================================
    // Stream parsing tests — legacy format
    // ========================================================================

    #[test]
    fn parses_legacy_text_event() {
        let mut parser = OpenCodeAgentParser::new();
        let line = serde_json::json!({
            "type": "text",
            "content": "Analyzing the code..."
        })
        .to_string();
        let update = parser.parse_line(&line);
        assert_eq!(update.log_entries.len(), 1);
        assert_eq!(
            update.log_entries[0],
            LogEntry::Text {
                content: "Analyzing the code...".to_string()
            }
        );
    }

    #[test]
    fn parses_legacy_assistant_event() {
        let mut parser = OpenCodeAgentParser::new();
        let line = serde_json::json!({
            "type": "assistant",
            "content": "Working on it"
        })
        .to_string();
        let update = parser.parse_line(&line);
        assert_eq!(update.log_entries.len(), 1);
        assert_eq!(
            update.log_entries[0],
            LogEntry::Text {
                content: "Working on it".to_string()
            }
        );
    }

    #[test]
    fn parses_legacy_tool_use_event() {
        let mut parser = OpenCodeAgentParser::new();
        let line = serde_json::json!({
            "type": "tool_use",
            "name": "Bash",
            "id": "oc_tu_1",
            "input": {"command": "ls -la"}
        })
        .to_string();
        let update = parser.parse_line(&line);
        assert_eq!(update.log_entries.len(), 1);
        match &update.log_entries[0] {
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
        let mut parser = OpenCodeAgentParser::new();
        let line = serde_json::json!({
            "type": "tool_result",
            "tool_use_id": "oc_tu_1",
            "name": "Bash",
            "content": "total 42\ndrwxr-xr-x ..."
        })
        .to_string();
        let update = parser.parse_line(&line);
        assert_eq!(update.log_entries.len(), 1);
        match &update.log_entries[0] {
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
        let mut parser = OpenCodeAgentParser::new();
        let line = serde_json::json!({
            "type": "tool_use",
            "tool": "Edit",
            "id": "oc_tu_2",
            "input": {"file_path": "/src/lib.rs"}
        })
        .to_string();
        let update = parser.parse_line(&line);
        assert_eq!(update.log_entries.len(), 1);
        match &update.log_entries[0] {
            LogEntry::ToolUse { tool, .. } => assert_eq!(tool, "Edit"),
            other => panic!("Expected ToolUse, got {other:?}"),
        }
    }

    // ========================================================================
    // Common behavior tests
    // ========================================================================

    #[test]
    fn parses_error_event() {
        let mut parser = OpenCodeAgentParser::new();
        let line = serde_json::json!({
            "type": "error",
            "message": "Rate limit exceeded"
        })
        .to_string();
        let update = parser.parse_line(&line);
        assert_eq!(update.log_entries.len(), 1);
        assert_eq!(
            update.log_entries[0],
            LogEntry::Error {
                message: "Rate limit exceeded".to_string()
            }
        );
    }

    #[test]
    fn error_with_fallback_fields() {
        let mut parser = OpenCodeAgentParser::new();

        let line = serde_json::json!({
            "type": "error",
            "error": "Something broke"
        })
        .to_string();
        let update = parser.parse_line(&line);
        assert_eq!(
            update.log_entries[0],
            LogEntry::Error {
                message: "Something broke".to_string()
            }
        );

        let line = serde_json::json!({
            "type": "error",
            "content": "Another failure"
        })
        .to_string();
        let update = parser.parse_line(&line);
        assert_eq!(
            update.log_entries[0],
            LogEntry::Error {
                message: "Another failure".to_string()
            }
        );
    }

    #[test]
    fn captures_non_json_as_text() {
        let mut parser = OpenCodeAgentParser::new();
        let update = parser.parse_line("Some raw output from opencode");
        assert_eq!(update.log_entries.len(), 1);
        assert_eq!(
            update.log_entries[0],
            LogEntry::Text {
                content: "Some raw output from opencode".to_string()
            }
        );
    }

    #[test]
    fn skips_empty_lines() {
        let mut parser = OpenCodeAgentParser::new();
        assert!(parser.parse_line("").log_entries.is_empty());
        assert!(parser.parse_line("   ").log_entries.is_empty());
    }

    #[test]
    fn skips_empty_text_content() {
        let mut parser = OpenCodeAgentParser::new();
        let line = serde_json::json!({
            "type": "text",
            "content": "  "
        })
        .to_string();
        let update = parser.parse_line(&line);
        assert!(update.log_entries.is_empty());
    }

    #[test]
    fn skips_empty_tool_result_content() {
        let mut parser = OpenCodeAgentParser::new();
        let line = serde_json::json!({
            "type": "tool_result",
            "tool_use_id": "oc_tu_1",
            "name": "Read",
            "content": ""
        })
        .to_string();
        let update = parser.parse_line(&line);
        assert!(update.log_entries.is_empty());
    }

    #[test]
    fn skips_unknown_events_without_content() {
        let mut parser = OpenCodeAgentParser::new();
        let line = serde_json::json!({
            "type": "metric",
            "tokens": 1500
        })
        .to_string();
        let update = parser.parse_line(&line);
        assert!(update.log_entries.is_empty());
    }

    #[test]
    fn captures_unknown_event_with_content() {
        let mut parser = OpenCodeAgentParser::new();
        let line = serde_json::json!({
            "type": "status",
            "content": "Processing step 3/10"
        })
        .to_string();
        let update = parser.parse_line(&line);
        assert_eq!(update.log_entries.len(), 1);
        assert_eq!(
            update.log_entries[0],
            LogEntry::Text {
                content: "Processing step 3/10".to_string()
            }
        );
    }

    #[test]
    fn finalize_returns_empty() {
        let mut parser = OpenCodeAgentParser::new();
        assert!(parser.finalize().is_empty());
    }

    // ========================================================================
    // Output extraction tests
    // ========================================================================

    #[test]
    fn extract_from_last_text() {
        let mut parser = OpenCodeAgentParser::new();

        // Simulate streaming — the structured output arrives as a text event
        let line = serde_json::json!({
            "type": "text",
            "part": {"type": "text", "text": "{\"type\":\"artifact\",\"content\":\"Found 1 file\"}"}
        })
        .to_string();
        parser.parse_line(&line);

        // The raw JSONL won't have structured_output, but last_text has the JSON
        let output = r#"{"type":"step_start","part":{"type":"step-start"}}
{"type":"text","part":{"text":"{\"type\":\"artifact\",\"content\":\"Found 1 file\"}"}}
{"type":"step_finish","part":{"type":"step-finish","reason":"stop"}}"#;

        let result = parser.extract_output(output);
        assert!(result.is_ok(), "Failed: {result:?}");
        let json: serde_json::Value = serde_json::from_str(&result.unwrap()).unwrap();
        assert_eq!(json["type"], "artifact");
        assert_eq!(json["content"], "Found 1 file");
    }

    #[test]
    fn extract_from_last_text_with_markdown_fences() {
        let mut parser = OpenCodeAgentParser::new();

        // Agent wraps JSON in markdown fences
        let line = serde_json::json!({
            "type": "text",
            "part": {"type": "text", "text": "```json\n{\"type\":\"summary\",\"content\":\"Done\"}\n```"}
        })
        .to_string();
        parser.parse_line(&line);

        let output = r#"{"type":"text","part":{"text":"some stuff"}}"#;
        let result = parser.extract_output(output);
        assert!(result.is_ok(), "Failed: {result:?}");
        let json: serde_json::Value = serde_json::from_str(&result.unwrap()).unwrap();
        assert_eq!(json["type"], "summary");
    }

    #[test]
    fn extract_fallback_no_last_text_fails() {
        let parser = OpenCodeAgentParser::new();
        let output = r#"{"type":"step_start","part":{"type":"step-start"}}
{"type":"step_finish","part":{"type":"step-finish","reason":"stop"}}"#;
        let result = parser.extract_output(output);
        assert!(result.is_err());
    }

    #[test]
    fn extract_empty_output() {
        let parser = OpenCodeAgentParser::new();
        let result = parser.extract_output("");
        assert!(result.is_err());
        assert!(result.unwrap_err().contains("no output"));
    }

    #[test]
    fn extract_jsonl_takes_priority_over_last_text() {
        let mut parser = OpenCodeAgentParser::new();

        // Set last_text to something different
        let line = serde_json::json!({
            "type": "text",
            "part": {"type": "text", "text": "{\"type\":\"artifact\",\"content\":\"old\"}"}
        })
        .to_string();
        parser.parse_line(&line);

        // But the JSONL has structured_output — that should take priority
        let output = r#"{"structured_output":{"type":"summary","content":"new"}}"#;
        let result = parser.extract_output(output);
        assert!(result.is_ok(), "Failed: {result:?}");
        let json: serde_json::Value = serde_json::from_str(&result.unwrap()).unwrap();
        assert_eq!(json["type"], "summary");
        assert_eq!(json["content"], "new");
    }

    #[test]
    fn tracks_last_text_across_multiple_events() {
        let mut parser = OpenCodeAgentParser::new();

        // First text event
        let line1 = serde_json::json!({
            "type": "text",
            "part": {"type": "text", "text": "First thought"}
        })
        .to_string();
        parser.parse_line(&line1);

        // Second text event — should replace last_text
        let line2 = serde_json::json!({
            "type": "text",
            "part": {"type": "text", "text": "{\"type\":\"artifact\",\"content\":\"Final output\"}"}
        })
        .to_string();
        parser.parse_line(&line2);

        // extract_output should use the LAST text
        let output = r#"{"type":"step_finish","part":{"type":"step-finish"}}"#;
        let result = parser.extract_output(output);
        assert!(result.is_ok(), "Failed: {result:?}");
        let json: serde_json::Value = serde_json::from_str(&result.unwrap()).unwrap();
        assert_eq!(json["content"], "Final output");
    }
}
