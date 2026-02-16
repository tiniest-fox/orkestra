//! Parse assistant message content array into log entries.

use std::collections::{HashMap, HashSet};

use orkestra_types::domain::LogEntry;

use crate::interactions::stream::parse_tool_input;

/// Parse an assistant message content array into log entries.
///
/// Iterates content items: text items become `LogEntry::Text` (skipped for subagents),
/// `tool_use` items are parsed via `parse_tool_input` and become `LogEntry::ToolUse`
/// or `LogEntry::SubagentToolUse`.
///
/// Updates `tool_use_map` (id → name) and `task_tool_ids` (ids of Task tool calls)
/// as side effects.
#[allow(clippy::implicit_hasher)]
pub fn execute(
    content: &[serde_json::Value],
    is_subagent: bool,
    parent_id: Option<&str>,
    tool_use_map: &mut HashMap<String, String>,
    task_tool_ids: &mut HashSet<String>,
) -> Vec<LogEntry> {
    let mut entries = Vec::new();

    for item in content {
        match item.get("type").and_then(|t| t.as_str()) {
            Some("text") => {
                if let Some(entry) = parse_text(item, is_subagent) {
                    entries.push(entry);
                }
            }
            Some("tool_use") => {
                entries.push(parse_tool_use(
                    item,
                    is_subagent,
                    parent_id,
                    tool_use_map,
                    task_tool_ids,
                ));
            }
            _ => {}
        }
    }

    entries
}

// -- Helpers --

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
    item: &serde_json::Value,
    is_subagent: bool,
    parent_id: Option<&str>,
    tool_use_map: &mut HashMap<String, String>,
    task_tool_ids: &mut HashSet<String>,
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

    tool_use_map.insert(tool_id.clone(), tool_name.clone());
    if tool_name == "Task" {
        task_tool_ids.insert(tool_id.clone());
    }

    let tool_input = parse_tool_input::execute(&tool_name, &input);

    if is_subagent {
        LogEntry::SubagentToolUse {
            tool: tool_name,
            id: tool_id,
            input: tool_input,
            parent_task_id: parent_id.unwrap_or_default().to_string(),
        }
    } else {
        LogEntry::ToolUse {
            tool: tool_name,
            id: tool_id,
            input: tool_input,
        }
    }
}
