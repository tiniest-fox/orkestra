//! Claude Code agent parser.
//!
//! Handles both stream parsing (JSONL events → `LogEntry`) and output extraction
//! (`structured_output` → raw JSON string).

use std::collections::{HashMap, HashSet};

use crate::workflow::domain::LogEntry;
use crate::workflow::services::session_logs::{
    extract_tool_result_content, parse_resume_marker, parse_tool_input,
};

use super::{check_for_api_error, extract_from_jsonl, AgentParser, ParsedUpdate};

/// Claude Code agent parser.
///
/// Combines stream parsing and output extraction for Claude Code's JSONL format.
///
/// Stream parsing state:
/// - `tool_use_map`: maps `tool_use_id` → `tool_name` for result correlation
/// - `task_tool_ids`: tracks Task tool invocations for subagent detection
/// - `task_agent_map`: maps Task `tool_use_id` → agentId
pub struct ClaudeAgentParser {
    tool_use_map: HashMap<String, String>,
    task_tool_ids: HashSet<String>,
    task_agent_map: HashMap<String, String>,
}

impl Default for ClaudeAgentParser {
    fn default() -> Self {
        Self::new()
    }
}

impl ClaudeAgentParser {
    pub fn new() -> Self {
        Self {
            tool_use_map: HashMap::new(),
            task_tool_ids: HashSet::new(),
            task_agent_map: HashMap::new(),
        }
    }

    fn is_subagent_event(&self, parent_id: Option<&String>) -> bool {
        parent_id.is_some_and(|id| self.task_tool_ids.contains(id))
    }

    fn parse_text(item: &serde_json::Value, is_subagent: bool) -> Option<LogEntry> {
        if is_subagent {
            return None;
        }
        let text = item.get("text").and_then(|t| t.as_str())?;
        let trimmed = text.trim();
        if trimmed.is_empty() {
            return None;
        }
        Some(LogEntry::Text {
            content: trimmed.to_string(),
        })
    }

    fn parse_tool_use(
        &mut self,
        item: &serde_json::Value,
        is_subagent: bool,
        parent_id: Option<&String>,
    ) -> LogEntry {
        let tool_name = item
            .get("name")
            .and_then(|n| n.as_str())
            .unwrap_or("unknown")
            .to_string();
        let tool_id = item
            .get("id")
            .and_then(|i| i.as_str())
            .unwrap_or("")
            .to_string();
        let input = item.get("input").cloned().unwrap_or(serde_json::json!({}));

        self.tool_use_map.insert(tool_id.clone(), tool_name.clone());
        if tool_name == "Task" {
            self.task_tool_ids.insert(tool_id.clone());
        }

        let tool_input = parse_tool_input(&tool_name, &input);

        if is_subagent {
            LogEntry::SubagentToolUse {
                tool: tool_name,
                id: tool_id,
                input: tool_input,
                parent_task_id: parent_id.cloned().unwrap_or_default(),
            }
        } else {
            LogEntry::ToolUse {
                tool: tool_name,
                id: tool_id,
                input: tool_input,
            }
        }
    }

    fn parse_tool_result(
        &self,
        item: &serde_json::Value,
        is_subagent: bool,
        parent_id: Option<&String>,
    ) -> Option<LogEntry> {
        let tool_use_id = item
            .get("tool_use_id")
            .and_then(|i| i.as_str())
            .unwrap_or("")
            .to_string();
        let tool_name = self
            .tool_use_map
            .get(&tool_use_id)
            .cloned()
            .unwrap_or_else(|| "unknown".to_string());
        let content_str = extract_tool_result_content(item);

        if content_str.trim().is_empty() {
            return None;
        }

        if is_subagent {
            Some(LogEntry::SubagentToolResult {
                tool: tool_name,
                tool_use_id,
                content: content_str,
                parent_task_id: parent_id.cloned().unwrap_or_default(),
            })
        } else if tool_name == "Task" {
            Some(LogEntry::ToolResult {
                tool: tool_name,
                tool_use_id,
                content: content_str,
            })
        } else {
            None
        }
    }

