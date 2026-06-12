//! Codex parser service.
//!
//! Holds stream parsing state and delegates to interactions.

use orkestra_types::domain::LogEntry;
use orkestra_types::domain::TokenUsage;

use crate::interactions::codex::{extract_item_event, extract_text_content};
use crate::interactions::opencode::classify_buffered_text;
use crate::interactions::output::{extract_from_jsonl, extract_from_text_content};
use crate::interface::AgentParser;
use crate::types::{ExtractionResult, ParsedUpdate};

/// Codex agent parser.
///
/// Combines stream parsing and output extraction for Codex's JSONL event stream.
///
/// During streaming, tracks:
/// - `session_id`: extracted from `thread.started`'s `thread_id` field
/// - `last_text`: the most recent `agent_message` text (used as fallback for output extraction)
pub struct CodexParserService {
    /// The session ID extracted from `thread.started`, if any.
    session_id: Option<String>,
    /// Whether the session ID has been emitted via `ParsedUpdate`.
    session_id_emitted: bool,
    /// The last `agent_message` text seen during streaming (used as extraction fallback).
    last_text: Option<String>,
    /// Buffered text event awaiting the next event before emission.
    ///
    /// Text events are deferred so that the final structured output JSON (which
    /// arrives as an `agent_message` right before `turn.completed`) can be classified
    /// in `finalize()` and suppressed rather than emitted as a spurious `Text` entry.
    pending_text: Option<String>,
    /// Token usage extracted from the most recent `turn.completed` event.
    last_token_usage: Option<TokenUsage>,
    /// Cost extracted from streaming events. Codex does not report cost yet; reserved for
    /// forward compatibility.
    last_cost: Option<f64>,
}

impl Default for CodexParserService {
    fn default() -> Self {
        Self::new()
    }
}

