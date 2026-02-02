//! Stream parsers for real-time agent stdout log capture.
//!
//! Each provider emits stdout in a different format. The `StreamParser` trait
//! provides a uniform interface: feed it lines, get back `LogEntry` values.
//!
//! - `ClaudeStreamParser` — parses Claude Code JSONL events
//! - `OpenCodeStreamParser` — parses `OpenCode` `--format json` events

use std::collections::{HashMap, HashSet};

use crate::workflow::domain::LogEntry;

use super::session_logs::{extract_tool_result_content, parse_resume_marker, parse_tool_input};

// ============================================================================
// StreamParser trait
// ============================================================================

/// Parses provider-specific stdout lines into structured log entries.
pub trait StreamParser: Send {
    /// Parse a single line from the agent's stdout.
    ///
    /// Returns zero or more `LogEntry` values extracted from this line.
    /// Non-parseable or irrelevant lines return an empty vec.
    fn parse_line(&mut self, line: &str) -> Vec<LogEntry>;

    /// Signal that the stream has ended. Returns any remaining buffered entries.
    fn finalize(&mut self) -> Vec<LogEntry>;
}

// ============================================================================
// Claude Code stream parser
// ============================================================================

/// Parses Claude Code JSONL stdout events into `LogEntry` values.
///
/// Maintains the same state as the file-based `SessionLogParser`:
/// - `tool_use_map`: maps `tool_use_id` → `tool_name` for result correlation
/// - `task_tool_ids`: tracks Task tool invocations for subagent detection
/// - `task_agent_map`: maps Task `tool_use_id` → agentId
///
/// Subagent log entries are captured inline from the parent's stdout stream
/// (Claude Code emits Task tool events containing the subagent's output).
/// There is no separate subagent file loading.
pub struct ClaudeStreamParser {
    tool_use_map: HashMap<String, String>,
    task_tool_ids: HashSet<String>,
    task_agent_map: HashMap<String, String>,
}

impl Default for ClaudeStreamParser {
    fn default() -> Self {
        Self::new()
    }
}

impl ClaudeStreamParser {
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
}

impl StreamParser for ClaudeStreamParser {
    fn parse_line(&mut self, line: &str) -> Vec<LogEntry> {
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

    fn finalize(&mut self) -> Vec<LogEntry> {
        Vec::new()
    }
}

// ============================================================================
// OpenCode stream parser
// ============================================================================

/// Parses `OpenCode` `--format json` stdout events into `LogEntry` values.
///
/// `OpenCode`'s JSON format emits events with a `type` field. Known event types
/// are mapped to appropriate `LogEntry` variants. Unrecognized events are
/// captured as `LogEntry::Text` with the raw content.
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

    /// Try to extract a tool use entry from an `OpenCode` event.
    fn parse_tool_use_event(v: &serde_json::Value) -> Option<LogEntry> {
        let tool_name = v
            .get("name")
            .or_else(|| v.get("tool"))
            .and_then(|n| n.as_str())?
            .to_string();
        let tool_id = v
            .get("id")
            .and_then(|i| i.as_str())
            .unwrap_or("")
            .to_string();
        let input = v.get("input").cloned().unwrap_or(serde_json::json!({}));
        let tool_input = parse_tool_input(&tool_name, &input);

        Some(LogEntry::ToolUse {
            tool: tool_name,
            id: tool_id,
            input: tool_input,
        })
    }

