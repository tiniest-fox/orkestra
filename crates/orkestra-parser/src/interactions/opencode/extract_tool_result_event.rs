//! Extract a tool result from a standalone `tool_result` event (legacy format).

use orkestra_types::domain::LogEntry;

use crate::interactions::stream::extract_tool_result_content;

/// Extract a tool result from a standalone `tool_result` event (legacy format).
pub fn execute(v: &serde_json::Value) -> Option<LogEntry> {
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
    let content = extract_tool_result_content::execute(v);

    if content.trim().is_empty() {
        return None;
    }

    Some(LogEntry::ToolResult {
        tool: tool_name,
        tool_use_id,
        content,
    })
}
