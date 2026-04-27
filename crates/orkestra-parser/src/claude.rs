//! Claude Code parser service.
//!
//! Holds stream parsing state and delegates to interactions.

use std::collections::{HashMap, HashSet};

use orkestra_types::domain::LogEntry;

use crate::interactions::claude::{parse_assistant_content, parse_tool_result_event};
use crate::interactions::output::{check_api_error, extract_from_jsonl, extract_from_text_content};
use crate::interface::AgentParser;
use crate::types::{ExtractionResult, ParsedUpdate};

/// Claude Code agent parser.
///
/// Combines stream parsing and output extraction for Claude Code's JSONL format.
///
/// Stream parsing state:
/// - `tool_use_map`: maps `tool_use_id` → `tool_name` for result correlation
/// - `agent_tool_ids`: tracks Agent tool invocations for subagent detection
/// - `task_agent_map`: maps Agent `tool_use_id` → agentId
/// - `last_text`: accumulated assistant text content with real newlines (for ork fence fallback)
pub struct ClaudeParserService {
    tool_use_map: HashMap<String, String>,
    agent_tool_ids: HashSet<String>,
    task_agent_map: HashMap<String, String>,
    /// Accumulated assistant text content across all JSONL events.
    ///
    /// Claude JSONL stores text as JSON string values where newlines are
    /// JSON-escaped (`\n` = bytes `0x5C 0x6E`). `serde_json` unescapes them
    /// when deserializing, so appending here gives us real newlines — the
    /// same representation that `extract_ork_fence` expects.
    last_text: Option<String>,
}

impl Default for ClaudeParserService {
    fn default() -> Self {
        Self::new()
    }
}

impl ClaudeParserService {
    pub fn new() -> Self {
        Self {
            tool_use_map: HashMap::new(),
            agent_tool_ids: HashSet::new(),
            task_agent_map: HashMap::new(),
            last_text: None,
        }
    }

    fn is_subagent_event(&self, parent_id: Option<&String>) -> bool {
        parent_id.is_some_and(|id| self.agent_tool_ids.contains(id))
    }

    /// Track Agent tool completion for subagent association.
    fn track_agent_completion(
        &mut self,
        tool_use_result: &serde_json::Value,
        entry: &serde_json::Value,
    ) {
        let Some(agent_id) = tool_use_result.get("agentId").and_then(|a| a.as_str()) else {
            return;
        };

        let tool_use_id = entry
            .get("message")
            .and_then(|m| m.get("content"))
            .and_then(|c| c.as_array())
            .and_then(|arr| {
                arr.iter().find_map(|item| {
                    if item.get("type").and_then(|t| t.as_str()) == Some("tool_result") {
                        item.get("tool_use_id").and_then(|id| id.as_str())
                    } else {
                        None
                    }
                })
            });

        if let Some(id) = tool_use_id {
            self.task_agent_map
                .insert(id.to_string(), agent_id.to_string());
        }
    }