    /// Try to extract a tool result entry from an `OpenCode` event.
    fn parse_tool_result_event(v: &serde_json::Value) -> Option<LogEntry> {
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
            // Assistant text message
            "text" | "assistant" => {
                let content = v
                    .get("content")
                    .or_else(|| v.get("text"))
                    .and_then(|c| c.as_str())
                    .unwrap_or("");
                let trimmed_content = content.trim();
                if trimmed_content.is_empty() {
                    // Check for nested message content (similar to Claude format)
                    if let Some(msg_content) = v
                        .get("message")
                        .and_then(|m| m.get("content"))
                        .and_then(|c| c.as_str())
                    {
                        let t = msg_content.trim();
                        if !t.is_empty() {
                            return vec![LogEntry::Text {
                                content: t.to_string(),
                            }];
                        }
                    }
                    Vec::new()
                } else {
                    vec![LogEntry::Text {
                        content: trimmed_content.to_string(),
                    }]
                }
            }

            // Tool use events
            "tool_use" => {
                if let Some(entry) = Self::parse_tool_use_event(&v) {
                    vec![entry]
                } else {
                    Vec::new()
                }
            }

            // Tool result events
            "tool_result" => {
                if let Some(entry) = Self::parse_tool_result_event(&v) {
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

            // Unknown event type — capture as text with raw JSON
            _ => {
                // If there's a recognizable content field, use it
                if let Some(content) = v.get("content").and_then(|c| c.as_str()) {
                    let t = content.trim();
                    if !t.is_empty() {
                        return vec![LogEntry::Text {
                            content: t.to_string(),
                        }];
                    }
                }
                // Otherwise capture the raw JSON as text
                vec![LogEntry::Text {
                    content: trimmed.to_string(),
                }]
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
    // ClaudeStreamParser tests
    // ========================================================================

    fn claude_assistant_text(text: &str) -> String {
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

    fn claude_assistant_tool_use(
        tool_name: &str,
        tool_id: &str,
        input: &serde_json::Value,
    ) -> String {
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

    fn claude_user_tool_result(tool_use_id: &str, content: &str) -> String {
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

    fn claude_user_text(text: &str) -> String {
        serde_json::json!({
            "type": "user",
            "message": {
                "content": text
            }
        })
        .to_string()
    }

    fn claude_subagent_tool_use(
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

    #[test]
    fn claude_parses_assistant_text() {
        let mut parser = ClaudeStreamParser::new();
        let entries = parser.parse_line(&claude_assistant_text("Hello world"));
        assert_eq!(entries.len(), 1);
        assert_eq!(
            entries[0],
            LogEntry::Text {
                content: "Hello world".to_string()
            }
        );
    }

    #[test]
    fn claude_skips_empty_text() {
        let mut parser = ClaudeStreamParser::new();
        let entries = parser.parse_line(&claude_assistant_text("   "));
        assert!(entries.is_empty());
    }

    #[test]
    fn claude_skips_empty_lines() {
        let mut parser = ClaudeStreamParser::new();
        assert!(parser.parse_line("").is_empty());
        assert!(parser.parse_line("   ").is_empty());
    }

    #[test]
    fn claude_skips_invalid_json() {
        let mut parser = ClaudeStreamParser::new();
        assert!(parser.parse_line("not json at all").is_empty());
    }

    #[test]
    fn claude_parses_tool_use() {
        let mut parser = ClaudeStreamParser::new();
        let line = claude_assistant_tool_use(
            "Read",
            "tu_123",
            &serde_json::json!({"file_path": "/foo/bar.rs"}),
        );
        let entries = parser.parse_line(&line);
        assert_eq!(entries.len(), 1);
        match &entries[0] {
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
    fn claude_parses_tool_result_for_task() {
        let mut parser = ClaudeStreamParser::new();

        // First register a Task tool use so results are captured
        let tool_line = claude_assistant_tool_use(
            "Task",
            "tu_task_1",
            &serde_json::json!({"description": "do something"}),
        );
        parser.parse_line(&tool_line);

        let result_line = claude_user_tool_result("tu_task_1", "Task completed successfully");
        let entries = parser.parse_line(&result_line);
        assert_eq!(entries.len(), 1);
        match &entries[0] {
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
    fn claude_skips_non_task_tool_results() {
        let mut parser = ClaudeStreamParser::new();

        // Register a Read tool use
        let tool_line = claude_assistant_tool_use(
            "Read",
            "tu_read_1",
            &serde_json::json!({"file_path": "/foo.rs"}),
        );
        parser.parse_line(&tool_line);

        // Result for Read should be skipped (only Task results are captured)
        let result_line = claude_user_tool_result("tu_read_1", "file contents here");
        let entries = parser.parse_line(&result_line);
        assert!(entries.is_empty());
    }

    #[test]
    fn claude_detects_subagent_events() {
        let mut parser = ClaudeStreamParser::new();

        // Register a Task tool use
        let task_line = claude_assistant_tool_use(
            "Task",
            "tu_task_1",
            &serde_json::json!({"description": "do work"}),
        );
        parser.parse_line(&task_line);

        // Subagent tool use with parent_tool_use_id pointing to the Task
        let subagent_line = claude_subagent_tool_use(
            "Edit",
            "tu_sub_1",
            &serde_json::json!({"file_path": "/bar.rs"}),
            "tu_task_1",
        );
        let entries = parser.parse_line(&subagent_line);
        assert_eq!(entries.len(), 1);
        match &entries[0] {
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
    fn claude_subagent_text_is_skipped() {
        let mut parser = ClaudeStreamParser::new();

        // Register Task tool
        let task_line = claude_assistant_tool_use(
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
        let entries = parser.parse_line(&subagent_text);
        assert!(entries.is_empty());
    }

    #[test]
    fn claude_parses_resume_marker() {
        let mut parser = ClaudeStreamParser::new();
        let line = claude_user_text("<!orkestra-resume:feedback>\n\nFix the bug");
        let entries = parser.parse_line(&line);
        assert_eq!(entries.len(), 1);
        match &entries[0] {
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
    fn claude_parses_user_text_in_array() {
        let mut parser = ClaudeStreamParser::new();
        let line = serde_json::json!({
            "type": "user",
            "message": {
                "content": [
                    {"type": "text", "text": "<!orkestra-resume:continue>\n\nKeep going"}
                ]
            }
        })
        .to_string();
        let entries = parser.parse_line(&line);
        assert_eq!(entries.len(), 1);
        match &entries[0] {
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
    fn claude_tracks_task_agent_mapping() {
        let mut parser = ClaudeStreamParser::new();

        // Register Task tool
        let task_line = claude_assistant_tool_use(
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
    fn claude_finalize_returns_empty() {
        let mut parser = ClaudeStreamParser::new();
        assert!(parser.finalize().is_empty());
    }

    #[test]
    fn claude_mixed_content_in_single_message() {
        let mut parser = ClaudeStreamParser::new();
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

        let entries = parser.parse_line(&line);
        assert_eq!(entries.len(), 2);
        assert!(
            matches!(&entries[0], LogEntry::Text { content } if content == "Let me read the file.")
        );
        assert!(matches!(&entries[1], LogEntry::ToolUse { tool, .. } if tool == "Read"));
    }

    // ========================================================================
    // OpenCodeStreamParser tests
    // ========================================================================

    #[test]
    fn opencode_parses_text_event() {
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
    fn opencode_parses_assistant_event() {
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
    fn opencode_parses_tool_use_event() {
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
    fn opencode_parses_tool_result_event() {
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
    fn opencode_parses_error_event() {
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
    fn opencode_captures_non_json_as_text() {
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
    fn opencode_captures_unknown_event_with_content() {
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
    fn opencode_captures_unknown_event_as_raw_json() {
        let mut parser = OpenCodeStreamParser::new();
        let line = serde_json::json!({
            "type": "metric",
            "tokens": 1500
        })
        .to_string();
        let entries = parser.parse_line(&line);
        assert_eq!(entries.len(), 1);
        // Should contain the raw JSON since no "content" field
        match &entries[0] {
            LogEntry::Text { content } => {
                assert!(content.contains("metric"));
                assert!(content.contains("1500"));
            }
            other => panic!("Expected Text, got {other:?}"),
        }
    }

    #[test]
    fn opencode_skips_empty_lines() {
        let mut parser = OpenCodeStreamParser::new();
        assert!(parser.parse_line("").is_empty());
        assert!(parser.parse_line("   ").is_empty());
    }

    #[test]
    fn opencode_skips_empty_text_content() {
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
    fn opencode_skips_empty_tool_result_content() {
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
    fn opencode_uses_tool_field_as_fallback() {
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

    #[test]
    fn opencode_finalize_returns_empty() {
        let mut parser = OpenCodeStreamParser::new();
        assert!(parser.finalize().is_empty());
    }

    #[test]
    fn opencode_error_with_fallback_fields() {
        let mut parser = OpenCodeStreamParser::new();

        // error field instead of message
        let line = serde_json::json!({
            "type": "error",
            "error": "Something broke"
        })
        .to_string();
        let entries = parser.parse_line(&line);
        assert_eq!(entries.len(), 1);
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
        assert_eq!(entries.len(), 1);
        assert_eq!(
            entries[0],
            LogEntry::Error {
                message: "Another failure".to_string()
            }
        );
    }
}
