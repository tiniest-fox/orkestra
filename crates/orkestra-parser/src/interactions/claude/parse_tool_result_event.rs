//! Parse `tool_result` items from a user message content array.

use std::collections::HashMap;

use orkestra_types::domain::LogEntry;

use crate::interactions::stream::extract_tool_result_content;

/// Parse `tool_result` items from a user message content array into log entries.
///
/// Only captures results for the `Agent` tool (via `tool_use_map` lookup).
/// Subagent results are tagged with their parent task ID.
#[allow(clippy::implicit_hasher)]
pub fn execute(
    content: &[serde_json::Value],
    is_subagent: bool,
    parent_id: Option<&str>,
    tool_use_map: &HashMap<String, String>,
) -> Vec<LogEntry> {
    let mut entries = Vec::new();

    for item in content {
        if item.get("type").and_then(|t| t.as_str()) != Some("tool_result") {
            continue;
        }

        if let Some(entry) = parse_single_result(item, is_subagent, parent_id, tool_use_map) {
            entries.push(entry);
        }
    }

    entries
}

// -- Helpers --

fn parse_single_result(
    item: &serde_json::Value,
    is_subagent: bool,
    parent_id: Option<&str>,
    tool_use_map: &HashMap<String, String>,
) -> Option<LogEntry> {
    let tool_use_id = item
        .get("tool_use_id")
        .and_then(|i| i.as_str())
        .unwrap_or("")
        .to_string();
    let tool_name = tool_use_map
        .get(&tool_use_id)
        .cloned()
        .unwrap_or_else(|| "unknown".to_string());
    let content_str = extract_tool_result_content::execute(item);

    if content_str.trim().is_empty() {
        return None;
    }

    if is_subagent {
        Some(LogEntry::SubagentToolResult {
            tool: tool_name,
            tool_use_id,
            content: content_str,
            parent_task_id: parent_id.unwrap_or_default().to_string(),
        })
    } else if tool_name == "Agent" {
        Some(LogEntry::ToolResult {
            tool: tool_name,
            tool_use_id,
            content: content_str,
        })
    } else {
        None
    }
}
