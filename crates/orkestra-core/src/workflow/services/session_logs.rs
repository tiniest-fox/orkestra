//! Session log parsing for Claude Code sessions.
//!
//! This module handles reading and parsing Claude Code session files (.jsonl)
//! to extract log entries for display in the UI.

use std::collections::{HashMap, HashSet};
use std::fs;
use std::io::BufRead;
use std::path::{Path, PathBuf};

use crate::workflow::domain::{LogEntry, OrkAction, TodoItem, ToolInput};

/// Get path to Claude's session file.
///
/// The `cwd` parameter should be the directory where the Claude session was started.
/// For agents working in worktrees, this is the worktree path, not the main project root.
pub fn get_claude_session_path(session_id: &str, cwd: &Path) -> Option<PathBuf> {
    let home = dirs::home_dir()?;

    // Encode cwd to match Claude's directory naming:
    // Claude replaces both '/' and '.' with '-'
    // Example: /Users/foo/.orkestra/bar -> -Users-foo--orkestra-bar
    let encoded_cwd = cwd.to_string_lossy().replace(['/', '.'], "-");

    Some(
        home.join(".claude/projects")
            .join(&encoded_cwd)
            .join(format!("{session_id}.jsonl")),
    )
}

/// State for tracking session log parsing.
struct SessionLogParser {
    entries: Vec<LogEntry>,
    tool_use_map: HashMap<String, String>,
    task_tool_ids: HashSet<String>,
}

impl SessionLogParser {
    fn new() -> Self {
        Self {
            entries: Vec::new(),
            tool_use_map: HashMap::new(),
            task_tool_ids: HashSet::new(),
        }
    }

    fn is_subagent_event(&self, parent_id: Option<&String>) -> bool {
        parent_id.is_some_and(|id| self.task_tool_ids.contains(id))
    }

    fn process_text(&mut self, item: &serde_json::Value, is_subagent: bool) {
        if is_subagent {
            return; // Skip text from subagent events
        }
        if let Some(text) = item.get("text").and_then(|t| t.as_str()) {
            let trimmed = text.trim();
            if !trimmed.is_empty() {
                self.entries.push(LogEntry::Text {
                    content: trimmed.to_string(),
                });
            }
        }
    }

    fn process_tool_use(
        &mut self,
        item: &serde_json::Value,
        is_subagent: bool,
        parent_id: Option<&String>,
    ) {
        let tool_name = item
            .get("name")
            .and_then(|n| n.as_str())
            .unwrap_or("unknown")
            .to_string();
        let tool_id = item
            .get("id")
            .and_then(|i| i.as_str())
            .unwrap_or("")
            .to_string();
        let input = item.get("input").cloned().unwrap_or(serde_json::json!({}));

        self.tool_use_map.insert(tool_id.clone(), tool_name.clone());
        if tool_name == "Task" {
            self.task_tool_ids.insert(tool_id.clone());
        }

        let tool_input = parse_tool_input(&tool_name, &input);

        if is_subagent {
            self.entries.push(LogEntry::SubagentToolUse {
                tool: tool_name,
                id: tool_id,
                input: tool_input,
                parent_task_id: parent_id.cloned().unwrap_or_default(),
            });
        } else {
            self.entries.push(LogEntry::ToolUse {
                tool: tool_name,
                id: tool_id,
                input: tool_input,
            });
        }
    }

    fn process_tool_result(
        &mut self,
        item: &serde_json::Value,
        is_subagent: bool,
        parent_id: Option<&String>,
    ) {
        let tool_use_id = item
            .get("tool_use_id")
            .and_then(|i| i.as_str())
            .unwrap_or("")
            .to_string();
        let tool_name = self
            .tool_use_map
            .get(&tool_use_id)
            .cloned()
            .unwrap_or_else(|| "unknown".to_string());
        let content_str = extract_tool_result_content(item);

        if content_str.trim().is_empty() {
            return;
        }

        if is_subagent {
            self.entries.push(LogEntry::SubagentToolResult {
                tool: tool_name,
                tool_use_id,
                content: content_str,
                parent_task_id: parent_id.cloned().unwrap_or_default(),
            });
        } else if tool_name == "Task" {
            self.entries.push(LogEntry::ToolResult {
                tool: tool_name,
                tool_use_id,
                content: content_str,
            });
        }
    }
}

/// Recover logs from Claude's session file.
///
/// The `cwd` parameter should be the directory where the Claude session was started.
/// For agents working in worktrees, this is the worktree path.
pub fn recover_session_logs(session_id: &str, cwd: &Path) -> std::io::Result<Vec<LogEntry>> {
    let path = get_claude_session_path(session_id, cwd).ok_or_else(|| {
        std::io::Error::new(
            std::io::ErrorKind::NotFound,
            "Could not determine session path",
        )
    })?;

    if !path.exists() {
        return Err(std::io::Error::new(
            std::io::ErrorKind::NotFound,
            format!("Session file not found: {}", path.display()),
        ));
    }

    let file = fs::File::open(&path)?;
    let reader = std::io::BufReader::new(file);
    let mut parser = SessionLogParser::new();

    for line in reader.lines() {
        let line = line?;
        if line.trim().is_empty() {
            continue;
        }

        let Ok(v) = serde_json::from_str::<serde_json::Value>(&line) else {
            continue;
        };
        let msg_type = v.get("type").and_then(|t| t.as_str()).unwrap_or("");
        let parent_id = v
            .get("parent_tool_use_id")
            .and_then(|p| p.as_str())
            .map(String::from);
        let is_subagent = parser.is_subagent_event(parent_id.as_ref());

        if msg_type == "assistant" {
            if let Some(content) = v
                .get("message")
                .and_then(|m| m.get("content"))
                .and_then(|c| c.as_array())
            {
                for item in content {
                    match item.get("type").and_then(|t| t.as_str()) {
                        Some("text") => parser.process_text(item, is_subagent),
                        Some("tool_use") => {
                            parser.process_tool_use(item, is_subagent, parent_id.as_ref());
                        }
                        _ => {}
                    }
                }
            }
        } else if msg_type == "user" {
            let content = v.get("message").and_then(|m| m.get("content"));

            // Handle content as array (tool results, structured content)
            if let Some(arr) = content.and_then(|c| c.as_array()) {
                for item in arr {
                    match item.get("type").and_then(|t| t.as_str()) {
                        Some("tool_result") => {
                            parser.process_tool_result(item, is_subagent, parent_id.as_ref());
                        }
                        Some("text") => {
                            // Capture user text messages (e.g., session resumption prompts)
                            if let Some(text) = item.get("text").and_then(|t| t.as_str()) {
                                if let Some(content) = extract_resumption_content(text) {
                                    parser.entries.push(LogEntry::UserMessage { content });
                                }
                            }
                        }
                        _ => {}
                    }
                }
            }
            // Handle content as string (simple text message, e.g., initial prompt or resumption)
            else if let Some(text) = content.and_then(|c| c.as_str()) {
                if let Some(content) = extract_resumption_content(text) {
                    parser.entries.push(LogEntry::UserMessage { content });
                }
            }
        }
    }

    Ok(parser.entries)
}

