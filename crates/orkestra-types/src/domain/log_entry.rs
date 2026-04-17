//! Log entry types for Claude Code session logs.
//!
//! These types represent the parsed content of Claude's session files (.jsonl),
//! providing structured access to tool uses, text output, and agent activity.

use serde::{Deserialize, Serialize};

use super::artifact::WorkflowArtifact;

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

/// A named section of dynamic prompt context surfaced to the user.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct PromptSection {
    pub label: String,
    pub content: String,
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
        /// Dynamic prompt sections. Non-empty only for fresh spawns (`resume_type` == `"initial"`).
        #[serde(default)]
        sections: Vec<PromptSection>,
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
    /// Agent produced a named artifact (plan, breakdown, summary, etc.).
    ///
    /// Emitted when an agent output is accepted and stored in `workflow_artifacts`.
    /// The `artifact_id` references the corresponding row for content lookup.
    /// The `artifact` field is populated at query time (never stored) so the
    /// frontend receives the full content without a separate lookup.
    ArtifactProduced {
        /// Artifact slot name (e.g., "plan", "breakdown", "summary").
        name: String,
        /// ID of the artifact record in the `workflow_artifacts` table.
        artifact_id: String,
        /// Full artifact content, populated at query time from the store.
        /// `None` when stored (always omitted from serialization to keep DB compact)
        /// or when the artifact has been deleted.
        #[serde(default, skip_serializing_if = "Option::is_none")]
        artifact: Option<WorkflowArtifact>,
    },
    /// JSON extracted from agent output during structured output detection.
    ///
    /// Emitted when the system detects JSON in agent output and attempts schema
    /// validation. The `valid` flag indicates whether the JSON passed validation.
    ExtractedJson {
        /// The raw JSON string that was extracted.
        raw_json: String,
        /// Whether the JSON passed schema validation.
        valid: bool,
    },
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
            LogEntry::ArtifactProduced { .. } => "artifact_produced",
            LogEntry::ExtractedJson { .. } => "extracted_json",
        }
    }

    /// Return the summary of the last summarizable entry in a batch.
    ///
    /// Iterates in reverse to find the last entry for which `push_summary` is `Some`.
    /// Returns `None` when no entry in the slice produces a summary.
    pub fn last_summary(entries: &[Self]) -> Option<String> {
        entries.iter().rev().find_map(Self::push_summary)
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
                    // Truncate at a char boundary to avoid panics on multi-byte UTF-8.
                    let end = trimmed
                        .char_indices()
                        .nth(100)
                        .map_or(trimmed.len(), |(i, _)| i);
                    Some(trimmed[..end].to_string())
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
            LogEntry::ArtifactProduced { name, .. } => Some(format!("produced {name}")),
            LogEntry::ExtractedJson { valid, .. } => {
                if *valid {
                    Some("extracted json (valid)".to_string())
                } else {
                    Some("extracted json (invalid)".to_string())
                }
            }
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
        assert_eq!(summary.chars().count(), 100);
    }

    #[test]
    fn test_push_summary_multibyte_utf8_does_not_panic() {
        // "é" is 2 bytes; 100 repetitions = 100 chars but 200 bytes.
        // The old byte-slice `trimmed[..100]` would panic at a char boundary.
        let long = "é".repeat(150);
        let entry = LogEntry::Text { content: long };
        let summary = entry.push_summary().unwrap();
        assert_eq!(summary.chars().count(), 100);
        // Confirm the output is valid UTF-8 (would panic earlier if broken)
        assert!(summary.chars().all(|c| c == 'é'));
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
        let entry = LogEntry::ArtifactProduced {
            name: "plan".to_string(),
            artifact_id: "art-1".to_string(),
            artifact: None,
        };
        assert_eq!(entry.type_name(), "artifact_produced");
    }

    #[test]
    fn test_artifact_produced_serialization() {
        let entry = LogEntry::ArtifactProduced {
            name: "plan".to_string(),
            artifact_id: "art-abc123".to_string(),
            artifact: None,
        };
        let json = serde_json::to_string(&entry).unwrap();
        assert!(json.contains("\"type\":\"artifact_produced\""));
        assert!(json.contains("\"name\":\"plan\""));
        assert!(json.contains("\"artifact_id\":\"art-abc123\""));
        // artifact: None should be omitted from serialization
        assert!(!json.contains("\"artifact\""));

        let parsed: LogEntry = serde_json::from_str(&json).unwrap();
        assert_eq!(parsed, entry);
    }

    #[test]
    fn test_artifact_produced_backward_compat_deserialize() {
        // Old stored entries without the `artifact` field should deserialize to artifact: None.
        let json = r#"{"type":"artifact_produced","name":"plan","artifact_id":"art-1"}"#;
        let parsed: LogEntry = serde_json::from_str(json).unwrap();
        match parsed {
            LogEntry::ArtifactProduced {
                name,
                artifact_id,
                artifact,
            } => {
                assert_eq!(name, "plan");
                assert_eq!(artifact_id, "art-1");
                assert!(artifact.is_none());
            }
            _ => panic!("Expected ArtifactProduced variant"),
        }
    }

    #[test]
    fn test_artifact_produced_push_summary() {
        let entry = LogEntry::ArtifactProduced {
            name: "breakdown".to_string(),
            artifact_id: "art-1".to_string(),
            artifact: None,
        };
        assert_eq!(entry.push_summary(), Some("produced breakdown".to_string()));
    }

    #[test]
    fn test_extracted_json_serialization_valid() {
        let entry = LogEntry::ExtractedJson {
            raw_json: "{\"key\":\"value\"}".to_string(),
            valid: true,
        };
        let json = serde_json::to_string(&entry).unwrap();
        assert!(json.contains("\"type\":\"extracted_json\""));
        assert!(json.contains("\"valid\":true"));
        let parsed: LogEntry = serde_json::from_str(&json).unwrap();
        assert_eq!(parsed, entry);
    }

    #[test]
    fn test_extracted_json_serialization_invalid() {
        let entry = LogEntry::ExtractedJson {
            raw_json: "not valid json".to_string(),
            valid: false,
        };
        let json = serde_json::to_string(&entry).unwrap();
        assert!(json.contains("\"type\":\"extracted_json\""));
        assert!(json.contains("\"valid\":false"));
        let parsed: LogEntry = serde_json::from_str(&json).unwrap();
        assert_eq!(parsed, entry);
    }

    #[test]
    fn test_extracted_json_type_name() {
        let entry = LogEntry::ExtractedJson {
            raw_json: "{}".to_string(),
            valid: true,
        };
        assert_eq!(entry.type_name(), "extracted_json");
    }

    #[test]
    fn test_extracted_json_push_summary_valid() {
        let entry = LogEntry::ExtractedJson {
            raw_json: "{}".to_string(),
            valid: true,
        };
        assert_eq!(
            entry.push_summary(),
            Some("extracted json (valid)".to_string())
        );
    }

    #[test]
    fn test_extracted_json_push_summary_invalid() {
        let entry = LogEntry::ExtractedJson {
            raw_json: "bad".to_string(),
            valid: false,
        };
        assert_eq!(
            entry.push_summary(),
            Some("extracted json (invalid)".to_string())
        );
    }
}
