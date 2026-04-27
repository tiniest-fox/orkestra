//! `OpenCode` parser service.
//!
//! Holds stream parsing state and delegates to interactions.

use orkestra_types::domain::LogEntry;

use crate::interactions::opencode::{
    classify_buffered_text, extract_text_content, extract_tool_result_event, extract_tool_use_event,
};
use crate::interactions::output::{extract_from_jsonl, extract_from_text_content};
use crate::interface::AgentParser;
use crate::types::{ExtractionResult, ParsedUpdate};

/// `OpenCode` agent parser.
///
/// Combines stream parsing and output extraction for `OpenCode`'s `--format json` output.
///
/// During streaming, tracks:
/// - `session_id`: extracted from the first event containing `sessionID`
/// - `last_text`: the most recent text content (used as fallback for output extraction)
pub struct OpenCodeParserService {
    /// The session ID extracted from the stream, if any.
    session_id: Option<String>,
    /// Whether the session ID has been emitted via `ParsedUpdate`.
    session_id_emitted: bool,
    /// The last text content seen during streaming (used as extraction fallback).
    last_text: Option<String>,
    /// Buffered text event awaiting the next event before emission.
    ///
    /// Text events are deferred so that the final structured output JSON (which
    /// arrives as a plain text event in `OpenCode`) can be classified in `finalize()`
    /// and suppressed rather than emitted as a spurious `Text` entry.
    pending_text: Option<String>,
}

impl Default for OpenCodeParserService {
    fn default() -> Self {
        Self::new()
    }
}

impl OpenCodeParserService {
    pub fn new() -> Self {
        Self {
            session_id: None,
            session_id_emitted: false,
            last_text: None,
            pending_text: None,
        }
    }

    /// Drain `pending_text` into a `LogEntry::Text`, if present.
    fn flush_pending_text(&mut self) -> Option<LogEntry> {
        self.pending_text
            .take()
            .map(|content| LogEntry::Text { content })
    }

    /// Buffer a text event: flush any existing `pending_text` as `Text`, then
    /// set the new content as `pending_text` (deferred until the next event or
    /// `finalize()`). Also updates `last_text` for output extraction.
    fn buffer_text(&mut self, content: String) -> Vec<LogEntry> {
        let mut entries = Vec::new();
        if let Some(flushed) = self.flush_pending_text() {
            entries.push(flushed);
        }
        self.last_text = Some(content.clone());
        self.pending_text = Some(content);
        entries
    }

    /// Parse a single JSON line into log entries, tracking `last_text` internally.
    fn parse_line_entries(&mut self, line: &str) -> Vec<LogEntry> {
        let trimmed = line.trim();
        if trimmed.is_empty() {
            return Vec::new();
        }

        let Ok(v) = serde_json::from_str::<serde_json::Value>(trimmed) else {
            // Non-JSON line — buffer as raw text
            return self.buffer_text(trimmed.to_string());
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
            // Text content from the assistant — buffer instead of emitting
            "text" | "assistant" => {
                if let Some(content) = extract_text_content::execute(&v) {
                    self.buffer_text(content)
                } else {
                    Vec::new()
                }
            }

            // Tool use — may include result in v1.1+ format
            "tool_use" => {
                let mut entries = Vec::new();
                if let Some(flushed) = self.flush_pending_text() {
                    entries.push(flushed);
                }
                entries.extend(extract_tool_use_event::execute(&v));
                entries
            }

            // Standalone tool result (legacy format)
            "tool_result" => {
                let mut entries = Vec::new();
                if let Some(flushed) = self.flush_pending_text() {
                    entries.push(flushed);
                }
                if let Some(entry) = extract_tool_result_event::execute(&v) {
                    entries.push(entry);
                }
                entries
            }

            // Error events
            "error" => {
                let mut entries = Vec::new();
                if let Some(flushed) = self.flush_pending_text() {
                    entries.push(flushed);
                }
                let message =
                    crate::interactions::output::check_api_error::extract_flexible_error_message(
                        &v,
                    );
                entries.push(LogEntry::Error { message });
                entries
            }

            // Lifecycle events — skip silently.
            // Do NOT flush pending_text here: the structured output JSON
            // arrives as a text event right before step_finish. Flushing
            // would emit it as plain Text before finalize() can classify it.
            "step_start" | "step_finish" => Vec::new(),

            // Unknown event type
            _ => {
                if let Some(content) = v.get("content").and_then(|c| c.as_str()) {
                    let t = content.trim();
                    if !t.is_empty() {
                        return self.buffer_text(t.to_string());
                    }
                }
                Vec::new()
            }
        }
    }
}

