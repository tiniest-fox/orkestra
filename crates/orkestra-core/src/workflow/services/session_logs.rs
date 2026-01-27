//! Session log parsing for Claude Code sessions.
//!
//! This module handles reading and parsing Claude Code session files (.jsonl)
//! to extract log entries for display in the UI.

use std::collections::{HashMap, HashSet};
use std::fs;
use std::io::BufRead;
use std::path::{Path, PathBuf};

use crate::workflow::domain::{LogEntry, OrkAction, TodoItem, ToolInput};

/// Maximum number of subagent tool uses to include per Task tool invocation.
const MAX_SUBAGENT_TOOL_USES: usize = 5;

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
    /// Maps Task `tool_use_id` to agentId for loading subagent sessions.
    task_agent_map: HashMap<String, String>,
    /// Session directory path (for locating subagent sessions).
    session_dir: Option<PathBuf>,
    /// Parent session ID (for locating subagent sessions).
    session_id: Option<String>,
}

impl SessionLogParser {
    fn new(session_dir: Option<PathBuf>, session_id: Option<String>) -> Self {
        Self {
            entries: Vec::new(),
            tool_use_map: HashMap::new(),
            task_tool_ids: HashSet::new(),
            task_agent_map: HashMap::new(),
            session_dir,
            session_id,
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

    /// Process a Task tool completion that contains subagent information.
    ///
    /// When a Task tool completes, the session entry has a top-level `toolUseResult` field
    /// containing the agentId. We use this to load the subagent's session file and extract
    /// its recent tool uses for display.
    fn process_task_tool_use_result(
        &mut self,
        tool_use_result: &serde_json::Value,
        entry: &serde_json::Value,
    ) {
        // Extract agentId from toolUseResult
        let Some(agent_id) = tool_use_result.get("agentId").and_then(|a| a.as_str()) else {
            return;
        };

        // Find the corresponding tool_use_id from the message content
        let tool_use_id = entry
            .get("message")
            .and_then(|m| m.get("content"))
            .and_then(|c| c.as_array())
            .and_then(|arr| {
                arr.iter().find_map(|item| {
                    if item.get("type").and_then(|t| t.as_str()) == Some("tool_result") {
                        item.get("tool_use_id").and_then(|id| id.as_str())
                    } else {
                        None
                    }
                })
            });

        let tool_use_id = match tool_use_id {
            Some(id) => id.to_string(),
            None => return,
        };

        // Store the mapping for potential future use
        self.task_agent_map
            .insert(tool_use_id.clone(), agent_id.to_string());

        // Load and insert subagent tool uses
        if let Some(subagent_entries) = self.load_subagent_tool_uses(agent_id, &tool_use_id) {
            // Find the position of the Task ToolResult to insert subagent entries before it
            // We search backwards from the end since the Task result was just added
            let insert_pos = self
                .entries
                .iter()
                .rposition(|e| matches!(e, LogEntry::ToolResult { tool, tool_use_id: id, .. } if tool == "Task" && id == &tool_use_id))
                .unwrap_or(self.entries.len());

            // Insert subagent entries before the Task result
            for (i, entry) in subagent_entries.into_iter().enumerate() {
                self.entries.insert(insert_pos + i, entry);
            }
        }
    }

    /// Load the last N tool uses from a subagent session file.
    fn load_subagent_tool_uses(
        &self,
        agent_id: &str,
        parent_task_id: &str,
    ) -> Option<Vec<LogEntry>> {
        let session_dir = self.session_dir.as_ref()?;
        let session_id = self.session_id.as_ref()?;

        // Subagent session path: {session_dir}/{session_id}/subagents/agent-{agentId}.jsonl
        let subagent_path = session_dir
            .join(session_id)
            .join("subagents")
            .join(format!("agent-{agent_id}.jsonl"));

        if !subagent_path.exists() {
            // Subagent session file may not exist if deleted or crashed
            return None;
        }

        let Ok(file) = fs::File::open(&subagent_path) else {
            // Silently skip if we can't open the file
            return None;
        };

        let reader = std::io::BufReader::new(file);
        let mut tool_uses: Vec<LogEntry> = Vec::new();

        for line in reader.lines() {
            let Ok(line) = line else {
                continue;
            };

            if line.trim().is_empty() {
                continue;
            }

            let v: serde_json::Value = match serde_json::from_str(&line) {
                Ok(v) => v,
                Err(_) => continue,
            };

            // Only process assistant messages with tool_use
            if v.get("type").and_then(|t| t.as_str()) != Some("assistant") {
                continue;
            }

            if let Some(content) = v
                .get("message")
                .and_then(|m| m.get("content"))
                .and_then(|c| c.as_array())
            {
                for item in content {
                    if item.get("type").and_then(|t| t.as_str()) == Some("tool_use") {
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
                        let tool_input = parse_tool_input(&tool_name, &input);

                        tool_uses.push(LogEntry::SubagentToolUse {
                            tool: tool_name,
                            id: tool_id,
                            input: tool_input,
                            parent_task_id: parent_task_id.to_string(),
                        });
                    }
                }
            }
        }

        // Return only the last N tool uses
        if tool_uses.len() > MAX_SUBAGENT_TOOL_USES {
            Some(
                tool_uses
                    .into_iter()
                    .rev()
                    .take(MAX_SUBAGENT_TOOL_USES)
                    .rev()
                    .collect(),
            )
        } else {
            Some(tool_uses)
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

    // Get session directory for subagent session lookup
    let session_dir = path.parent().map(PathBuf::from);

    let file = fs::File::open(&path)?;
    let reader = std::io::BufReader::new(file);
    let mut parser = SessionLogParser::new(session_dir, Some(session_id.to_string()));

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

        // Check for toolUseResult at the top level (Task tool completion with subagent info)
        if let Some(tool_use_result) = v.get("toolUseResult") {
            parser.process_task_tool_use_result(tool_use_result, &v);
        }

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
                                if let Some(marker) = parse_resume_marker(text) {
                                    parser.entries.push(LogEntry::UserMessage {
                                        resume_type: marker.marker_type.as_str().to_string(),
                                        content: marker.content,
                                    });
                                }
                            }
                        }
                        _ => {}
                    }
                }
            }
            // Handle content as string (simple text message, e.g., initial prompt or resumption)
            else if let Some(text) = content.and_then(|c| c.as_str()) {
                if let Some(marker) = parse_resume_marker(text) {
                    parser.entries.push(LogEntry::UserMessage {
                        resume_type: marker.marker_type.as_str().to_string(),
                        content: marker.content,
                    });
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
}

impl ResumeMarkerType {
    /// Get the string representation for serialization.
    pub fn as_str(&self) -> &'static str {
        match self {
            Self::Continue => "continue",
            Self::Feedback => "feedback",
            Self::Integration => "integration",
            Self::Answers => "answers",
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
fn parse_resume_marker(text: &str) -> Option<ResumeMarker> {
    let trimmed = text.trim();

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

/// Helper to extract a string field from JSON input.
fn get_str_field(input: &serde_json::Value, field: &str) -> String {
    input
        .get(field)
        .and_then(|v| v.as_str())
        .unwrap_or("")
        .to_string()
}

/// Parses a tool input JSON into a structured `ToolInput`.
fn parse_tool_input(tool_name: &str, input: &serde_json::Value) -> ToolInput {
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
    fn test_resume_marker_type_as_str() {
        assert_eq!(ResumeMarkerType::Continue.as_str(), "continue");
        assert_eq!(ResumeMarkerType::Feedback.as_str(), "feedback");
        assert_eq!(ResumeMarkerType::Integration.as_str(), "integration");
        assert_eq!(ResumeMarkerType::Answers.as_str(), "answers");
    }
}