    /// Track Task tool completion for subagent association.
    fn track_task_agent(&mut self, tool_use_result: &serde_json::Value, entry: &serde_json::Value) {
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

        // Track Task tool completions for subagent association
        if let Some(tool_use_result) = v.get("toolUseResult") {
            self.track_task_agent(tool_use_result, &v);
        }

        let mut entries = Vec::new();

        if msg_type == "assistant" {
            if let Some(content) = v
                .get("message")
                .and_then(|m| m.get("content"))
                .and_then(|c| c.as_array())
            {
                for item in content {
                    match item.get("type").and_then(|t| t.as_str()) {
                        Some("text") => {
                            if let Some(entry) = Self::parse_text(item, is_subagent) {
                                entries.push(entry);
                            }
                        }
                        Some("tool_use") => {
                            entries.push(self.parse_tool_use(
                                item,
                                is_subagent,
                                parent_id.as_ref(),
                            ));
                        }
                        _ => {}
                    }
                }
            }
        } else if msg_type == "user" {
            let content = v.get("message").and_then(|m| m.get("content"));

            if let Some(arr) = content.and_then(|c| c.as_array()) {
                for item in arr {
                    match item.get("type").and_then(|t| t.as_str()) {
                        Some("tool_result") => {
                            if let Some(entry) =
                                self.parse_tool_result(item, is_subagent, parent_id.as_ref())
                            {
                                entries.push(entry);
                            }
                        }
                        Some("text") => {
                            if let Some(text) = item.get("text").and_then(|t| t.as_str()) {
                                if let Some(marker) = parse_resume_marker(text) {
                                    entries.push(LogEntry::UserMessage {
                                        resume_type: marker.marker_type.as_str().to_string(),
                                        content: marker.content,
                                    });
                                }
                            }
                        }
                        _ => {}
                    }
                }
            } else if let Some(text) = content.and_then(|c| c.as_str()) {
                if let Some(marker) = parse_resume_marker(text) {
                    entries.push(LogEntry::UserMessage {
                        resume_type: marker.marker_type.as_str().to_string(),
                        content: marker.content,
                    });
                }
            }
        }

        entries
    }
}

impl AgentParser for ClaudeAgentParser {
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

    fn extract_output(&self, full_output: &str) -> Result<String, String> {
        let trimmed = full_output.trim();

        if trimmed.is_empty() {
            return Err(
                "Agent produced no output (process may have exited unexpectedly)".to_string(),
            );
        }

        // Check for API error in the last line
        if let Some(last_line) = trimmed.lines().next_back() {
            if let Some(error_msg) = check_for_api_error(last_line.trim()) {
                return Err(format!("API error: {error_msg}"));
            }
        }

        // Use shared JSONL extraction
        extract_from_jsonl(trimmed).ok_or_else(|| {
            format!(
                "Failed to parse agent output: no structured output found in {} bytes of output",
                trimmed.len()
            )
        })
    }
}

// ============================================================================
// Tests
// ============================================================================

#[cfg(test)]
mod tests {
    use super::*;
    use crate::workflow::domain::ToolInput;

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

