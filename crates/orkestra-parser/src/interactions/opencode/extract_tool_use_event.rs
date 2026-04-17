//! Extract tool use (and optionally tool result) from an `OpenCode` `tool_use` event.

use orkestra_types::domain::LogEntry;

use crate::interactions::stream::parse_tool_input;

/// Extract tool use (and optionally tool result) from a `tool_use` event.
///
/// Handles both v1.1+ format (with `.part.tool`, `.part.state.input/output`)
/// and legacy format (with `.name`, `.input`). In v1.1+, completed `tool_use`
/// events include the output inline, producing both `ToolUse` and `ToolResult`.
pub fn execute(v: &serde_json::Value) -> Vec<LogEntry> {
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

    let parsed = parse_tool_input::execute(&tool_name, &input);
    let display_tool = parsed.display_name.unwrap_or_else(|| tool_name.clone());

    let mut entries = vec![LogEntry::ToolUse {
        tool: display_tool.clone(),
        id: tool_id.clone(),
        input: parsed.input,
    }];

    // v1.1+: completed tool_use events include output in .part.state.output
    if let Some(output) = state.and_then(|s| s.get("output")).and_then(|o| o.as_str()) {
        let trimmed = output.trim();
        if !trimmed.is_empty() {
            entries.push(LogEntry::ToolResult {
                tool: display_tool,
                tool_use_id: tool_id,
                content: trimmed.to_string(),
            });
        }
    }

    entries
}