/// Extract text content from a `tool_result` item.
fn extract_tool_result_content(item: &serde_json::Value) -> String {
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

/// Marker used to identify Orkestra resumption prompts in session logs.
const RESUME_MARKER: &str = "<!orkestra-resume>";

/// Extract resumption prompt content from a user message.
/// Returns Some(content) if this is a resumption prompt, None otherwise.
fn extract_resumption_content(text: &str) -> Option<String> {
    let trimmed = text.trim();

    // New format: explicit marker
    if let Some(rest) = trimmed.strip_prefix(RESUME_MARKER) {
        let content = rest.trim();
        if !content.is_empty() {
            return Some(content.to_string());
        }
        return None;
    }

    // Legacy detection: use heuristics
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

    Some(trimmed.to_string())
}

/// Parses a tool input JSON into a structured `ToolInput`.
fn parse_tool_input(tool_name: &str, input: &serde_json::Value) -> ToolInput {
    match tool_name {
        "Bash" => {
            let command = input
                .get("command")
                .and_then(|c| c.as_str())
                .unwrap_or("")
                .to_string();

            // Check if this is an ork command
            if let Some(ork_action) = parse_ork_command(&command) {
                return ToolInput::Ork { ork_action };
            }

            ToolInput::Bash { command }
        }
        "Read" => {
            let file_path = input
                .get("file_path")
                .and_then(|p| p.as_str())
                .unwrap_or("")
                .to_string();
            ToolInput::Read { file_path }
        }
        "Write" => {
            let file_path = input
                .get("file_path")
                .and_then(|p| p.as_str())
                .unwrap_or("")
                .to_string();
            ToolInput::Write { file_path }
        }
        "Edit" => {
            let file_path = input
                .get("file_path")
                .and_then(|p| p.as_str())
                .unwrap_or("")
                .to_string();
            ToolInput::Edit { file_path }
        }
        "Glob" => {
            let pattern = input
                .get("pattern")
                .and_then(|p| p.as_str())
                .unwrap_or("")
                .to_string();
            ToolInput::Glob { pattern }
        }
        "Grep" => {
            let pattern = input
                .get("pattern")
                .and_then(|p| p.as_str())
                .unwrap_or("")
                .to_string();
            ToolInput::Grep { pattern }
        }
        "Task" => {
            let description = input
                .get("description")
                .and_then(|d| d.as_str())
                .unwrap_or("")
                .to_string();
            ToolInput::Task { description }
        }
        "TodoWrite" => {
            let todos = input
                .get("todos")
                .and_then(|t| t.as_array())
                .map(|arr| {
                    arr.iter()
                        .filter_map(|item| {
                            let content = item.get("content")?.as_str()?.to_string();
                            let status = item.get("status")?.as_str()?.to_string();
                            let active_form = item
                                .get("activeForm")
                                .and_then(|a| a.as_str())
                                .unwrap_or("")
                                .to_string();
                            Some(TodoItem {
                                content,
                                status,
                                active_form,
                            })
                        })
                        .collect()
                })
                .unwrap_or_default();
            ToolInput::TodoWrite { todos }
        }
        _ => {
            // For other tools, create a compact summary
            let summary = serde_json::to_string(input).map_or_else(
                |_| "{}".to_string(),
                |s| {
                    if s.len() > 100 {
                        format!("{}...", &s[..100])
                    } else {
                        s
                    }
                },
            );
            ToolInput::Other { summary }
        }
    }
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
    fn test_get_claude_session_path() {
        let cwd = Path::new("/Users/test/project");
        let path = get_claude_session_path("session-123", cwd);
        assert!(path.is_some());
        let path = path.unwrap();
        assert!(path.to_string_lossy().contains("session-123.jsonl"));
    }

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
    fn test_extract_resumption_content() {
        // Should skip long prompts
        let long_text = "a".repeat(600);
        assert!(extract_resumption_content(&long_text).is_none());

        // Should skip agent prompts
        assert!(extract_resumption_content("# Worker Agent\nDo stuff").is_none());

        // Should extract normal content
        let content = extract_resumption_content("Fix the bug please");
        assert_eq!(content, Some("Fix the bug please".to_string()));

        // Should handle resume marker
        let content = extract_resumption_content("<!orkestra-resume>User feedback here");
        assert_eq!(content, Some("User feedback here".to_string()));
    }
}
