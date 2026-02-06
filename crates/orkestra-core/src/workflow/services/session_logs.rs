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
    /// Stage is being re-run after full cycle (untriggered re-entry).
    Recheck,
    /// Human retried a failed task.
    RetryFailed,
    /// Human retried a blocked task.
    RetryBlocked,
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
            Self::Recheck => "recheck",
            Self::RetryFailed => "retry_failed",
            Self::RetryBlocked => "retry_blocked",
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

/// Parse a marker from a user message.
///
/// Returns `Some(ResumeMarker)` if this is an orkestra prompt, `None` otherwise.
/// Recognises `<!orkestra:spawn:STAGE>` (initial) and `<!orkestra:resume:STAGE:TYPE>` (resume).
pub(crate) fn parse_resume_marker(text: &str) -> Option<ResumeMarker> {
    let trimmed = text.trim();

    // All orkestra markers start with <!orkestra:
    let rest = trimmed.strip_prefix("<!orkestra:")?;
    let end_idx = rest.find('>')?;
    let tag = &rest[..end_idx];
    let content = rest[end_idx + 1..].trim().to_string();

    // Split tag by ':' → ["spawn", stage] or ["resume", stage, type]
    let parts: Vec<&str> = tag.splitn(3, ':').collect();

    match parts.as_slice() {
        ["spawn", _stage] => Some(ResumeMarker {
            marker_type: ResumeMarkerType::Initial,
            content,
        }),
        ["resume", _stage, resume_type] => {
            let marker_type = match *resume_type {
                "continue" => ResumeMarkerType::Continue,
                "feedback" => ResumeMarkerType::Feedback,
                "integration" => ResumeMarkerType::Integration,
                "answers" => ResumeMarkerType::Answers,
                "recheck" => ResumeMarkerType::Recheck,
                "retry_failed" => ResumeMarkerType::RetryFailed,
                "retry_blocked" => ResumeMarkerType::RetryBlocked,
                _ => return None,
            };
            Some(ResumeMarker {
                marker_type,
                content,
            })
        }
        _ => None,
    }
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

/// Get a string field, trying `snake_case` first then `camelCase`.
///
/// Claude Code uses `file_path`; `OpenCode` uses `filePath`.
fn get_str_field_flexible(input: &serde_json::Value, snake: &str, camel: &str) -> String {
    input
        .get(snake)
        .or_else(|| input.get(camel))
        .and_then(|v| v.as_str())
        .unwrap_or("")
        .to_string()
}

/// Parses a tool input JSON into a structured `ToolInput`.
///
/// Tool names are matched case-insensitively: Claude Code uses `PascalCase` ("Bash"),
/// while `OpenCode` emits lowercase ("bash").
pub(crate) fn parse_tool_input(tool_name: &str, input: &serde_json::Value) -> ToolInput {
    let normalized = tool_name.to_ascii_lowercase();
    match normalized.as_str() {
        "bash" => {
            let command = get_str_field(input, "command");
            if let Some(ork_action) = parse_ork_command(&command) {
                return ToolInput::Ork { ork_action };
            }
            ToolInput::Bash { command }
        }
        "read" => ToolInput::Read {
            file_path: get_str_field_flexible(input, "file_path", "filePath"),
        },
        "write" => ToolInput::Write {
            file_path: get_str_field_flexible(input, "file_path", "filePath"),
        },
        "edit" => ToolInput::Edit {
            file_path: get_str_field_flexible(input, "file_path", "filePath"),
        },
        "glob" => ToolInput::Glob {
            pattern: get_str_field(input, "pattern"),
        },
        "grep" => ToolInput::Grep {
            pattern: get_str_field(input, "pattern"),
        },
        "task" => ToolInput::Task {
            description: get_str_field(input, "description"),
        },
        "todowrite" => ToolInput::TodoWrite {
            todos: parse_todo_items(input),
        },
        "structuredoutput" => ToolInput::StructuredOutput {
            output_type: input
                .get("type")
                .and_then(|t| t.as_str())
                .unwrap_or("unknown")
                .to_string(),
        },
        "websearch" => ToolInput::WebSearch {
            query: get_str_field(input, "query"),
        },
        "webfetch" => ToolInput::WebFetch {
            url: get_str_field(input, "url"),
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
        // Test continue marker
        let marker = parse_resume_marker("<!orkestra:resume:work:continue>\n\nContinue working");
        assert!(marker.is_some());
        let marker = marker.unwrap();
        assert_eq!(marker.marker_type, ResumeMarkerType::Continue);
        assert_eq!(marker.content, "Continue working");

        // Test feedback marker
        let marker =
            parse_resume_marker("<!orkestra:resume:review:feedback>\n\nPlease fix this bug");
        assert!(marker.is_some());
        let marker = marker.unwrap();
        assert_eq!(marker.marker_type, ResumeMarkerType::Feedback);
        assert_eq!(marker.content, "Please fix this bug");

        // Test integration marker
        let marker =
            parse_resume_marker("<!orkestra:resume:work:integration>\n\nMerge conflict in file.rs");
        assert!(marker.is_some());
        let marker = marker.unwrap();
        assert_eq!(marker.marker_type, ResumeMarkerType::Integration);
        assert_eq!(marker.content, "Merge conflict in file.rs");
    }

    #[test]
    fn test_parse_resume_marker_unrecognized_returns_none() {
        assert!(parse_resume_marker("Fix the bug please").is_none());
        assert!(parse_resume_marker("# Worker Agent\nDo stuff").is_none());
        assert!(parse_resume_marker("").is_none());
    }

    #[test]
    fn test_parse_resume_marker_answers() {
        let marker = parse_resume_marker(
            "<!orkestra:resume:planning:answers>\n\nHere are the answers:\n\nQ: What? A: Something",
        );
        assert!(marker.is_some());
        let marker = marker.unwrap();
        assert_eq!(marker.marker_type, ResumeMarkerType::Answers);
        assert!(marker.content.contains("answers"));
    }

    #[test]
    fn test_resume_marker_type_as_str() {
        assert_eq!(ResumeMarkerType::Continue.as_str(), "continue");
        assert_eq!(ResumeMarkerType::Feedback.as_str(), "feedback");
        assert_eq!(ResumeMarkerType::Integration.as_str(), "integration");
        assert_eq!(ResumeMarkerType::Answers.as_str(), "answers");
        assert_eq!(ResumeMarkerType::Recheck.as_str(), "recheck");
        assert_eq!(ResumeMarkerType::RetryFailed.as_str(), "retry_failed");
        assert_eq!(ResumeMarkerType::RetryBlocked.as_str(), "retry_blocked");
        assert_eq!(ResumeMarkerType::Initial.as_str(), "initial");
    }

    #[test]
    fn test_parse_resume_marker_spawn() {
        let marker = parse_resume_marker(
            "<!orkestra:spawn:review>\n\n# Reviewer Agent\n\nYou review code...",
        );
        assert!(marker.is_some());
        let marker = marker.unwrap();
        assert_eq!(marker.marker_type, ResumeMarkerType::Initial);
        assert!(marker.content.starts_with("# Reviewer Agent"));
    }

    #[test]
    fn test_parse_resume_marker_recheck() {
        let marker =
            parse_resume_marker("<!orkestra:resume:review:recheck>\n\nThis stage is being re-run.");
        assert!(marker.is_some());
        let marker = marker.unwrap();
        assert_eq!(marker.marker_type, ResumeMarkerType::Recheck);
        assert!(marker.content.contains("re-run"));
    }

    #[test]
    fn test_parse_resume_marker_retry_failed() {
        let marker = parse_resume_marker(
            "<!orkestra:resume:work:retry_failed>\n\nRetrying after task failure.",
        );
        assert!(marker.is_some());
        let marker = marker.unwrap();
        assert_eq!(marker.marker_type, ResumeMarkerType::RetryFailed);
        assert!(marker.content.contains("failure"));
    }

    #[test]
    fn test_parse_resume_marker_retry_blocked() {
        let marker = parse_resume_marker(
            "<!orkestra:resume:work:retry_blocked>\n\nRetrying after task was blocked.",
        );
        assert!(marker.is_some());
        let marker = marker.unwrap();
        assert_eq!(marker.marker_type, ResumeMarkerType::RetryBlocked);
        assert!(marker.content.contains("blocked"));
    }

    #[test]
    fn test_parse_tool_input_websearch() {
        let input = serde_json::json!({"query": "rust syntect themes"});
        let result = parse_tool_input("WebSearch", &input);
        assert_eq!(
            result,
            ToolInput::WebSearch {
                query: "rust syntect themes".to_string()
            }
        );
    }

    #[test]
    fn test_parse_tool_input_websearch_case_insensitive() {
        let input = serde_json::json!({"query": "search query"});

        // All these should parse to WebSearch
        let variations = ["websearch", "WebSearch", "WEBSEARCH", "Websearch"];
        for tool_name in variations {
            let result = parse_tool_input(tool_name, &input);
            assert!(
                matches!(result, ToolInput::WebSearch { .. }),
                "{tool_name} should parse to WebSearch"
            );
        }
    }

    #[test]
    fn test_parse_tool_input_webfetch() {
        let input = serde_json::json!({"url": "https://example.com", "prompt": "extract info"});
        let result = parse_tool_input("WebFetch", &input);
        assert_eq!(
            result,
            ToolInput::WebFetch {
                url: "https://example.com".to_string()
            }
        );
    }

    #[test]
    fn test_parse_tool_input_webfetch_case_insensitive() {
        let input = serde_json::json!({"url": "https://example.com"});

        // All these should parse to WebFetch
        let variations = ["webfetch", "WebFetch", "WEBFETCH", "Webfetch"];
        for tool_name in variations {
            let result = parse_tool_input(tool_name, &input);
            assert!(
                matches!(result, ToolInput::WebFetch { .. }),
                "{tool_name} should parse to WebFetch"
            );
        }
    }

    #[test]
    fn test_parse_tool_input_unknown_tool_fallback() {
        let input = serde_json::json!({"some_field": "some_value"});
        let result = parse_tool_input("UnknownTool", &input);
        assert!(
            matches!(result, ToolInput::Other { .. }),
            "Unknown tools should fall through to Other"
        );
    }
}
