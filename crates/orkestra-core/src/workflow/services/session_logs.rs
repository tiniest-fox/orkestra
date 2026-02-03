//! Session log parsing helpers.
//!
//! This module provides parsing utilities for Claude Code and other agent
//! session events. Used by the stream parsers in `stream_parser.rs` to
//! convert raw JSON events into structured `LogEntry` values.

use crate::workflow::domain::{OrkAction, TodoItem, ToolInput};

// ============================================================================
// Resume Marker Types
// ============================================================================

/// Types of session resumption.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum ResumeMarkerType {
    /// Agent was interrupted, continue from where left off.
    Continue,
    /// Human provided feedback to address.
    Feedback,
    /// Integration failed with merge conflict.
    Integration,
    /// Human provided answers to questions.
    Answers,
    /// Initial agent prompt (first spawn, not a resume).
    Initial,
}

impl ResumeMarkerType {
    /// Get the string representation for serialization.
    pub fn as_str(&self) -> &'static str {
        match self {
            Self::Continue => "continue",
            Self::Feedback => "feedback",
            Self::Integration => "integration",
            Self::Answers => "answers",
            Self::Initial => "initial",
        }
    }
}

/// Parsed resume marker from a user message.
#[derive(Debug, Clone)]
pub struct ResumeMarker {
    /// Type of resume (continue, feedback, integration).
    pub marker_type: ResumeMarkerType,
    /// Content after the marker.
    pub content: String,
}

/// Legacy marker (untyped).
const LEGACY_RESUME_MARKER: &str = "<!orkestra-resume>";

/// Parse a resume marker from a user message.
///
/// Returns Some(ResumeMarker) if this is a resumption prompt, None otherwise.
/// Supports both typed markers (<!orkestra-resume:TYPE>) and legacy markers.
pub(crate) fn parse_resume_marker(text: &str) -> Option<ResumeMarker> {
    let trimmed = text.trim();

    // Initial prompt marker
    if let Some(rest) = trimmed.strip_prefix("<!orkestra-initial>") {
        let content = rest.trim().to_string();
        return Some(ResumeMarker {
            marker_type: ResumeMarkerType::Initial,
            content,
        });
    }

    // New format: typed markers <!orkestra-resume:TYPE>
    if let Some(rest) = trimmed.strip_prefix("<!orkestra-resume:") {
        // Find the closing >
        if let Some(end_idx) = rest.find('>') {
            let marker_type = match &rest[..end_idx] {
                "continue" => ResumeMarkerType::Continue,
                "feedback" => ResumeMarkerType::Feedback,
                "integration" => ResumeMarkerType::Integration,
                "answers" => ResumeMarkerType::Answers,
                _ => return None, // Unknown marker type
            };
            let content = rest[end_idx + 1..].trim().to_string();
            return Some(ResumeMarker {
                marker_type,
                content,
            });
        }
    }

    // Legacy format: untyped marker <!orkestra-resume> (treat as continue)
    if let Some(rest) = trimmed.strip_prefix(LEGACY_RESUME_MARKER) {
        let content = rest.trim().to_string();
        return Some(ResumeMarker {
            marker_type: ResumeMarkerType::Continue,
            content,
        });
    }

    // Legacy detection: use heuristics for sessions without markers
    if trimmed.is_empty() {
        return None;
    }

    // Skip initial agent prompts (long or start with agent headers)
    let is_initial_prompt = trimmed.len() > 500
        || trimmed.starts_with("# Worker Agent")
        || trimmed.starts_with("# Planner Agent")
        || trimmed.starts_with("# Reviewer Agent")
        || trimmed.starts_with("# Breakdown Agent");

    if is_initial_prompt {
        return None;
    }

    // Skip task notifications from Claude's background Task tool
    if trimmed.contains("<task-notification>") {
        return None;
    }

    // Legacy: treat as continue type
    Some(ResumeMarker {
        marker_type: ResumeMarkerType::Continue,
        content: trimmed.to_string(),
    })
}

