//! Log entry types for Claude Code session logs.
//!
//! These types represent the parsed content of Claude's session files (.jsonl),
//! providing structured access to tool uses, text output, and agent activity.

use serde::{Deserialize, Serialize};

/// A single todo item from `TodoWrite` tool.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct TodoItem {
    pub content: String,
    pub status: String, // "pending", "in_progress", "completed"
    #[serde(rename = "activeForm")]
    pub active_form: String,
}

/// Ork CLI action types for specialized display.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(tag = "action", rename_all = "snake_case")]
pub enum OrkAction {
    SetPlan {
        task_id: String,
    },
    Complete {
        task_id: String,
        summary: Option<String>,
    },
    Fail {
        task_id: String,
        reason: Option<String>,
    },
    Block {
        task_id: String,
        reason: Option<String>,
    },
    Approve {
        task_id: String,
    },
    ApproveReview {
        task_id: String,
    },
    RejectReview {
        task_id: String,
        feedback: Option<String>,
    },
    CreateSubtask {
        parent_id: String,
        title: String,
    },
    SetBreakdown {
        task_id: String,
    },
    ApproveBreakdown {
        task_id: String,
    },
    SkipBreakdown {
        task_id: String,
    },
    CompleteSubtask {
        subtask_id: String,
    },
    Other {
        raw: String,
    },
}

/// Tool input details for structured logging.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(tag = "tool", rename_all = "snake_case")]
pub enum ToolInput {
    Bash { command: String },
    Read { file_path: String },
    Write { file_path: String },
    Edit { file_path: String },
    Glob { pattern: String },
    Grep { pattern: String },
    Task { description: String },
    TodoWrite { todos: Vec<TodoItem> },
    Ork { ork_action: OrkAction },
    Other { summary: String },
}

/// Default resume type for backwards compatibility.
fn default_resume_type() -> String {
    "continue".to_string()
}

/// Structured log entry for task execution (loaded from Claude's session files).
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum LogEntry {
    /// Text output from the assistant.
    Text { content: String },
    /// User/system message (e.g., session resumption with feedback).
    UserMessage {
        /// Type of resume: "continue", "feedback", or "integration".
        /// Defaults to "continue" for backwards compatibility with existing sessions.
        #[serde(default = "default_resume_type")]
        resume_type: String,
        /// Content of the resumption message.
        content: String,
    },
    /// Tool use by the main agent.
    ToolUse {
        tool: String,
        id: String,
        input: ToolInput,
    },
    /// Tool result, especially useful for Task subagent output.
    ToolResult {
        tool: String,
        tool_use_id: String,
        content: String,
    },
    /// Subagent activity (tool use within a Task subagent).
    SubagentToolUse {
        tool: String,
        id: String,
        input: ToolInput,
        parent_task_id: String,
    },
    /// Subagent tool result.
    SubagentToolResult {
        tool: String,
        tool_use_id: String,
        content: String,
        parent_task_id: String,
    },
    /// Process exit notification.
    ProcessExit { code: Option<i32> },
    /// Error message.
    Error { message: String },
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_log_entry_serialization() {
        let entry = LogEntry::Text {
            content: "Hello world".to_string(),
        };
        let json = serde_json::to_string(&entry).unwrap();
        assert!(json.contains("\"type\":\"text\""));
        assert!(json.contains("\"content\":\"Hello world\""));
    }

    #[test]
    fn test_tool_input_serialization() {
        let input = ToolInput::Bash {
            command: "ls -la".to_string(),
        };
        let json = serde_json::to_string(&input).unwrap();
        assert!(json.contains("\"tool\":\"bash\""));
        assert!(json.contains("\"command\":\"ls -la\""));
    }

    #[test]
    fn test_ork_action_serialization() {
        let action = OrkAction::Complete {
            task_id: "task-1".to_string(),
            summary: Some("Done!".to_string()),
        };
        let json = serde_json::to_string(&action).unwrap();
        assert!(json.contains("\"action\":\"complete\""));
        assert!(json.contains("\"task_id\":\"task-1\""));
    }

    #[test]
    fn test_todo_item_serialization() {
        let item = TodoItem {
            content: "Fix bug".to_string(),
            status: "in_progress".to_string(),
            active_form: "Fixing bug".to_string(),
        };
        let json = serde_json::to_string(&item).unwrap();
        assert!(json.contains("\"activeForm\":\"Fixing bug\""));
    }
}