impl CodexParserService {
    pub fn new() -> Self {
        Self {
            session_id: None,
            session_id_emitted: false,
            last_text: None,
            pending_text: None,
            last_token_usage: None,
            last_cost: None,
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

    /// Parse a single JSON line into log entries.
    fn parse_line_entries(&mut self, line: &str) -> Vec<LogEntry> {
        let trimmed = line.trim();
        if trimmed.is_empty() {
            return Vec::new();
        }

        let Ok(v) = serde_json::from_str::<serde_json::Value>(trimmed) else {
            return self.buffer_text(trimmed.to_string());
        };

        let event_type = v.get("type").and_then(|t| t.as_str()).unwrap_or("");

        match event_type {
            "thread.started" => {
                if self.session_id.is_none() {
                    if let Some(tid) = v["thread_id"].as_str() {
                        if !tid.is_empty() {
                            self.session_id = Some(tid.to_string());
                        }
                    }
                }
                Vec::new()
            }

            "turn.started" => Vec::new(),

            "item.started" => {
                let mut entries = Vec::new();
                if let Some(flushed) = self.flush_pending_text() {
                    entries.push(flushed);
                }
                entries.extend(extract_item_event::execute(&v));
                entries
            }

            "item.completed" => {
                let item_type = v["item"]["type"].as_str().unwrap_or("");
                if item_type == "command_execution" {
                    let mut entries = Vec::new();
                    if let Some(flushed) = self.flush_pending_text() {
                        entries.push(flushed);
                    }
                    entries.extend(extract_item_event::execute(&v));
                    entries
                } else {
                    // agent_message or unknown item types: buffer as deferred text
                    if let Some(content) = extract_text_content::execute(&v) {
                        self.buffer_text(content)
                    } else {
                        Vec::new()
                    }
                }
            }

            // Do NOT flush pending_text: the structured output JSON arrives as
            // an agent_message right before turn.completed. Flushing here would
            // emit it as plain Text before finalize() can classify it.
            "turn.completed" => {
                if let Some(usage) = v.get("usage") {
                    self.last_token_usage = Some(TokenUsage {
                        input_tokens: usage["input_tokens"].as_u64().unwrap_or(0),
                        output_tokens: usage["output_tokens"].as_u64().unwrap_or(0),
                        cache_read_input_tokens: usage["cached_input_tokens"].as_u64().unwrap_or(0),
                        ..TokenUsage::default()
                    });
                }
                Vec::new()
            }

            "error" | "turn.failed" => {
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

impl AgentParser for CodexParserService {
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
            token_usage: self.last_token_usage.take(),
            cost: self.last_cost.take(),
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

        // Try JSONL scan first (for compatibility)
        if let Some(json_str) = extract_from_jsonl::execute(trimmed) {
            return ExtractionResult::Found(json_str);
        }

        // Fall back to last_text (accumulated during streaming)
        if let Some(ref text) = self.last_text {
            match extract_from_text_content::execute(text) {
                Some(extract_from_text_content::TextExtractionResult::Found(json_str)) => {
                    return ExtractionResult::Found(json_str);
                }
                Some(extract_from_text_content::TextExtractionResult::Malformed(msg)) => {
                    return ExtractionResult::Malformed(msg);
                }
                None => {}
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

    // -- thread.started / session ID --

    #[test]
    fn thread_started_extracts_session_id() {
        let mut parser = CodexParserService::new();
        let line = serde_json::json!({
            "type": "thread.started",
            "thread_id": "019ebcd6-fc53-70d1-a008-2f5550cc77fb"
        })
        .to_string();
        let update = parser.parse_line(&line);
        assert!(update.log_entries.is_empty());
        assert_eq!(
            update.session_id,
            Some("019ebcd6-fc53-70d1-a008-2f5550cc77fb".to_string())
        );
    }

    #[test]
    fn session_id_emitted_once() {
        let mut parser = CodexParserService::new();
        let thread_line = serde_json::json!({
            "type": "thread.started",
            "thread_id": "tid_abc"
        })
        .to_string();
        let text_line = serde_json::json!({
            "type": "item.completed",
            "item": {"type": "agent_message", "text": "hello"}
        })
        .to_string();

        let update1 = parser.parse_line(&thread_line);
        assert_eq!(update1.session_id, Some("tid_abc".to_string()));

        let update2 = parser.parse_line(&text_line);
        assert!(update2.session_id.is_none());
    }

    // -- turn.started --

    #[test]
    fn turn_started_skipped() {
        let mut parser = CodexParserService::new();
        let line = serde_json::json!({"type": "turn.started"}).to_string();
        let update = parser.parse_line(&line);
        assert!(update.log_entries.is_empty());
        assert!(update.session_id.is_none());
    }

    // -- item.started / item.completed (command_execution) --

    #[test]
    fn item_started_emits_tool_use() {
        let mut parser = CodexParserService::new();
        let line = serde_json::json!({
            "type": "item.started",
            "item": {
                "id": "item_0",
                "type": "command_execution",
                "command": "/bin/zsh -lc 'echo hello'",
                "aggregated_output": "",
                "exit_code": null,
                "status": "in_progress"
            }
        })
        .to_string();
        let update = parser.parse_line(&line);
        assert_eq!(update.log_entries.len(), 1);
        match &update.log_entries[0] {
            LogEntry::ToolUse { tool, id, input } => {
                assert_eq!(tool, "shell");
                assert_eq!(id, "item_0");
                assert_eq!(
                    *input,
                    ToolInput::Bash {
                        command: "/bin/zsh -lc 'echo hello'".to_string()
                    }
                );
            }
            other => panic!("Expected ToolUse, got {other:?}"),
        }
    }

    #[test]
    fn item_completed_command_execution_emits_tool_result() {
        let mut parser = CodexParserService::new();
        let line = serde_json::json!({
            "type": "item.completed",
            "item": {
                "id": "item_0",
                "type": "command_execution",
                "command": "/bin/zsh -lc 'echo hello'",
                "aggregated_output": "hello\n",
                "exit_code": 0,
                "status": "completed"
            }
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
                assert_eq!(tool, "shell");
                assert_eq!(tool_use_id, "item_0");
                assert_eq!(content, "hello");
            }
            other => panic!("Expected ToolResult, got {other:?}"),
        }
    }

    // -- agent_message text buffering --

    #[test]
    fn agent_message_buffered_and_flushed_on_finalize() {
        let mut parser = CodexParserService::new();
        let line = serde_json::json!({
            "type": "item.completed",
            "item": {"type": "agent_message", "text": "done"}
        })
        .to_string();
        let update = parser.parse_line(&line);
        assert!(update.log_entries.is_empty());

        let finalized = parser.finalize();
        assert_eq!(finalized.len(), 1);
        assert_eq!(
            finalized[0],
            LogEntry::Text {
                content: "done".to_string()
            }
        );
    }

    #[test]
    fn deferred_text_flushed_on_tool_event() {
        let mut parser = CodexParserService::new();

        let text_line = serde_json::json!({
            "type": "item.completed",
            "item": {"type": "agent_message", "text": "thinking..."}
        })
        .to_string();
        let update1 = parser.parse_line(&text_line);
        assert!(update1.log_entries.is_empty());

        let tool_line = serde_json::json!({
            "type": "item.started",
            "item": {
                "id": "item_0",
                "type": "command_execution",
                "command": "ls",
                "aggregated_output": "",
                "exit_code": null,
                "status": "in_progress"
            }
        })
        .to_string();
        let update2 = parser.parse_line(&tool_line);
        assert_eq!(update2.log_entries.len(), 2);
        assert_eq!(
            update2.log_entries[0],
            LogEntry::Text {
                content: "thinking...".to_string()
            }
        );
        assert!(matches!(update2.log_entries[1], LogEntry::ToolUse { .. }));
    }

    // -- turn.completed token usage --

    #[test]
    fn turn_completed_extracts_token_usage() {
        let mut parser = CodexParserService::new();
        let line = serde_json::json!({
            "type": "turn.completed",
            "usage": {
                "input_tokens": 25161,
                "cached_input_tokens": 22784,
                "output_tokens": 40,
                "reasoning_output_tokens": 0
            }
        })
        .to_string();
        let update = parser.parse_line(&line);
        assert!(update.log_entries.is_empty());
        let usage = update.token_usage.expect("token_usage should be populated");
        assert_eq!(usage.input_tokens, 25161);
        assert_eq!(usage.output_tokens, 40);
        assert_eq!(usage.cache_read_input_tokens, 22784);
        assert_eq!(usage.cache_creation_input_tokens, 0);
    }

    #[test]
    fn turn_completed_does_not_flush_pending_text() {
        let mut parser = CodexParserService::new();

        let text_line = serde_json::json!({
            "type": "item.completed",
            "item": {"type": "agent_message", "text": "buffered text"}
        })
        .to_string();
        parser.parse_line(&text_line);

        let finish_line = serde_json::json!({
            "type": "turn.completed",
            "usage": {"input_tokens": 100, "output_tokens": 10, "cached_input_tokens": 0}
        })
        .to_string();
        let update = parser.parse_line(&finish_line);
        assert!(
            update.log_entries.is_empty(),
            "turn.completed must not flush pending_text"
        );
    }

    // -- error events --

    #[test]
    fn error_event_emits_error_entry() {
        let mut parser = CodexParserService::new();
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
    fn turn_failed_emits_error_entry() {
        let mut parser = CodexParserService::new();
        let line = serde_json::json!({
            "type": "turn.failed",
            "error": {"message": "Model overloaded"}
        })
        .to_string();
        let update = parser.parse_line(&line);
        assert_eq!(update.log_entries.len(), 1);
        assert_eq!(
            update.log_entries[0],
            LogEntry::Error {
                message: "Model overloaded".to_string()
            }
        );
    }

    #[test]
    fn error_event_flushes_pending_text() {
        let mut parser = CodexParserService::new();

        let text_line = serde_json::json!({
            "type": "item.completed",
            "item": {"type": "agent_message", "text": "partial output"}
        })
        .to_string();
        parser.parse_line(&text_line);

        let error_line = serde_json::json!({
            "type": "error",
            "message": "API error"
        })
        .to_string();
        let update = parser.parse_line(&error_line);
        assert_eq!(update.log_entries.len(), 2);
        assert_eq!(
            update.log_entries[0],
            LogEntry::Text {
                content: "partial output".to_string()
            }
        );
        assert!(matches!(update.log_entries[1], LogEntry::Error { .. }));
    }

    // -- finalize --

    #[test]
    fn finalize_returns_empty_with_no_pending_text() {
        let mut parser = CodexParserService::new();
        assert!(parser.finalize().is_empty());
    }

    #[test]
    fn finalize_drops_structured_json() {
        let mut parser = CodexParserService::new();
        let line = serde_json::json!({
            "type": "item.completed",
            "item": {
                "type": "agent_message",
                "text": "{\"type\":\"summary\",\"content\":\"Done\"}"
            }
        })
        .to_string();
        parser.parse_line(&line);

        let finalized = parser.finalize();
        assert!(finalized.is_empty());
    }

    #[test]
    fn finalize_flushes_plain_text() {
        let mut parser = CodexParserService::new();
        let line = serde_json::json!({
            "type": "item.completed",
            "item": {"type": "agent_message", "text": "plain response"}
        })
        .to_string();
        parser.parse_line(&line);

        let finalized = parser.finalize();
        assert_eq!(finalized.len(), 1);
        assert_eq!(
            finalized[0],
            LogEntry::Text {
                content: "plain response".to_string()
            }
        );
    }

    // -- structured output extraction --

    #[test]
    fn extract_output_from_last_text() {
        let mut parser = CodexParserService::new();
        let line = serde_json::json!({
            "type": "item.completed",
            "item": {
                "type": "agent_message",
                "text": "{\"type\":\"summary\",\"content\":\"All done\"}"
            }
        })
        .to_string();
        parser.parse_line(&line);

        let output = r#"{"type":"turn.completed","usage":{"input_tokens":100,"output_tokens":10,"cached_input_tokens":0}}"#;
        let result = parser.extract_output(output);
        let ExtractionResult::Found(json_str) = result else {
            panic!("Expected Found, got: {result:?}");
        };
        let json: serde_json::Value = serde_json::from_str(&json_str).unwrap();
        assert_eq!(json["type"], "summary");
        assert_eq!(json["content"], "All done");
    }

    #[test]
    fn extract_output_empty_returns_error() {
        let parser = CodexParserService::new();
        let result = parser.extract_output("");
        assert!(
            matches!(result, ExtractionResult::Error(_)),
            "Expected Error, got: {result:?}"
        );
    }

    #[test]
    fn extract_output_no_structured_output_returns_not_found() {
        let parser = CodexParserService::new();
        let result = parser.extract_output(r#"{"type":"turn.completed"}"#);
        assert!(
            matches!(result, ExtractionResult::NotFound),
            "Expected NotFound, got: {result:?}"
        );
    }

    #[test]
    fn last_text_persists_after_tool_flush_for_extract_output() {
        let mut parser = CodexParserService::new();

        // Buffer structured JSON as agent_message
        let text_line = serde_json::json!({
            "type": "item.completed",
            "item": {
                "type": "agent_message",
                "text": "{\"type\":\"summary\",\"content\":\"Result\"}"
            }
        })
        .to_string();
        parser.parse_line(&text_line);

        // Flush pending_text via a tool event
        let tool_line = serde_json::json!({
            "type": "item.started",
            "item": {
                "id": "item_x",
                "type": "command_execution",
                "command": "ls",
                "aggregated_output": "",
                "exit_code": null,
                "status": "in_progress"
            }
        })
        .to_string();
        parser.parse_line(&tool_line);

        // last_text should still hold the structured JSON
        let result = parser.extract_output(r#"{"type":"turn.completed"}"#);
        let ExtractionResult::Found(json_str) = result else {
            panic!("Expected Found via last_text fallback: {result:?}");
        };
        let json: serde_json::Value = serde_json::from_str(&json_str).unwrap();
        assert_eq!(json["type"], "summary");
    }

    // -- unknown events --

    #[test]
    fn unknown_event_without_content_skipped() {
        let mut parser = CodexParserService::new();
        let line = serde_json::json!({"type": "metadata", "data": 42}).to_string();
        let update = parser.parse_line(&line);
        assert!(update.log_entries.is_empty());
    }

    #[test]
    fn empty_line_skipped() {
        let mut parser = CodexParserService::new();
        assert!(parser.parse_line("").log_entries.is_empty());
        assert!(parser.parse_line("   ").log_entries.is_empty());
    }
}