impl AgentParser for OpenCodeParserService {
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
        let Some(text) = self.pending_text.take() else {
            return Vec::new();
        };

        classify_buffered_text::execute(&text)
    }

    fn extract_output(&self, full_output: &str) -> ExtractionResult {
        let trimmed = full_output.trim();

        if trimmed.is_empty() {
            return ExtractionResult::Error(
                "Agent produced no output (process may have exited unexpectedly)".to_string(),
            );
        }

        // Try JSONL scan first (same as Claude, for compatibility)
        if let Some(json_str) = extract_from_jsonl::execute(trimmed) {
            return ExtractionResult::Found(json_str);
        }

        // Fall back to last_text (accumulated during streaming)
        if let Some(ref text) = self.last_text {
            if let Some(json_str) = extract_from_text_content::execute(text) {
                return ExtractionResult::Found(json_str);
            }
        }

        ExtractionResult::NotFound
    }
}

// ============================================================================
// Tests
// ============================================================================

#[cfg(test)]
mod tests {
    use super::*;
    use orkestra_types::domain::ToolInput;

    // -- Stream parsing tests — v1.1+ format --

    #[test]
    fn parses_v1_text_event() {
        let mut parser = OpenCodeParserService::new();
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
        assert!(update.log_entries.is_empty());
        assert_eq!(update.session_id, Some("ses_abc".to_string()));

        let finalized = parser.finalize();
        assert_eq!(finalized.len(), 1);
        assert_eq!(
            finalized[0],
            LogEntry::Text {
                content: "Hello! I'm ready to help.".to_string()
            }
        );
    }

    #[test]
    fn session_id_emitted_once() {
        let mut parser = OpenCodeParserService::new();
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
        assert_eq!(update2.log_entries.len(), 1);
        assert_eq!(
            update2.log_entries[0],
            LogEntry::Text {
                content: "First".to_string()
            }
        );
    }

