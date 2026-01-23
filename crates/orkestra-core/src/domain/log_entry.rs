use serde::{Deserialize, Serialize};

/// A single todo item from `TodoWrite` tool
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TodoItem {
    pub content: String,
    pub status: String, // "pending", "in_progress", "completed"
    #[serde(rename = "activeForm")]
    pub active_form: String,
}

/// Ork CLI action types for specialized display
#[derive(Debug, Clone, Serialize, Deserialize)]
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
#[derive(Debug, Clone, Serialize, Deserialize)]
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

/// Structured log entry for task execution (loaded from Claude's session files).
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum LogEntry {
    /// Text output from the assistant
    Text {
        content: String,
    },
    /// User/system message (e.g., session resumption with feedback)
    UserMessage {
        content: String,
    },
    ToolUse {
        tool: String,
        id: String,
        input: ToolInput,
    },
    /// Tool result, especially useful for Task subagent output
    ToolResult {
        tool: String,
        tool_use_id: String,
        content: String,
    },
    /// Subagent activity (tool use within a Task subagent)
    SubagentToolUse {
        tool: String,
        id: String,
        input: ToolInput,
        parent_task_id: String,
    },
    /// Subagent tool result
    SubagentToolResult {
        tool: String,
        tool_use_id: String,
        content: String,
        parent_task_id: String,
    },
    ProcessExit {
        code: Option<i32>,
    },
    Error {
        message: String,
    },
}
