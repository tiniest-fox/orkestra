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
    Bash {
        command: String,
    },
    Read {
        file_path: String,
    },
    Write {
        file_path: String,
    },
    Edit {
        file_path: String,
    },
    Glob {
        pattern: String,
    },
    Grep {
        pattern: String,
    },
    Agent {
        description: String,
    },
    TodoWrite {
        todos: Vec<TodoItem>,
    },
    Ork {
        ork_action: OrkAction,
    },
    /// Structured output generation (final agent response).
    StructuredOutput {
        /// The output type (e.g., "plan", "summary", "questions", "subtasks")
        output_type: String,
    },
    /// Web search tool - searching the internet.
    WebSearch {
        query: String,
    },
    /// Web fetch tool - fetching a specific URL.
    WebFetch {
        url: String,
    },
    Other {
        summary: String,
    },
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
    /// Tool result, especially useful for Agent subagent output.
    ToolResult {
        tool: String,
        tool_use_id: String,
        content: String,
    },
    /// Subagent activity (tool use within an Agent subagent).
    SubagentToolUse {
        tool: String,
        id: String,
        input: ToolInput,
        /// The `tool_use_id` of the parent Agent tool invocation (not an Orkestra task ID).
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

/// A log entry with associated database metadata.
///
/// Used when the caller needs the iteration association alongside the entry content.
/// The standard `get_log_entries` returns just `Vec<LogEntry>` for backward compatibility;
/// `get_annotated_log_entries` returns these enriched entries.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct AnnotatedLogEntry {
    /// The log entry content.
    pub entry: LogEntry,
    /// The iteration that was active when this log entry was written.
    /// `None` for chat-mode messages (written before a `ChatCompletion` iteration exists).
    pub iteration_id: Option<String>,
}

impl LogEntry {
    /// Return the serde type discriminant for this log entry variant.
    ///
    /// Matches the `#[serde(tag = "type", rename_all = "snake_case")]` tag values.
    pub fn type_name(&self) -> &'static str {
        match self {
            LogEntry::Text { .. } => "text",
            LogEntry::UserMessage { .. } => "user_message",
            LogEntry::ToolUse { .. } => "tool_use",
            LogEntry::ToolResult { .. } => "tool_result",
            LogEntry::SubagentToolUse { .. } => "subagent_tool_use",
            LogEntry::SubagentToolResult { .. } => "subagent_tool_result",
            LogEntry::ProcessExit { .. } => "process_exit",
            LogEntry::Error { .. } => "error",
        }
    }

    /// Human-readable one-line summary suitable for push notifications.
    ///
    /// Returns `None` for non-summarizable variants (results, exit codes, errors).
    /// Mirrors the frontend's `entrySummary()` in `LatestLogSummary.tsx`.
    pub fn push_summary(&self) -> Option<String> {
        match self {
            LogEntry::Text { content } => {
                let trimmed = content.trim();
                if trimmed.is_empty() {
                    None
                } else {
                    Some(trimmed[..trimmed.len().min(100)].to_string())
                }
            }
            LogEntry::ToolUse { tool, input, .. } => Some(
                format!("{tool} {}", summarize_tool_input(input))
                    .trim_end()
                    .to_string(),
            ),
            LogEntry::SubagentToolUse { tool, input, .. } => Some(
                format!("↳ {tool} {}", summarize_tool_input(input))
                    .trim_end()
                    .to_string(),
            ),
            _ => None,
        }
    }
}