    #[test]
    fn parses_v1_tool_use_with_result() {
        let mut parser = OpenCodeParserService::new();
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
        let mut parser = OpenCodeParserService::new();
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
        let mut parser = OpenCodeParserService::new();
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
        let mut parser = OpenCodeParserService::new();
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

    // -- Stream parsing tests — legacy format --

    #[test]
    fn parses_legacy_text_event() {
        let mut parser = OpenCodeParserService::new();
        let line = serde_json::json!({
            "type": "text",
            "content": "Analyzing the code..."
        })
        .to_string();
        let update = parser.parse_line(&line);
        assert!(update.log_entries.is_empty());

        let finalized = parser.finalize();
        assert_eq!(finalized.len(), 1);
        assert_eq!(
            finalized[0],
            LogEntry::Text {
                content: "Analyzing the code...".to_string()
            }
        );
    }

    #[test]
    fn parses_legacy_assistant_event() {
        let mut parser = OpenCodeParserService::new();
        let line = serde_json::json!({
            "type": "assistant",
            "content": "Working on it"
        })
        .to_string();
        let update = parser.parse_line(&line);
        assert!(update.log_entries.is_empty());

        let finalized = parser.finalize();
        assert_eq!(finalized.len(), 1);
        assert_eq!(
            finalized[0],
            LogEntry::Text {
                content: "Working on it".to_string()
            }
        );
    }

    #[test]
    fn parses_legacy_tool_use_event() {
        let mut parser = OpenCodeParserService::new();
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
        let mut parser = OpenCodeParserService::new();
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
        let mut parser = OpenCodeParserService::new();
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

    // -- Common behavior tests --

    #[test]
    fn parses_error_event() {
        let mut parser = OpenCodeParserService::new();
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
        let mut parser = OpenCodeParserService::new();

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
    fn parses_nested_error_message() {
        let mut parser = OpenCodeParserService::new();
        let line = serde_json::json!({
            "type": "error",
            "error": {"data": {"message": "Model not found: moonshot/kimi-k2.6"}}
        })
        .to_string();
        let update = parser.parse_line(&line);
        assert_eq!(update.log_entries.len(), 1);
        assert_eq!(
            update.log_entries[0],
            LogEntry::Error {
                message: "Model not found: moonshot/kimi-k2.6".to_string()
            }
        );
    }

    #[test]
    fn captures_non_json_as_text() {
        let mut parser = OpenCodeParserService::new();
        let update = parser.parse_line("Some raw output from opencode");
        assert!(update.log_entries.is_empty());

        let finalized = parser.finalize();
        assert_eq!(finalized.len(), 1);
        assert_eq!(
            finalized[0],
            LogEntry::Text {
                content: "Some raw output from opencode".to_string()
            }
        );
    }

    #[test]
    fn skips_empty_lines() {
        let mut parser = OpenCodeParserService::new();
        assert!(parser.parse_line("").log_entries.is_empty());
        assert!(parser.parse_line("   ").log_entries.is_empty());
    }

    #[test]
    fn skips_empty_text_content() {
        let mut parser = OpenCodeParserService::new();
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
        let mut parser = OpenCodeParserService::new();
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
        let mut parser = OpenCodeParserService::new();
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
        let mut parser = OpenCodeParserService::new();
        let line = serde_json::json!({
            "type": "status",
            "content": "Processing step 3/10"
        })
        .to_string();
        let update = parser.parse_line(&line);
        assert!(update.log_entries.is_empty());

        let finalized = parser.finalize();
        assert_eq!(finalized.len(), 1);
        assert_eq!(
            finalized[0],
            LogEntry::Text {
                content: "Processing step 3/10".to_string()
            }
        );
    }

    // -- Deferred text + finalize tests --

    #[test]
    fn finalize_returns_empty_with_no_pending_text() {
        let mut parser = OpenCodeParserService::new();
        assert!(parser.finalize().is_empty());
    }

    #[test]
    fn finalize_drops_structured_json() {
        let mut parser = OpenCodeParserService::new();
        let line = serde_json::json!({
            "type": "text",
            "part": {"type": "text", "text": "{\"type\":\"artifact\",\"content\":\"Done\"}"}
        })
        .to_string();
        parser.parse_line(&line);

        // Pure structured JSON produces no log entries — output is extracted separately.
        let finalized = parser.finalize();
        assert!(finalized.is_empty());
    }

    #[test]
    fn finalize_drops_structured_json_with_markdown_fences() {
        let mut parser = OpenCodeParserService::new();
        let line = serde_json::json!({
            "type": "text",
            "part": {"type": "text", "text": "```json\n{\"type\":\"summary\",\"content\":\"Done\"}\n```"}
        })
        .to_string();
        parser.parse_line(&line);

        // Fenced structured JSON also produces no log entries.
        let finalized = parser.finalize();
        assert!(finalized.is_empty());
    }

    #[test]
    fn finalize_flushes_non_json_as_text() {
        let mut parser = OpenCodeParserService::new();
        parser.parse_line("just some plain text");

        let finalized = parser.finalize();
        assert_eq!(finalized.len(), 1);
        assert_eq!(
            finalized[0],
            LogEntry::Text {
                content: "just some plain text".to_string()
            }
        );
    }

    #[test]
    fn finalize_flushes_json_without_type_as_text() {
        let mut parser = OpenCodeParserService::new();
        let line = serde_json::json!({
            "type": "text",
            "part": {"type": "text", "text": "{\"count\":42}"}
        })
        .to_string();
        parser.parse_line(&line);

        let finalized = parser.finalize();
        assert_eq!(finalized.len(), 1);
        assert_eq!(
            finalized[0],
            LogEntry::Text {
                content: "{\"count\":42}".to_string()
            }
        );
    }

    #[test]
    fn intermediate_text_flushed_on_tool_use() {
        let mut parser = OpenCodeParserService::new();

        let text_line = serde_json::json!({
            "type": "text",
            "part": {"type": "text", "text": "Thinking about the problem..."}
        })
        .to_string();
        let update1 = parser.parse_line(&text_line);
        assert!(update1.log_entries.is_empty());

        let tool_line = serde_json::json!({
            "type": "tool_use",
            "part": {
                "callID": "call_1",
                "tool": "bash",
                "state": {"input": {"command": "ls"}}
            }
        })
        .to_string();
        let update2 = parser.parse_line(&tool_line);

        assert_eq!(update2.log_entries.len(), 2);
        assert_eq!(
            update2.log_entries[0],
            LogEntry::Text {
                content: "Thinking about the problem...".to_string()
            }
        );
        assert!(matches!(update2.log_entries[1], LogEntry::ToolUse { .. }));
    }

    #[test]
    fn last_text_persists_after_flush_for_extract_output() {
        let mut parser = OpenCodeParserService::new();

        let text_line = serde_json::json!({
            "type": "text",
            "part": {"type": "text", "text": "{\"type\":\"artifact\",\"content\":\"Result\"}"}
        })
        .to_string();
        parser.parse_line(&text_line);

        let tool_line = serde_json::json!({
            "type": "tool_use",
            "part": {
                "callID": "call_1",
                "tool": "bash",
                "state": {"input": {"command": "ls"}}
            }
        })
        .to_string();
        parser.parse_line(&tool_line);

        let output = r#"{"type":"step_finish"}"#;
        let result = parser.extract_output(output);
        let ExtractionResult::Found(json_str) = result else {
            panic!("extract_output should succeed via last_text: {result:?}");
        };
        let json: serde_json::Value = serde_json::from_str(&json_str).unwrap();
        assert_eq!(json["type"], "artifact");
    }

    // -- Output extraction tests --

    #[test]
    fn extract_from_last_text() {
        let mut parser = OpenCodeParserService::new();

        let line = serde_json::json!({
            "type": "text",
            "part": {"type": "text", "text": "{\"type\":\"artifact\",\"content\":\"Found 1 file\"}"}
        })
        .to_string();
        parser.parse_line(&line);

        let output = r#"{"type":"step_start","part":{"type":"step-start"}}
{"type":"text","part":{"text":"{\"type\":\"artifact\",\"content\":\"Found 1 file\"}"}}
{"type":"step_finish","part":{"type":"step-finish","reason":"stop"}}"#;

        let result = parser.extract_output(output);
        let ExtractionResult::Found(json_str) = result else {
            panic!("Failed: {result:?}");
        };
        let json: serde_json::Value = serde_json::from_str(&json_str).unwrap();
        assert_eq!(json["type"], "artifact");
        assert_eq!(json["content"], "Found 1 file");
    }

    #[test]
    fn extract_from_last_text_with_markdown_fences() {
        let mut parser = OpenCodeParserService::new();

        let line = serde_json::json!({
            "type": "text",
            "part": {"type": "text", "text": "```json\n{\"type\":\"summary\",\"content\":\"Done\"}\n```"}
        })
        .to_string();
        parser.parse_line(&line);

        let output = r#"{"type":"text","part":{"text":"some stuff"}}"#;
        let result = parser.extract_output(output);
        let ExtractionResult::Found(json_str) = result else {
            panic!("Failed: {result:?}");
        };
        let json: serde_json::Value = serde_json::from_str(&json_str).unwrap();
        assert_eq!(json["type"], "summary");
    }

    #[test]
    fn extract_fallback_no_last_text_returns_not_found() {
        let parser = OpenCodeParserService::new();
        let output = r#"{"type":"step_start","part":{"type":"step-start"}}
{"type":"step_finish","part":{"type":"step-finish","reason":"stop"}}"#;
        let result = parser.extract_output(output);
        assert!(
            matches!(result, ExtractionResult::NotFound),
            "Expected NotFound, got: {result:?}"
        );
    }

    #[test]
    fn extract_empty_output() {
        let parser = OpenCodeParserService::new();
        let result = parser.extract_output("");
        let ExtractionResult::Error(msg) = result else {
            panic!("Expected Error, got: {result:?}");
        };
        assert!(msg.contains("no output"));
    }

    #[test]
    fn extract_plain_text_returns_not_found() {
        let mut parser = OpenCodeParserService::new();
        let line = serde_json::json!({
            "type": "text",
            "part": {"type": "text", "text": "Here is my analysis of the codebase."}
        })
        .to_string();
        parser.parse_line(&line);

        let result = parser.extract_output(&line);
        assert!(
            matches!(result, ExtractionResult::NotFound),
            "Expected NotFound for prose-only output, got: {result:?}"
        );
    }

    #[test]
    fn extract_jsonl_takes_priority_over_last_text() {
        let mut parser = OpenCodeParserService::new();

        let line = serde_json::json!({
            "type": "text",
            "part": {"type": "text", "text": "{\"type\":\"artifact\",\"content\":\"old\"}"}
        })
        .to_string();
        parser.parse_line(&line);

        let output = r#"{"structured_output":{"type":"summary","content":"new"}}"#;
        let result = parser.extract_output(output);
        let ExtractionResult::Found(json_str) = result else {
            panic!("Failed: {result:?}");
        };
        let json: serde_json::Value = serde_json::from_str(&json_str).unwrap();
        assert_eq!(json["type"], "summary");
        assert_eq!(json["content"], "new");
    }

    // -- Mixed prose + fenced JSON tests — finalize --

    #[test]
    fn finalize_mixed_prose_and_json_emits_text_only() {
        let mut parser = OpenCodeParserService::new();
        let mixed =
            "The fix is complete.\n\n```json\n{\"type\":\"summary\",\"content\":\"done\"}\n```";
        let line = serde_json::json!({
            "type": "text",
            "part": {"type": "text", "text": mixed}
        })
        .to_string();
        parser.parse_line(&line);

        let finalized = parser.finalize();
        assert_eq!(finalized.len(), 1);
        assert_eq!(
            finalized[0],
            LogEntry::Text {
                content: "The fix is complete.".to_string()
            }
        );
    }

    #[test]
    fn finalize_mixed_json_without_type_field_emits_text_only() {
        let mut parser = OpenCodeParserService::new();
        let mixed = "Some prose\n\n```json\n{\"count\":42}\n```";
        let line = serde_json::json!({
            "type": "text",
            "part": {"type": "text", "text": mixed}
        })
        .to_string();
        parser.parse_line(&line);

        let finalized = parser.finalize();
        assert_eq!(finalized.len(), 1);
        assert!(matches!(finalized[0], LogEntry::Text { .. }));
    }

    #[test]
    fn finalize_mixed_non_json_fence_emits_text_only() {
        let mut parser = OpenCodeParserService::new();
        let mixed = "Explanation\n\n```\nnot json\n```";
        let line = serde_json::json!({
            "type": "text",
            "part": {"type": "text", "text": mixed}
        })
        .to_string();
        parser.parse_line(&line);

        let finalized = parser.finalize();
        assert_eq!(finalized.len(), 1);
        assert!(matches!(finalized[0], LogEntry::Text { .. }));
    }

    #[test]
    fn finalize_mixed_empty_prose_emits_nothing() {
        let mut parser = OpenCodeParserService::new();
        let mixed = "\n```json\n{\"type\":\"artifact\",\"content\":\"result\"}\n```";
        let line = serde_json::json!({
            "type": "text",
            "part": {"type": "text", "text": mixed}
        })
        .to_string();
        parser.parse_line(&line);

        // No prose, no StructuredOutput entry — JSON-only output produces empty vec.
        let finalized = parser.finalize();
        assert!(finalized.is_empty());
    }

    // -- Mixed prose + fenced JSON tests — extract_output --

    #[test]
    fn extract_output_mixed_last_text_extracts_json() {
        let mut parser = OpenCodeParserService::new();
        let mixed =
            "The fix is complete.\n\n```json\n{\"type\":\"summary\",\"content\":\"done\"}\n```";
        let line = serde_json::json!({
            "type": "text",
            "part": {"type": "text", "text": mixed}
        })
        .to_string();
        parser.parse_line(&line);

        let output = r#"{"type":"step_finish","part":{"type":"step-finish"}}"#;
        let result = parser.extract_output(output);
        let ExtractionResult::Found(json_str) = result else {
            panic!("Failed: {result:?}");
        };
        let json: serde_json::Value = serde_json::from_str(&json_str).unwrap();
        assert_eq!(json["type"], "summary");
        assert_eq!(json["content"], "done");
    }

    // -- Other existing tests --

    #[test]
    fn tracks_last_text_across_multiple_events() {
        let mut parser = OpenCodeParserService::new();

        let line1 = serde_json::json!({
            "type": "text",
            "part": {"type": "text", "text": "First thought"}
        })
        .to_string();
        parser.parse_line(&line1);

        let line2 = serde_json::json!({
            "type": "text",
            "part": {"type": "text", "text": "{\"type\":\"artifact\",\"content\":\"Final output\"}"}
        })
        .to_string();
        parser.parse_line(&line2);

        let output = r#"{"type":"step_finish","part":{"type":"step-finish"}}"#;
        let result = parser.extract_output(output);
        let ExtractionResult::Found(json_str) = result else {
            panic!("Failed: {result:?}");
        };
        let json: serde_json::Value = serde_json::from_str(&json_str).unwrap();
        assert_eq!(json["content"], "Final output");
    }
}