    /// Parse a single JSONL line into log entries.
    fn parse_line_entries(&mut self, line: &str) -> Vec<LogEntry> {
        let trimmed = line.trim();
        if trimmed.is_empty() {
            return Vec::new();
        }

        let v: serde_json::Value = match serde_json::from_str(trimmed) {
            Ok(v) => v,
            Err(_) => return Vec::new(),
        };

        let msg_type = v.get("type").and_then(|t| t.as_str()).unwrap_or("");
        let parent_id = v
            .get("parent_tool_use_id")
            .and_then(|p| p.as_str())
            .map(String::from);
        let is_subagent = self.is_subagent_event(parent_id.as_ref());

        // Track Agent tool completions for subagent association
        if let Some(tool_use_result) = v.get("toolUseResult") {
            self.track_agent_completion(tool_use_result, &v);
        }

        if msg_type == "assistant" {
            if let Some(content) = v
                .get("message")
                .and_then(|m| m.get("content"))
                .and_then(|c| c.as_array())
            {
                // Accumulate text content with real newlines for ork fence fallback.
                // serde_json unescapes JSON string escapes when deserializing, so
                // `.as_str()` gives us real newlines even though JSONL stores them escaped.
                if !is_subagent {
                    for item in content {
                        if item.get("type").and_then(|t| t.as_str()) == Some("text") {
                            if let Some(text) = item.get("text").and_then(|t| t.as_str()) {
                                if !text.trim().is_empty() {
                                    let acc = self.last_text.get_or_insert_with(String::new);
                                    if !acc.is_empty() {
                                        acc.push('\n');
                                    }
                                    acc.push_str(text);
                                }
                            }
                        }
                    }
                }

                return parse_assistant_content::execute(
                    content,
                    is_subagent,
                    parent_id.as_deref(),
                    &mut self.tool_use_map,
                    &mut self.agent_tool_ids,
                );
            }
        } else if msg_type == "user" {
            if let Some(content) = v
                .get("message")
                .and_then(|m| m.get("content"))
                .and_then(|c| c.as_array())
            {
                return parse_tool_result_event::execute(
                    content,
                    is_subagent,
                    parent_id.as_deref(),
                    &self.tool_use_map,
                );
            }
        }

        Vec::new()
    }
}

impl AgentParser for ClaudeParserService {
    fn parse_line(&mut self, line: &str) -> ParsedUpdate {
        let log_entries = self.parse_line_entries(line);
        // Claude Code doesn't generate session IDs from the stream —
        // the caller supplies them upfront via --session-id.
        ParsedUpdate {
            log_entries,
            session_id: None,
        }
    }

    fn finalize(&mut self) -> Vec<LogEntry> {
        Vec::new()
    }

