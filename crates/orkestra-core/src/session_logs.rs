//! Session log parsing for Claude Code sessions
//!
//! This module handles reading and parsing Claude Code session files (.jsonl)
//! to extract log entries for display in the UI.

use std::collections::{HashMap, HashSet};
use std::fs;
use std::io::BufRead;
use std::path::PathBuf;

use crate::domain::TodoItem;
use crate::project;
use crate::tasks::{LogEntry, ToolInput};

/// Get path to Claude's session file
pub fn get_claude_session_path(session_id: &str) -> Option<PathBuf> {
    let home = dirs::home_dir()?;
    let cwd = project::find_project_root().ok()?;

    // Encode cwd: /Users/foo/bar -> -Users-foo-bar
    let encoded_cwd = cwd.to_string_lossy().replace('/', "-");

    Some(
        home.join(".claude/projects")
            .join(&encoded_cwd)
            .join(format!("{session_id}.jsonl")),
    )
}

/// State for tracking session log parsing
struct SessionLogParser {
    entries: Vec<LogEntry>,
    tool_use_map: HashMap<String, String>,
    task_tool_ids: HashSet<String>,
}

impl SessionLogParser {
    fn new() -> Self {
        Self {
            entries: Vec::new(),
            tool_use_map: HashMap::new(),
            task_tool_ids: HashSet::new(),
        }
    }

    fn is_subagent_event(&self, parent_id: Option<&String>) -> bool {
        parent_id.is_some_and(|id| self.task_tool_ids.contains(id))
    }

    fn process_text(&mut self, item: &serde_json::Value, is_subagent: bool) {
        if is_subagent {
            return; // Skip text from subagent events
        }
        if let Some(text) = item.get("text").and_then(|t| t.as_str()) {
            let trimmed = text.trim();
            if !trimmed.is_empty() {
                self.entries.push(LogEntry::Text {
                    content: trimmed.to_string(),
                });
            }
        }
    }

    fn process_tool_use(
        &mut self,
        item: &serde_json::Value,
        is_subagent: bool,
        parent_id: Option<&String>,
    ) {
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
            self.entries.push(LogEntry::SubagentToolUse {
                tool: tool_name,
                id: tool_id,
                input: tool_input,
                parent_task_id: parent_id.cloned().unwrap_or_default(),
            });
        } else {
            self.entries.push(LogEntry::ToolUse {
                tool: tool_name,
                id: tool_id,
                input: tool_input,
            });
        }
    }

    fn process_tool_result(
        &mut self,
        item: &serde_json::Value,
        is_subagent: bool,
        parent_id: Option<&String>,
    ) {
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
            return;
        }

        if is_subagent {
            self.entries.push(LogEntry::SubagentToolResult {
                tool: tool_name,
                tool_use_id,
                content: content_str,
                parent_task_id: parent_id.cloned().unwrap_or_default(),
            });
        } else if tool_name == "Task" {
            self.entries.push(LogEntry::ToolResult {
                tool: tool_name,
                tool_use_id,
                content: content_str,
            });
        }
    }
}

/// Recover logs from Claude's session file
pub fn recover_session_logs(session_id: &str) -> std::io::Result<Vec<LogEntry>> {
    let path = get_claude_session_path(session_id).ok_or_else(|| {
        std::io::Error::new(
            std::io::ErrorKind::NotFound,
            "Could not determine session path",
        )
    })?;

    if !path.exists() {
        return Err(std::io::Error::new(
            std::io::ErrorKind::NotFound,
            format!("Session file not found: {}", path.display()),
        ));
    }

    let file = fs::File::open(&path)?;
    let reader = std::io::BufReader::new(file);
    let mut parser = SessionLogParser::new();

    for line in reader.lines() {
        let line = line?;
        if line.trim().is_empty() {
            continue;
        }

        let Ok(v) = serde_json::from_str::<serde_json::Value>(&line) else {
            continue;
        };
        let msg_type = v.get("type").and_then(|t| t.as_str()).unwrap_or("");
        let parent_id = v
            .get("parent_tool_use_id")
            .and_then(|p| p.as_str())
            .map(String::from);
        let is_subagent = parser.is_subagent_event(parent_id.as_ref());

        if msg_type == "assistant" {
            if let Some(content) = v
                .get("message")
                .and_then(|m| m.get("content"))
                .and_then(|c| c.as_array())
            {
                for item in content {
                    match item.get("type").and_then(|t| t.as_str()) {
                        Some("text") => parser.process_text(item, is_subagent),
                        Some("tool_use") => {
                            parser.process_tool_use(item, is_subagent, parent_id.as_ref());
                        }
                        _ => {}
                    }
                }
            }
        } else if msg_type == "user" {
            if let Some(content) = v
                .get("message")
                .and_then(|m| m.get("content"))
                .and_then(|c| c.as_array())
            {
                for item in content {
                    if item.get("type").and_then(|t| t.as_str()) == Some("tool_result") {
                        parser.process_tool_result(item, is_subagent, parent_id.as_ref());
                    }
                }
            }
        }
    }

    Ok(parser.entries)
}

