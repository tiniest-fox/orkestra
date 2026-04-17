//! Parse tool input JSON into structured `ToolInput`.

use orkestra_types::domain::{OrkAction, TodoItem, ToolInput};

/// Return type for `execute` — holds the structured input and an optional display name override.
///
/// When a bash command is reclassified (e.g., grep/rg → Grep), `display_name` overrides the
/// tool name stored in `LogEntry.tool` so the frontend groups and renders it identically to
/// native Grep tool calls.
pub struct ParsedTool {
    pub input: ToolInput,
    pub display_name: Option<String>,
}

/// Parses a tool input JSON into a structured `ToolInput` and optional display name override.
///
/// Tool names are matched case-insensitively: Claude Code uses `PascalCase` ("Bash"),
/// while `OpenCode` emits lowercase ("bash").
pub fn execute(tool_name: &str, input: &serde_json::Value) -> ParsedTool {
    let normalized = tool_name.to_ascii_lowercase();
    match normalized.as_str() {
        "bash" => {
            let command = get_str_field(input, "command");
            if let Some(ork_action) = parse_ork_command(&command) {
                return ParsedTool {
                    input: ToolInput::Ork { ork_action },
                    display_name: None,
                };
            }
            if let Some(pattern) = extract_grep_pattern(&command) {
                return ParsedTool {
                    input: ToolInput::Grep { pattern },
                    display_name: Some("Grep".to_string()),
                };
            }
            ParsedTool {
                input: ToolInput::Bash { command },
                display_name: None,
            }
        }
        "read" => ParsedTool {
            input: ToolInput::Read {
                file_path: get_str_field_flexible(input, "file_path", "filePath"),
            },
            display_name: None,
        },
        "write" => ParsedTool {
            input: ToolInput::Write {
                file_path: get_str_field_flexible(input, "file_path", "filePath"),
            },
            display_name: None,
        },
        "edit" => ParsedTool {
            input: ToolInput::Edit {
                file_path: get_str_field_flexible(input, "file_path", "filePath"),
            },
            display_name: None,
        },
        "glob" => ParsedTool {
            input: ToolInput::Glob {
                pattern: get_str_field(input, "pattern"),
            },
            display_name: None,
        },
        "grep" => ParsedTool {
            input: ToolInput::Grep {
                pattern: get_str_field(input, "pattern"),
            },
            display_name: None,
        },
        "agent" => ParsedTool {
            input: ToolInput::Agent {
                description: get_str_field(input, "description"),
            },
            display_name: None,
        },
        "todowrite" => ParsedTool {
            input: ToolInput::TodoWrite {
                todos: parse_todo_items(input),
            },
            display_name: None,
        },
        "websearch" => ParsedTool {
            input: ToolInput::WebSearch {
                query: get_str_field(input, "query"),
            },
            display_name: None,
        },
        "webfetch" => ParsedTool {
            input: ToolInput::WebFetch {
                url: get_str_field(input, "url"),
            },
            display_name: None,
        },
        _ => ParsedTool {
            input: ToolInput::Other {
                summary: summarize_input(input),
            },
            display_name: None,
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

/// Detect and extract the search pattern from a bash grep/rg command.
///
/// Handles direct calls (`grep pattern file`), piped calls (`cat file | grep pattern`),
/// env-var prefixes (`LANG=C grep pattern file`), and common grep variants
/// (`rg`, `egrep`, `fgrep`).
///
/// Returns `Some(pattern)` when detected, `None` when the command is not a grep call.
fn extract_grep_pattern(command: &str) -> Option<String> {
    const GREP_COMMANDS: &[&str] = &["grep", "rg", "egrep", "fgrep"];

    // For piped commands, look in the last pipe segment that starts with a grep command.
    let segments: Vec<&str> = command.split('|').collect();
    let grep_segment = segments
        .iter()
        .rev()
        .find(|seg| {
            let first = first_word_after_env(seg.trim());
            GREP_COMMANDS.contains(&first)
        })
        .copied()?;

    let trimmed = grep_segment.trim();
    let words = shell_words_simple(trimmed);
    if words.is_empty() {
        return None;
    }

    // Skip leading KEY=VALUE env assignments.
    let mut idx = 0;
    while idx < words.len() && words[idx].contains('=') && !words[idx].starts_with('-') {
        idx += 1;
    }

    // Next word should be the grep command.
    if idx >= words.len() || !GREP_COMMANDS.contains(&words[idx]) {
        return None;
    }
    idx += 1;

    // Skip flags (args starting with '-').
    while idx < words.len() && words[idx].starts_with('-') {
        idx += 1;
    }

    // First non-flag argument is the pattern.
    if idx < words.len() {
        Some(words[idx].to_string())
    } else {
        // grep with no pattern — return empty string so we still reclassify.
        Some(String::new())
    }
}

/// Return the first word of a command after stripping leading `KEY=VALUE` env assignments.
fn first_word_after_env(command: &str) -> &str {
    for word in command.split_whitespace() {
        if word.contains('=') && !word.starts_with('-') {
            continue;
        }
        return word;
    }
    ""
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
    fn test_bash_grep_reclassified() {
        let input = serde_json::json!({"command": "grep -r 'pattern' src/"});
        let parsed = execute("Bash", &input);
        assert_eq!(
            parsed.input,
            ToolInput::Grep {
                pattern: "pattern".to_string()
            }
        );
        assert_eq!(parsed.display_name, Some("Grep".to_string()));
    }

    #[test]
    fn test_bash_rg_reclassified() {
        let input = serde_json::json!({"command": "rg 'foo' --type rust"});
        let parsed = execute("Bash", &input);
        assert_eq!(
            parsed.input,
            ToolInput::Grep {
                pattern: "foo".to_string()
            }
        );
        assert_eq!(parsed.display_name, Some("Grep".to_string()));
    }

    #[test]
    fn test_bash_piped_grep() {
        let input = serde_json::json!({"command": "cat file | grep error"});
        let parsed = execute("Bash", &input);
        assert_eq!(
            parsed.input,
            ToolInput::Grep {
                pattern: "error".to_string()
            }
        );
        assert_eq!(parsed.display_name, Some("Grep".to_string()));
    }

    #[test]
    fn test_bash_egrep_fgrep() {
        let input = serde_json::json!({"command": "egrep 'foo' file.txt"});
        let parsed = execute("Bash", &input);
        assert_eq!(
            parsed.input,
            ToolInput::Grep {
                pattern: "foo".to_string()
            }
        );

        let input = serde_json::json!({"command": "fgrep literal file.txt"});
        let parsed = execute("Bash", &input);
        assert_eq!(
            parsed.input,
            ToolInput::Grep {
                pattern: "literal".to_string()
            }
        );
    }

    #[test]
    fn test_bash_grep_no_pattern() {
        let input = serde_json::json!({"command": "grep"});
        let parsed = execute("Bash", &input);
        // Still reclassified as Grep even with no pattern (empty pattern).
        assert_eq!(
            parsed.input,
            ToolInput::Grep {
                pattern: String::new()
            }
        );
        assert_eq!(parsed.display_name, Some("Grep".to_string()));
    }

    #[test]
    fn test_bash_non_grep_unchanged() {
        let input = serde_json::json!({"command": "ls -la"});
        let parsed = execute("Bash", &input);
        assert!(matches!(parsed.input, ToolInput::Bash { .. }));
        assert_eq!(parsed.display_name, None);
    }

    #[test]
    fn test_bash_ork_still_works() {
        let input = serde_json::json!({"command": "ork task complete task-1 --summary \"Done\""});
        let parsed = execute("Bash", &input);
        assert!(matches!(parsed.input, ToolInput::Ork { .. }));
        assert_eq!(parsed.display_name, None);
    }

    #[test]
    fn test_bash_grep_with_env_prefix() {
        let input = serde_json::json!({"command": "LANG=C grep pattern file.txt"});
        let parsed = execute("Bash", &input);
        assert_eq!(
            parsed.input,
            ToolInput::Grep {
                pattern: "pattern".to_string()
            }
        );
        assert_eq!(parsed.display_name, Some("Grep".to_string()));
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
            result.input,
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
                matches!(result.input, ToolInput::WebSearch { .. }),
                "{tool_name} should parse to WebSearch"
            );
        }
    }

    #[test]
    fn test_parse_tool_input_webfetch() {
        let input = serde_json::json!({"url": "https://example.com", "prompt": "extract info"});
        let result = execute("WebFetch", &input);
        assert_eq!(
            result.input,
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
                matches!(result.input, ToolInput::WebFetch { .. }),
                "{tool_name} should parse to WebFetch"
            );
        }
    }

    #[test]
    fn test_parse_tool_input_agent() {
        let input = serde_json::json!({"description": "spawn subagent"});
        let result = execute("Agent", &input);
        assert!(
            matches!(result.input, ToolInput::Agent { ref description } if description == "spawn subagent"),
            "Expected Agent variant with description"
        );
    }

    #[test]
    fn test_parse_tool_input_unknown_tool_fallback() {
        let input = serde_json::json!({"some_field": "some_value"});
        let result = execute("UnknownTool", &input);
        assert!(
            matches!(result.input, ToolInput::Other { .. }),
            "Unknown tools should fall through to Other"
        );
    }
}