/// Produce a short description of a tool input.
///
/// Mirrors the frontend's `toolSummary()` in `src/utils/toolSummary.ts`.
fn summarize_tool_input(input: &ToolInput) -> String {
    match input {
        ToolInput::Bash { command } => command.chars().take(120).collect(),
        ToolInput::Read { file_path }
        | ToolInput::Write { file_path }
        | ToolInput::Edit { file_path } => file_path.clone(),
        ToolInput::Glob { pattern } | ToolInput::Grep { pattern } => pattern.clone(),
        ToolInput::Agent { description } => description.clone(),
        ToolInput::WebSearch { query } => query.clone(),
        ToolInput::WebFetch { url } => url.clone(),
        ToolInput::TodoWrite { todos } => {
            let n = todos.len();
            format!("{n} item{}", if n == 1 { "" } else { "s" })
        }
        ToolInput::Ork { ork_action } => summarize_ork_action(ork_action),
        ToolInput::StructuredOutput { output_type } => output_type.clone(),
        ToolInput::Other { summary } => summary.clone(),
    }
}

/// Produce a short description of an Ork CLI action.
fn summarize_ork_action(action: &OrkAction) -> String {
    match action {
        OrkAction::Complete { task_id, .. } => format!("complete {task_id}"),
        OrkAction::Fail { task_id, .. } => format!("fail {task_id}"),
        OrkAction::Block { task_id, .. } => format!("block {task_id}"),
        OrkAction::Approve { task_id } | OrkAction::ApproveReview { task_id } => {
            format!("approve {task_id}")
        }
        OrkAction::CreateSubtask { title, .. } => title.clone(),
        OrkAction::Other { raw } => raw.clone(),
        OrkAction::SetPlan { task_id } => format!("set_plan {task_id}"),
        OrkAction::SetBreakdown { task_id } => format!("set_breakdown {task_id}"),
        OrkAction::ApproveBreakdown { task_id } => format!("approve_breakdown {task_id}"),
        OrkAction::SkipBreakdown { task_id } => format!("skip_breakdown {task_id}"),
        OrkAction::CompleteSubtask { subtask_id } => format!("complete_subtask {subtask_id}"),
        OrkAction::RejectReview { task_id, .. } => format!("reject_review {task_id}"),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_push_summary_text() {
        let entry = LogEntry::Text {
            content: "Hello world".to_string(),
        };
        assert_eq!(entry.push_summary(), Some("Hello world".to_string()));
    }

    #[test]
    fn test_push_summary_empty_text_returns_none() {
        let entry = LogEntry::Text {
            content: "   ".to_string(),
        };
        assert!(entry.push_summary().is_none());
    }

    #[test]
    fn test_push_summary_tool_use() {
        let entry = LogEntry::ToolUse {
            tool: "read".to_string(),
            id: "1".to_string(),
            input: ToolInput::Read {
                file_path: "src/main.rs".to_string(),
            },
        };
        assert_eq!(entry.push_summary(), Some("read src/main.rs".to_string()));
    }

    #[test]
    fn test_push_summary_subagent_tool_use() {
        let entry = LogEntry::SubagentToolUse {
            tool: "bash".to_string(),
            id: "2".to_string(),
            input: ToolInput::Bash {
                command: "cargo test".to_string(),
            },
            parent_task_id: "p1".to_string(),
        };
        assert_eq!(entry.push_summary(), Some("↳ bash cargo test".to_string()));
    }

    #[test]
    fn test_push_summary_process_exit_returns_none() {
        let entry = LogEntry::ProcessExit { code: Some(0) };
        assert!(entry.push_summary().is_none());
    }

    #[test]
    fn test_push_summary_text_truncates_at_100() {
        let long = "a".repeat(150);
        let entry = LogEntry::Text { content: long };
        let summary = entry.push_summary().unwrap();
        assert_eq!(summary.len(), 100);
    }

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

    #[test]
    fn test_type_name_matches_serde_tag() {
        let entry = LogEntry::Text {
            content: "hello".to_string(),
        };
        assert_eq!(entry.type_name(), "text");
        let entry = LogEntry::ToolUse {
            tool: "bash".to_string(),
            id: "1".to_string(),
            input: ToolInput::Bash {
                command: "ls".to_string(),
            },
        };
        assert_eq!(entry.type_name(), "tool_use");
        let entry = LogEntry::ProcessExit { code: Some(0) };
        assert_eq!(entry.type_name(), "process_exit");
    }
}