/// Extract text content from a `tool_result` item
fn extract_tool_result_content(item: &serde_json::Value) -> String {
    match item.get("content") {
        Some(serde_json::Value::String(s)) => s.clone(),
        Some(serde_json::Value::Array(arr)) => arr
            .iter()
            .filter_map(|item| {
                if item.get("type").and_then(|t| t.as_str()) == Some("text") {
                    item.get("text").and_then(|t| t.as_str()).map(String::from)
                } else {
                    None
                }
            })
            .collect::<Vec<_>>()
            .join("\n"),
        _ => String::new(),
    }
}

/// Parses a tool input JSON into a structured `ToolInput`
fn parse_tool_input(tool_name: &str, input: &serde_json::Value) -> ToolInput {
    match tool_name {
        "Bash" => {
            let command = input
                .get("command")
                .and_then(|c| c.as_str())
                .unwrap_or("")
                .to_string();
            ToolInput::Bash { command }
        }
        "Read" => {
            let file_path = input
                .get("file_path")
                .and_then(|p| p.as_str())
                .unwrap_or("")
                .to_string();
            ToolInput::Read { file_path }
        }
        "Write" => {
            let file_path = input
                .get("file_path")
                .and_then(|p| p.as_str())
                .unwrap_or("")
                .to_string();
            ToolInput::Write { file_path }
        }
        "Edit" => {
            let file_path = input
                .get("file_path")
                .and_then(|p| p.as_str())
                .unwrap_or("")
                .to_string();
            ToolInput::Edit { file_path }
        }
        "Glob" => {
            let pattern = input
                .get("pattern")
                .and_then(|p| p.as_str())
                .unwrap_or("")
                .to_string();
            ToolInput::Glob { pattern }
        }
        "Grep" => {
            let pattern = input
                .get("pattern")
                .and_then(|p| p.as_str())
                .unwrap_or("")
                .to_string();
            ToolInput::Grep { pattern }
        }
        "Task" => {
            let description = input
                .get("description")
                .and_then(|d| d.as_str())
                .unwrap_or("")
                .to_string();
            ToolInput::Task { description }
        }
        "TodoWrite" => {
            let todos = input
                .get("todos")
                .and_then(|t| t.as_array())
                .map(|arr| {
                    arr.iter()
                        .filter_map(|item| {
                            let content = item.get("content")?.as_str()?.to_string();
                            let status = item.get("status")?.as_str()?.to_string();
                            let active_form = item
                                .get("activeForm")
                                .and_then(|a| a.as_str())
                                .unwrap_or("")
                                .to_string();
                            Some(TodoItem {
                                content,
                                status,
                                active_form,
                            })
                        })
                        .collect()
                })
                .unwrap_or_default();
            ToolInput::TodoWrite { todos }
        }
        _ => {
            // For other tools, create a compact summary
            let summary = serde_json::to_string(input).map_or_else(
                |_| "{}".to_string(),
                |s| {
                    if s.len() > 100 {
                        format!("{}...", &s[..100])
                    } else {
                        s
                    }
                },
            );
            ToolInput::Other { summary }
        }
    }
}