    fn user_text(text: &str) -> String {
        serde_json::json!({
            "type": "user",
            "message": {
                "content": text
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

    // ========================================================================
    // Stream parsing tests
    // ========================================================================

    #[test]
    fn parses_assistant_text() {
        let mut parser = ClaudeAgentParser::new();
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
        let mut parser = ClaudeAgentParser::new();
        let update = parser.parse_line(&assistant_text("   "));
        assert!(update.log_entries.is_empty());
    }

    #[test]
    fn skips_empty_lines() {
        let mut parser = ClaudeAgentParser::new();
        assert!(parser.parse_line("").log_entries.is_empty());
        assert!(parser.parse_line("   ").log_entries.is_empty());
    }

    #[test]
    fn skips_invalid_json() {
        let mut parser = ClaudeAgentParser::new();
        assert!(parser.parse_line("not json at all").log_entries.is_empty());
    }

    #[test]
    fn parses_tool_use() {
        let mut parser = ClaudeAgentParser::new();
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
    fn parses_tool_result_for_task() {
        let mut parser = ClaudeAgentParser::new();

        // First register a Task tool use so results are captured
        let tool_line = assistant_tool_use(
            "Task",
            "tu_task_1",
            &serde_json::json!({"description": "do something"}),
        );
        parser.parse_line(&tool_line);

        let result_line = user_tool_result("tu_task_1", "Task completed successfully");
        let update = parser.parse_line(&result_line);
        assert_eq!(update.log_entries.len(), 1);
        match &update.log_entries[0] {
            LogEntry::ToolResult {
                tool,
                tool_use_id,
                content,
            } => {
                assert_eq!(tool, "Task");
                assert_eq!(tool_use_id, "tu_task_1");
                assert_eq!(content, "Task completed successfully");
            }
            other => panic!("Expected ToolResult, got {other:?}"),
        }
    }

    #[test]
    fn skips_non_task_tool_results() {
        let mut parser = ClaudeAgentParser::new();

        // Register a Read tool use
        let tool_line = assistant_tool_use(
            "Read",
            "tu_read_1",
            &serde_json::json!({"file_path": "/foo.rs"}),
        );
        parser.parse_line(&tool_line);

        // Result for Read should be skipped (only Task results are captured)
        let result_line = user_tool_result("tu_read_1", "file contents here");
        let update = parser.parse_line(&result_line);
        assert!(update.log_entries.is_empty());
    }

    #[test]
    fn detects_subagent_events() {
        let mut parser = ClaudeAgentParser::new();

        // Register a Task tool use
        let task_line = assistant_tool_use(
            "Task",
            "tu_task_1",
            &serde_json::json!({"description": "do work"}),
        );
        parser.parse_line(&task_line);

        // Subagent tool use with parent_tool_use_id pointing to the Task
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
        let mut parser = ClaudeAgentParser::new();

        // Register Task tool
        let task_line = assistant_tool_use(
            "Task",
            "tu_task_1",
            &serde_json::json!({"description": "do work"}),
        );
        parser.parse_line(&task_line);

        // Subagent text event should be skipped
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
    fn parses_resume_marker() {
        let mut parser = ClaudeAgentParser::new();
        let line = user_text("<!orkestra-resume:feedback>\n\nFix the bug");
        let update = parser.parse_line(&line);
        assert_eq!(update.log_entries.len(), 1);
        match &update.log_entries[0] {
            LogEntry::UserMessage {
                resume_type,
                content,
            } => {
                assert_eq!(resume_type, "feedback");
                assert_eq!(content, "Fix the bug");
            }
            other => panic!("Expected UserMessage, got {other:?}"),
        }
    }

    #[test]
    fn parses_user_text_in_array() {
        let mut parser = ClaudeAgentParser::new();
        let line = serde_json::json!({
            "type": "user",
            "message": {
                "content": [
                    {"type": "text", "text": "<!orkestra-resume:continue>\n\nKeep going"}
                ]
            }
        })
        .to_string();
        let update = parser.parse_line(&line);
        assert_eq!(update.log_entries.len(), 1);
        match &update.log_entries[0] {
            LogEntry::UserMessage {
                resume_type,
                content,
            } => {
                assert_eq!(resume_type, "continue");
                assert_eq!(content, "Keep going");
            }
            other => panic!("Expected UserMessage, got {other:?}"),
        }
    }

    #[test]
    fn tracks_task_agent_mapping() {
        let mut parser = ClaudeAgentParser::new();

        // Register Task tool
        let task_line = assistant_tool_use(
            "Task",
            "tu_task_1",
            &serde_json::json!({"description": "do work"}),
        );
        parser.parse_line(&task_line);

        // toolUseResult event with agentId
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
        let mut parser = ClaudeAgentParser::new();
        assert!(parser.finalize().is_empty());
    }

    #[test]
    fn mixed_content_in_single_message() {
        let mut parser = ClaudeAgentParser::new();
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

    // ========================================================================
    // Output extraction tests
    // ========================================================================

    #[test]
    fn extract_structured_output() {
        let parser = ClaudeAgentParser::new();
        let output = r#"{"type":"system","subtype":"init","session_id":"abc"}
{"structured_output":{"type":"summary","content":"Work done"}}"#;
        let result = parser.extract_output(output);
        assert!(result.is_ok(), "Failed: {result:?}");
        let json: serde_json::Value = serde_json::from_str(&result.unwrap()).unwrap();
        assert_eq!(json["type"], "summary");
    }

    #[test]
    fn extract_stream_json_unwraps() {
        let parser = ClaudeAgentParser::new();
        let output = r#"{"type":"result","structured_output":{"content":"{\"type\":\"questions\",\"questions\":[{\"question\":\"What?\"}]}","type":"plan"}}"#;
        let result = parser.extract_output(output);
        assert!(result.is_ok(), "Failed: {result:?}");
        let json: serde_json::Value = serde_json::from_str(&result.unwrap()).unwrap();
        assert_eq!(json["type"], "questions");
    }

    #[test]
    fn extract_api_error() {
        let parser = ClaudeAgentParser::new();
        let output = r#"{"type":"assistant","error":"invalid_request","message":{"content":[{"type":"text","text":"Rate limit exceeded"}]}}"#;
        let result = parser.extract_output(output);
        assert!(result.is_err());
        assert!(result.unwrap_err().contains("Rate limit exceeded"));
    }

    #[test]
    fn extract_empty_output() {
        let parser = ClaudeAgentParser::new();
        let result = parser.extract_output("");
        assert!(result.is_err());
        assert!(result.unwrap_err().contains("no output"));
    }
}