    fn extract_output(&self, full_output: &str) -> ExtractionResult {
        let trimmed = full_output.trim();

        if trimmed.is_empty() {
            return ExtractionResult::Error(
                "Agent produced no output (process may have exited unexpectedly)".to_string(),
            );
        }

        // Check for API error in the last line
        if let Some(last_line) = trimmed.lines().next_back() {
            if let Some(error_msg) = check_api_error::execute(last_line.trim()) {
                return ExtractionResult::Error(format!("API error: {error_msg}"));
            }
        }

        // Primary: JSONL extraction (StructuredOutput tool path)
        if let Some(json_str) = extract_from_jsonl::execute(trimmed) {
            return ExtractionResult::Found(json_str);
        }

        // Fallback: text-based extraction strategies (strip fences, fenced JSON, ork fence).
        //
        // Text content is accumulated during streaming with real newlines (serde_json
        // unescapes JSON string escapes when deserializing). Running these strategies
        // on raw JSONL would not work because the fence newlines are JSON-escaped there.
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

    fn assistant_text(text: &str) -> String {
        serde_json::json!({
            "type": "assistant",
            "message": {
                "content": [
                    {"type": "text", "text": text}
                ]
            }
        })
        .to_string()
    }

    fn assistant_tool_use(tool_name: &str, tool_id: &str, input: &serde_json::Value) -> String {
        serde_json::json!({
            "type": "assistant",
            "message": {
                "content": [
                    {
                        "type": "tool_use",
                        "name": tool_name,
                        "id": tool_id,
                        "input": input
                    }
                ]
            }
        })
        .to_string()
    }

    fn user_tool_result(tool_use_id: &str, content: &str) -> String {
        serde_json::json!({
            "type": "user",
            "message": {
                "content": [
                    {
                        "type": "tool_result",
                        "tool_use_id": tool_use_id,
                        "content": content
                    }
                ]
            }
        })
        .to_string()
    }

    fn subagent_tool_use(
        tool_name: &str,
        tool_id: &str,
        input: &serde_json::Value,
        parent_tool_use_id: &str,
    ) -> String {
        serde_json::json!({
            "type": "assistant",
            "parent_tool_use_id": parent_tool_use_id,
            "message": {
                "content": [
                    {
                        "type": "tool_use",
                        "name": tool_name,
                        "id": tool_id,
                        "input": input
                    }
                ]
            }
        })
        .to_string()
    }

    // -- Stream parsing tests --

    #[test]
    fn parses_assistant_text() {
        let mut parser = ClaudeParserService::new();
        let update = parser.parse_line(&assistant_text("Hello world"));
        assert_eq!(update.log_entries.len(), 1);
        assert_eq!(
            update.log_entries[0],
            LogEntry::Text {
                content: "Hello world".to_string()
            }
        );
        assert!(update.session_id.is_none());
    }

    #[test]
    fn skips_empty_text() {
        let mut parser = ClaudeParserService::new();
        let update = parser.parse_line(&assistant_text("   "));
        assert!(update.log_entries.is_empty());
    }

    #[test]
    fn skips_empty_lines() {
        let mut parser = ClaudeParserService::new();
        assert!(parser.parse_line("").log_entries.is_empty());
        assert!(parser.parse_line("   ").log_entries.is_empty());
    }

    #[test]
    fn skips_invalid_json() {
        let mut parser = ClaudeParserService::new();
        assert!(parser.parse_line("not json at all").log_entries.is_empty());
    }

    #[test]
    fn parses_tool_use() {
        let mut parser = ClaudeParserService::new();
        let line = assistant_tool_use(
            "Read",
            "tu_123",
            &serde_json::json!({"file_path": "/foo/bar.rs"}),
        );
        let update = parser.parse_line(&line);
        assert_eq!(update.log_entries.len(), 1);
        match &update.log_entries[0] {
            LogEntry::ToolUse { tool, id, input } => {
                assert_eq!(tool, "Read");
                assert_eq!(id, "tu_123");
                assert_eq!(
                    *input,
                    ToolInput::Read {
                        file_path: "/foo/bar.rs".to_string()
                    }
                );
            }
            other => panic!("Expected ToolUse, got {other:?}"),
        }
    }

    #[test]
    fn parses_tool_result_for_agent() {
        let mut parser = ClaudeParserService::new();

        let tool_line = assistant_tool_use(
            "Agent",
            "tu_task_1",
            &serde_json::json!({"description": "do something"}),
        );
        parser.parse_line(&tool_line);

        let result_line = user_tool_result("tu_task_1", "Agent completed successfully");
        let update = parser.parse_line(&result_line);
        assert_eq!(update.log_entries.len(), 1);
        match &update.log_entries[0] {
            LogEntry::ToolResult {
                tool,
                tool_use_id,
                content,
            } => {
                assert_eq!(tool, "Agent");
                assert_eq!(tool_use_id, "tu_task_1");
                assert_eq!(content, "Agent completed successfully");
            }
            other => panic!("Expected ToolResult, got {other:?}"),
        }
    }

    #[test]
    fn skips_non_agent_tool_results() {
        let mut parser = ClaudeParserService::new();

        let tool_line = assistant_tool_use(
            "Read",
            "tu_read_1",
            &serde_json::json!({"file_path": "/foo.rs"}),
        );
        parser.parse_line(&tool_line);

        let result_line = user_tool_result("tu_read_1", "file contents here");
        let update = parser.parse_line(&result_line);
        assert!(update.log_entries.is_empty());
    }

    #[test]
    fn detects_subagent_events() {
        let mut parser = ClaudeParserService::new();

        let agent_line = assistant_tool_use(
            "Agent",
            "tu_task_1",
            &serde_json::json!({"description": "do work"}),
        );
        parser.parse_line(&agent_line);

        let subagent_line = subagent_tool_use(
            "Edit",
            "tu_sub_1",
            &serde_json::json!({"file_path": "/bar.rs"}),
            "tu_task_1",
        );
        let update = parser.parse_line(&subagent_line);
        assert_eq!(update.log_entries.len(), 1);
        match &update.log_entries[0] {
            LogEntry::SubagentToolUse {
                tool,
                id,
                input,
                parent_task_id,
            } => {
                assert_eq!(tool, "Edit");
                assert_eq!(id, "tu_sub_1");
                assert_eq!(parent_task_id, "tu_task_1");
                assert_eq!(
                    *input,
                    ToolInput::Edit {
                        file_path: "/bar.rs".to_string()
                    }
                );
            }
            other => panic!("Expected SubagentToolUse, got {other:?}"),
        }
    }

    #[test]
    fn subagent_text_is_skipped() {
        let mut parser = ClaudeParserService::new();

        let agent_line = assistant_tool_use(
            "Agent",
            "tu_task_1",
            &serde_json::json!({"description": "do work"}),
        );
        parser.parse_line(&agent_line);

        let subagent_text = serde_json::json!({
            "type": "assistant",
            "parent_tool_use_id": "tu_task_1",
            "message": {
                "content": [
                    {"type": "text", "text": "Subagent thinking..."}
                ]
            }
        })
        .to_string();
        let update = parser.parse_line(&subagent_text);
        assert!(update.log_entries.is_empty());
    }

    #[test]
    fn tracks_agent_subagent_mapping() {
        let mut parser = ClaudeParserService::new();

        let agent_line = assistant_tool_use(
            "Agent",
            "tu_task_1",
            &serde_json::json!({"description": "do work"}),
        );
        parser.parse_line(&agent_line);

        let result_event = serde_json::json!({
            "type": "user",
            "toolUseResult": {"agentId": "agent-abc"},
            "message": {
                "content": [
                    {
                        "type": "tool_result",
                        "tool_use_id": "tu_task_1",
                        "content": "done"
                    }
                ]
            }
        })
        .to_string();
        parser.parse_line(&result_event);

        assert_eq!(
            parser.task_agent_map.get("tu_task_1"),
            Some(&"agent-abc".to_string())
        );
    }

    #[test]
    fn finalize_returns_empty() {
        let mut parser = ClaudeParserService::new();
        assert!(parser.finalize().is_empty());
    }

    #[test]
    fn mixed_content_in_single_message() {
        let mut parser = ClaudeParserService::new();
        let line = serde_json::json!({
            "type": "assistant",
            "message": {
                "content": [
                    {"type": "text", "text": "Let me read the file."},
                    {
                        "type": "tool_use",
                        "name": "Read",
                        "id": "tu_1",
                        "input": {"file_path": "/src/main.rs"}
                    }
                ]
            }
        })
        .to_string();

        let update = parser.parse_line(&line);
        assert_eq!(update.log_entries.len(), 2);
        assert!(
            matches!(&update.log_entries[0], LogEntry::Text { content } if content == "Let me read the file.")
        );
        assert!(matches!(&update.log_entries[1], LogEntry::ToolUse { tool, .. } if tool == "Read"));
    }

    // -- Output extraction tests --

    #[test]
    fn extract_structured_output() {
        let parser = ClaudeParserService::new();
        let output = r#"{"type":"system","subtype":"init","session_id":"abc"}
{"structured_output":{"type":"summary","content":"Work done"}}"#;
        let result = parser.extract_output(output);
        let ExtractionResult::Found(json_str) = result else {
            panic!("Expected Found, got: {result:?}");
        };
        let json: serde_json::Value = serde_json::from_str(&json_str).unwrap();
        assert_eq!(json["type"], "summary");
    }

    #[test]
    fn extract_stream_json_unwraps() {
        let parser = ClaudeParserService::new();
        let output = r#"{"type":"result","structured_output":{"content":"{\"type\":\"questions\",\"questions\":[{\"question\":\"What?\"}]}","type":"plan"}}"#;
        let result = parser.extract_output(output);
        let ExtractionResult::Found(json_str) = result else {
            panic!("Expected Found, got: {result:?}");
        };
        let json: serde_json::Value = serde_json::from_str(&json_str).unwrap();
        assert_eq!(json["type"], "questions");
    }

    #[test]
    fn extract_api_error() {
        let parser = ClaudeParserService::new();
        let output = r#"{"type":"assistant","error":"invalid_request","message":{"content":[{"type":"text","text":"Rate limit exceeded"}]}}"#;
        let result = parser.extract_output(output);
        let ExtractionResult::Error(msg) = result else {
            panic!("Expected Error, got: {result:?}");
        };
        assert!(msg.contains("Rate limit exceeded"));
    }

    #[test]
    fn extract_empty_output() {
        let parser = ClaudeParserService::new();
        let result = parser.extract_output("");
        let ExtractionResult::Error(msg) = result else {
            panic!("Expected Error, got: {result:?}");
        };
        assert!(msg.contains("no output"));
    }

    #[test]
    fn extract_plain_text_returns_not_found() {
        let mut parser = ClaudeParserService::new();
        parser.parse_line(&assistant_text("Here is my analysis of the code."));
        let output = assistant_text("Here is my analysis of the code.");
        let result = parser.extract_output(&output);
        assert!(
            matches!(result, ExtractionResult::NotFound),
            "Expected NotFound for prose-only output, got: {result:?}"
        );
    }

    #[test]
    fn extract_ork_fence_from_jsonl_text_content() {
        // Regression: ork fence in Claude JSONL text content must be extracted correctly.
        // The text field is JSON-unescaped by serde_json, so the accumulated `last_text`
        // has real newlines — `extract_ork_fence` operates on that, not raw JSONL.
        let mut parser = ClaudeParserService::new();

        // Simulate the agent outputting an ork fence in a text content block.
        // The JSON text value contains \n which serde_json unescapes to real newlines.
        let ork_content = "```ork\n{\"type\":\"summary\",\"content\":\"done via ork fence\"}\n```";
        let jsonl_line = assistant_text(ork_content);
        parser.parse_line(&jsonl_line);

        // extract_output should find the ork fence in accumulated last_text
        let result = parser.extract_output(&jsonl_line);
        let ExtractionResult::Found(json_str) = result else {
            panic!("Expected ork fence extraction to succeed: {result:?}");
        };
        let json: serde_json::Value = serde_json::from_str(&json_str).unwrap();
        assert_eq!(json["type"], "summary");
        assert_eq!(json["content"], "done via ork fence");
    }

    #[test]
    fn extract_markdown_fenced_json_from_text_content() {
        // Regression: markdown-fenced JSON in Claude JSONL text content must be extracted.
        let mut parser = ClaudeParserService::new();

        let fenced = "```json\n{\"type\":\"summary\",\"content\":\"via markdown fence\"}\n```";
        let jsonl_line = assistant_text(fenced);
        parser.parse_line(&jsonl_line);

        let result = parser.extract_output(&jsonl_line);
        let ExtractionResult::Found(json_str) = result else {
            panic!("Expected markdown-fenced JSON extraction to succeed: {result:?}");
        };
        let json: serde_json::Value = serde_json::from_str(&json_str).unwrap();
        assert_eq!(json["type"], "summary");
        assert_eq!(json["content"], "via markdown fence");
    }

    #[test]
    fn extract_ork_fence_from_jsonl_multi_message() {
        // Multiple assistant messages with text content — ork fence in last message wins.
        let mut parser = ClaudeParserService::new();

        parser.parse_line(&assistant_text("Here is my analysis..."));
        parser.parse_line(&assistant_text(
            "```ork\n{\"type\":\"artifact\",\"content\":\"result\"}\n```",
        ));

        // Use a JSONL output string that would not contain a direct structured_output field
        let output = format!(
            "{}\n{}",
            assistant_text("Here is my analysis..."),
            assistant_text("```ork\n{\"type\":\"artifact\",\"content\":\"result\"}\n```"),
        );
        let result = parser.extract_output(&output);
        let ExtractionResult::Found(json_str) = result else {
            panic!("Expected ork fence extraction from multi-message: {result:?}");
        };
        let json: serde_json::Value = serde_json::from_str(&json_str).unwrap();
        assert_eq!(json["type"], "artifact");
    }
}