// ============================================================================
// Tool Input Parsing
// ============================================================================

/// Extract text content from a `tool_result` item.
pub(crate) fn extract_tool_result_content(item: &serde_json::Value) -> String {
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

/// Helper to extract a string field from JSON input.
fn get_str_field(input: &serde_json::Value, field: &str) -> String {
    input
        .get(field)
        .and_then(|v| v.as_str())
        .unwrap_or("")
        .to_string()
}

/// Parses a tool input JSON into a structured `ToolInput`.
pub(crate) fn parse_tool_input(tool_name: &str, input: &serde_json::Value) -> ToolInput {
    match tool_name {
        "Bash" => {
            let command = get_str_field(input, "command");
            if let Some(ork_action) = parse_ork_command(&command) {
                return ToolInput::Ork { ork_action };
            }
            ToolInput::Bash { command }
        }
        "Read" => ToolInput::Read {
            file_path: get_str_field(input, "file_path"),
        },
        "Write" => ToolInput::Write {
            file_path: get_str_field(input, "file_path"),
        },
        "Edit" => ToolInput::Edit {
            file_path: get_str_field(input, "file_path"),
        },
        "Glob" => ToolInput::Glob {
            pattern: get_str_field(input, "pattern"),
        },
        "Grep" => ToolInput::Grep {
            pattern: get_str_field(input, "pattern"),
        },
        "Task" => ToolInput::Task {
            description: get_str_field(input, "description"),
        },
        "TodoWrite" => ToolInput::TodoWrite {
            todos: parse_todo_items(input),
        },
        "StructuredOutput" => ToolInput::StructuredOutput {
            output_type: input
                .get("type")
                .and_then(|t| t.as_str())
                .unwrap_or("unknown")
                .to_string(),
        },
        _ => ToolInput::Other {
            summary: summarize_input(input),
        },
    }
}

/// Parse todo items from `TodoWrite` input.
fn parse_todo_items(input: &serde_json::Value) -> Vec<TodoItem> {
    input
        .get("todos")
        .and_then(|t| t.as_array())
        .map(|arr| {
            arr.iter()
                .filter_map(|item| {
                    Some(TodoItem {
                        content: item.get("content")?.as_str()?.to_string(),
                        status: item.get("status")?.as_str()?.to_string(),
                        active_form: get_str_field(item, "activeForm"),
                    })
                })
                .collect()
        })
        .unwrap_or_default()
}

/// Create a compact summary of tool input for unknown tools.
fn summarize_input(input: &serde_json::Value) -> String {
    serde_json::to_string(input).map_or_else(
        |_| "{}".to_string(),
        |s| {
            if s.len() > 100 {
                format!("{}...", &s[..100])
            } else {
                s
            }
        },
    )
}

/// Helper to get first arg as String.
fn first_arg_as_string(args: &[&str]) -> String {
    args.first().map_or_else(String::new, |s| (*s).to_string())
}

/// Parse an ork CLI command from a bash command string.
fn parse_ork_command(command: &str) -> Option<OrkAction> {
    let trimmed = command.trim();

    // Check if this is an ork task command (various forms)
    let ork_part = if trimmed.starts_with("./target/debug/ork task ")
        || trimmed.starts_with("./target/release/ork task ")
    {
        // Extract the part after "ork task "
        trimmed.split_once("ork task ")?.1
    } else if trimmed.starts_with("ork task ") {
        trimmed.strip_prefix("ork task ")?
    } else {
        return None;
    };

    // Parse the subcommand and arguments
    let parts: Vec<&str> = shell_words_simple(ork_part);
    if parts.is_empty() {
        return None;
    }

    let subcommand = parts[0];
    let args = &parts[1..];

    match subcommand {
        "complete" => {
            let task_id = first_arg_as_string(args);
            let summary = extract_flag_value(args, "--summary");
            Some(OrkAction::Complete { task_id, summary })
        }
        "fail" => {
            let task_id = first_arg_as_string(args);
            let reason = extract_flag_value(args, "--reason");
            Some(OrkAction::Fail { task_id, reason })
        }
        "block" => {
            let task_id = first_arg_as_string(args);
            let reason = extract_flag_value(args, "--reason");
            Some(OrkAction::Block { task_id, reason })
        }
        "set-plan" => {
            let task_id = first_arg_as_string(args);
            Some(OrkAction::SetPlan { task_id })
        }
        "approve" => {
            let task_id = first_arg_as_string(args);
            Some(OrkAction::Approve { task_id })
        }
        "approve-review" => {
            let task_id = first_arg_as_string(args);
            Some(OrkAction::ApproveReview { task_id })
        }
        "reject-review" | "request-review-changes" => {
            let task_id = first_arg_as_string(args);
            let feedback = extract_flag_value(args, "--feedback");
            Some(OrkAction::RejectReview { task_id, feedback })
        }
        "create-subtask" => {
            let parent_id = first_arg_as_string(args);
            let title = extract_flag_value(args, "--title").unwrap_or_default();
            Some(OrkAction::CreateSubtask { parent_id, title })
        }
        "set-breakdown" => {
            let task_id = first_arg_as_string(args);
            Some(OrkAction::SetBreakdown { task_id })
        }
        "approve-breakdown" => {
            let task_id = first_arg_as_string(args);
            Some(OrkAction::ApproveBreakdown { task_id })
        }
        "skip-breakdown" => {
            let task_id = first_arg_as_string(args);
            Some(OrkAction::SkipBreakdown { task_id })
        }
        "complete-subtask" => {
            let subtask_id = first_arg_as_string(args);
            Some(OrkAction::CompleteSubtask { subtask_id })
        }
        _ => Some(OrkAction::Other {
            raw: command.to_string(),
        }),
    }
}

/// Simple shell word splitting that handles quoted strings.
fn shell_words_simple(input: &str) -> Vec<&str> {
    let mut result = Vec::new();
    let mut current_start: Option<usize> = None;
    let mut in_quotes = false;
    let mut quote_char = '"';

    for (idx, ch) in input.char_indices() {
        match ch {
            '"' | '\'' if !in_quotes => {
                in_quotes = true;
                quote_char = ch;
                if current_start.is_none() {
                    current_start = Some(idx + 1); // Start after the quote
                }
            }
            c if in_quotes && c == quote_char => {
                if let Some(start) = current_start {
                    let word = &input[start..idx];
                    if !word.is_empty() {
                        result.push(word);
                    }
                }
                current_start = None;
                in_quotes = false;
            }
            ' ' | '\t' if !in_quotes => {
                if let Some(start) = current_start {
                    let word = &input[start..idx];
                    if !word.is_empty() {
                        result.push(word);
                    }
                    current_start = None;
                }
            }
            _ => {
                if current_start.is_none() {
                    current_start = Some(idx);
                }
            }
        }
    }

    // Handle remaining word
    if let Some(start) = current_start {
        let word = &input[start..];
        if !word.is_empty() {
            result.push(word);
        }
    }

    result
}

/// Extract a flag value from argument list (e.g., --summary "value").
fn extract_flag_value(args: &[&str], flag: &str) -> Option<String> {
    let mut iter = args.iter();
    for &arg in iter.by_ref() {
        if arg == flag {
            return iter.next().map(|s| (*s).to_string());
        }
        // Handle --flag=value form
        if let Some(rest) = arg.strip_prefix(flag) {
            if let Some(value) = rest.strip_prefix('=') {
                return Some(value.to_string());
            }
        }
    }
    None
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_parse_ork_command() {
        let action = parse_ork_command("ork task complete task-1 --summary \"Done!\"");
        assert!(action.is_some());
        if let Some(OrkAction::Complete { task_id, summary }) = action {
            assert_eq!(task_id, "task-1");
            assert_eq!(summary, Some("Done!".to_string()));
        } else {
            panic!("Expected Complete action");
        }
    }

    #[test]
    fn test_shell_words_simple() {
        let result = shell_words_simple("hello world");
        assert_eq!(result, vec!["hello", "world"]);

        let result = shell_words_simple("hello \"quoted string\" world");
        assert_eq!(result, vec!["hello", "quoted string", "world"]);
    }

    #[test]
    fn test_parse_resume_marker_typed() {
        // Test typed continue marker
        let marker = parse_resume_marker("<!orkestra-resume:continue>\n\nContinue working");
        assert!(marker.is_some());
        let marker = marker.unwrap();
        assert_eq!(marker.marker_type, ResumeMarkerType::Continue);
        assert_eq!(marker.content, "Continue working");

        // Test typed feedback marker
        let marker = parse_resume_marker("<!orkestra-resume:feedback>\n\nPlease fix this bug");
        assert!(marker.is_some());
        let marker = marker.unwrap();
        assert_eq!(marker.marker_type, ResumeMarkerType::Feedback);
        assert_eq!(marker.content, "Please fix this bug");

        // Test typed integration marker
        let marker =
            parse_resume_marker("<!orkestra-resume:integration>\n\nMerge conflict in file.rs");
        assert!(marker.is_some());
        let marker = marker.unwrap();
        assert_eq!(marker.marker_type, ResumeMarkerType::Integration);
        assert_eq!(marker.content, "Merge conflict in file.rs");
    }

    #[test]
    fn test_parse_resume_marker_legacy() {
        // Legacy untyped marker should be treated as continue
        let marker = parse_resume_marker("<!orkestra-resume>User feedback here");
        assert!(marker.is_some());
        let marker = marker.unwrap();
        assert_eq!(marker.marker_type, ResumeMarkerType::Continue);
        assert_eq!(marker.content, "User feedback here");
    }

    #[test]
    fn test_parse_resume_marker_heuristics() {
        // Should skip long prompts
        let long_text = "a".repeat(600);
        assert!(parse_resume_marker(&long_text).is_none());

        // Should skip agent prompts
        assert!(parse_resume_marker("# Worker Agent\nDo stuff").is_none());

        // Short text without marker should be treated as legacy continue
        let marker = parse_resume_marker("Fix the bug please");
        assert!(marker.is_some());
        let marker = marker.unwrap();
        assert_eq!(marker.marker_type, ResumeMarkerType::Continue);
        assert_eq!(marker.content, "Fix the bug please");
    }

    #[test]
    fn test_parse_resume_marker_answers() {
        let marker = parse_resume_marker(
            "<!orkestra-resume:answers>\n\nHere are the answers:\n\nQ: What? A: Something",
        );
        assert!(marker.is_some());
        let marker = marker.unwrap();
        assert_eq!(marker.marker_type, ResumeMarkerType::Answers);
        assert!(marker.content.contains("answers"));
    }

    #[test]
    fn test_parse_resume_marker_initial() {
        let marker = parse_resume_marker(
            "<!orkestra-initial>\n\n# Worker Agent\n\nYou are a code implementation agent...",
        );
        assert!(marker.is_some());
        let marker = marker.unwrap();
        assert_eq!(marker.marker_type, ResumeMarkerType::Initial);
        assert!(marker.content.starts_with("# Worker Agent"));
    }

    #[test]
    fn test_resume_marker_type_as_str() {
        assert_eq!(ResumeMarkerType::Continue.as_str(), "continue");
        assert_eq!(ResumeMarkerType::Feedback.as_str(), "feedback");
        assert_eq!(ResumeMarkerType::Integration.as_str(), "integration");
        assert_eq!(ResumeMarkerType::Answers.as_str(), "answers");
        assert_eq!(ResumeMarkerType::Initial.as_str(), "initial");
    }
}
