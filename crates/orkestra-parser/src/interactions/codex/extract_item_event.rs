//! Parse Codex `item.started` and `item.completed` events into `LogEntry` variants.

use orkestra_types::domain::{LogEntry, ToolInput};

/// Parse a Codex item event into log entries.
///
/// Dispatches on `v["type"]` (item.started / item.completed) and `v["item"]["type"]`
/// (`command_execution`). Returns an empty vec for unrecognized item types.
pub fn execute(v: &serde_json::Value) -> Vec<LogEntry> {
    let event_type = v["type"].as_str().unwrap_or("");
    let item_type = v["item"]["type"].as_str().unwrap_or("");

    match (event_type, item_type) {
        ("item.started", "command_execution") => {
            let id = v["item"]["id"].as_str().unwrap_or("").to_string();
            let command = v["item"]["command"].as_str().unwrap_or("").to_string();
            vec![LogEntry::ToolUse {
                tool: "shell".to_string(),
                id,
                input: ToolInput::Bash { command },
            }]
        }
        ("item.completed", "command_execution") => {
            let id = v["item"]["id"].as_str().unwrap_or("").to_string();
            let content = v["item"]["aggregated_output"]
                .as_str()
                .unwrap_or("")
                .trim()
                .to_string();
            vec![LogEntry::ToolResult {
                tool: "shell".to_string(),
                tool_use_id: id,
                content,
            }]
        }
        _ => vec![],
    }
}

// ============================================================================
// Tests
// ============================================================================

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn item_started_command_execution_emits_tool_use() {
        let v = serde_json::json!({
            "type": "item.started",
            "item": {
                "id": "item_0",
                "type": "command_execution",
                "command": "/bin/zsh -lc 'echo hello'",
                "aggregated_output": "",
                "exit_code": null,
                "status": "in_progress"
            }
        });
        let entries = execute(&v);
        assert_eq!(entries.len(), 1);
        match &entries[0] {
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
        let v = serde_json::json!({
            "type": "item.completed",
            "item": {
                "id": "item_0",
                "type": "command_execution",
                "command": "/bin/zsh -lc 'echo hello'",
                "aggregated_output": "hello\n",
                "exit_code": 0,
                "status": "completed"
            }
        });
        let entries = execute(&v);
        assert_eq!(entries.len(), 1);
        match &entries[0] {
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

    #[test]
    fn item_completed_trims_aggregated_output() {
        let v = serde_json::json!({
            "type": "item.completed",
            "item": {
                "id": "item_1",
                "type": "command_execution",
                "aggregated_output": "  output with spaces  \n",
                "exit_code": 0,
                "status": "completed"
            }
        });
        let entries = execute(&v);
        assert_eq!(entries.len(), 1);
        match &entries[0] {
            LogEntry::ToolResult { content, .. } => {
                assert_eq!(content, "output with spaces");
            }
            other => panic!("Expected ToolResult, got {other:?}"),
        }
    }

    #[test]
    fn item_completed_agent_message_returns_empty() {
        let v = serde_json::json!({
            "type": "item.completed",
            "item": {
                "id": "item_1",
                "type": "agent_message",
                "text": "done"
            }
        });
        let entries = execute(&v);
        assert!(entries.is_empty());
    }

    #[test]
    fn unknown_item_type_returns_empty() {
        let v = serde_json::json!({
            "type": "item.started",
            "item": {
                "id": "item_2",
                "type": "reasoning"
            }
        });
        let entries = execute(&v);
        assert!(entries.is_empty());
    }

    #[test]
    fn empty_event_returns_empty() {
        let v = serde_json::json!({});
        let entries = execute(&v);
        assert!(entries.is_empty());
    }
}
