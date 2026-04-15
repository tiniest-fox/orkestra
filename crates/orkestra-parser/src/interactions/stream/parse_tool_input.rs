//! Parse tool input JSON into structured `ToolInput`.

use orkestra_types::domain::{OrkAction, TodoItem, ToolInput};

/// Parses a tool input JSON into a structured `ToolInput`.
///
/// Tool names are matched case-insensitively: Claude Code uses `PascalCase` ("Bash"),
/// while `OpenCode` emits lowercase ("bash").
pub fn execute(tool_name: &str, input: &serde_json::Value) -> ToolInput {
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
        "agent" => ToolInput::Agent {
            description: get_str_field(input, "description"),
        },
        "todowrite" => ToolInput::TodoWrite {
            todos: parse_todo_items(input),
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

// -- Helpers --

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

// ============================================================================
// Tests
// ============================================================================

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
    fn test_parse_tool_input_websearch() {
        let input = serde_json::json!({"query": "rust syntect themes"});
        let result = execute("WebSearch", &input);
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

        let variations = ["websearch", "WebSearch", "WEBSEARCH", "Websearch"];
        for tool_name in variations {
            let result = execute(tool_name, &input);
            assert!(
                matches!(result, ToolInput::WebSearch { .. }),
                "{tool_name} should parse to WebSearch"
            );
        }
    }

    #[test]
    fn test_parse_tool_input_webfetch() {
        let input = serde_json::json!({"url": "https://example.com", "prompt": "extract info"});
        let result = execute("WebFetch", &input);
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

        let variations = ["webfetch", "WebFetch", "WEBFETCH", "Webfetch"];
        for tool_name in variations {
            let result = execute(tool_name, &input);
            assert!(
                matches!(result, ToolInput::WebFetch { .. }),
                "{tool_name} should parse to WebFetch"
            );
        }
    }

    #[test]
    fn test_parse_tool_input_agent() {
        let input = serde_json::json!({"description": "spawn subagent"});
        let result = execute("Agent", &input);
        assert!(
            matches!(result, ToolInput::Agent { ref description } if description == "spawn subagent"),
            "Expected Agent variant with description"
        );
    }

    #[test]
    fn test_parse_tool_input_unknown_tool_fallback() {
        let input = serde_json::json!({"some_field": "some_value"});
        let result = execute("UnknownTool", &input);
        assert!(
            matches!(result, ToolInput::Other { .. }),
            "Unknown tools should fall through to Other"
        );
    }
}
