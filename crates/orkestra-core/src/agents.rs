use std::path::PathBuf;
use std::process::{Command, Stdio};
use std::fs;
use std::io::BufRead;

use crate::project;
use crate::tasks::{Task, TaskStatus, LogEntry, ToolInput, update_task_status, add_task_session, get_next_review_session_key, get_next_breakdown_session_key, get_subtasks};

/// Agent types that can be spawned
#[derive(Debug, Clone, Copy, PartialEq)]
pub enum AgentType {
    Planner,
    Breakdown,
    Worker,
}

/// Builds the prompt for a planner agent
fn build_planner_prompt(task: &Task, agent_definition: &str) -> String {
    let feedback_section = if let Some(feedback) = &task.plan_feedback {
        format!(
            r#"

## Previous Plan Feedback

The user has requested changes to the previous plan:

{}

Please revise your plan to address this feedback.
"#,
            feedback
        )
    } else {
        String::new()
    };

    let completion_instructions = if task.auto_approve {
        format!(
            r#"Remember: This task has AUTO-APPROVE enabled. When your plan is ready, you MUST run BOTH commands in sequence:
1. `ork task set-plan {task_id} --plan "YOUR_MARKDOWN_PLAN"`
2. `ork task approve {task_id}`

The second command will automatically start the worker agent to implement your plan."#,
            task_id = task.id
        )
    } else {
        format!(
            r#"Remember: When your plan is ready, you MUST run:
`ork task set-plan {task_id} --plan "YOUR_MARKDOWN_PLAN"`"#,
            task_id = task.id
        )
    };

    format!(
        r#"{agent_definition}

---

## Your Current Task

**Task ID**: {task_id}
**Title**: {title}

### Description
{description}
{feedback_section}
---

{completion_instructions}
"#,
        agent_definition = agent_definition,
        task_id = task.id,
        title = task.title,
        description = task.description,
        feedback_section = feedback_section,
        completion_instructions = completion_instructions,
    )
}

/// Builds the prompt for a worker agent
fn build_worker_prompt(task: &Task, agent_definition: &str, subtasks: Option<&[Task]>) -> String {
    let plan_section = if let Some(plan) = &task.plan {
        format!(
            r#"

## Approved Implementation Plan

Follow this plan that was approved by the user:

{}
"#,
            plan
        )
    } else {
        String::new()
    };

    let review_feedback_section = if let Some(feedback) = &task.review_feedback {
        format!(
            r#"

## Review Feedback

The reviewer has requested changes to your work:

{}

Please address this feedback and continue your implementation."#,
            feedback
        )
    } else {
        String::new()
    };

    let subtasks_section = if let Some(subs) = subtasks {
        if subs.is_empty() {
            String::new()
        } else {
            let checklist: String = subs.iter().map(|s| {
                let status_marker = if s.status == TaskStatus::Done { "x" } else { " " };
                format!("- [{}] **{}**: {} (ID: {})\n", status_marker, s.title, s.description, s.id)
            }).collect();
            format!(
                r#"

## Subtasks Checklist

Work through these subtasks in order. Mark each complete as you finish:

{}
To mark a subtask complete, run: `ork task complete-subtask SUBTASK_ID`
"#,
                checklist
            )
        }
    } else {
        String::new()
    };

    format!(
        r#"{agent_definition}

---

## Your Current Task

**Task ID**: {task_id}
**Title**: {title}

### Description
{description}
{plan_section}{subtasks_section}{review_feedback_section}
---

Remember: When you are done with ALL work, you MUST run one of these commands:
- `ork task complete {task_id} --summary "what you did"` - if successful
- `ork task fail {task_id} --reason "why"` - if you cannot complete it
- `ork task block {task_id} --reason "what you need"` - if you need clarification
"#,
        agent_definition = agent_definition,
        task_id = task.id,
        title = task.title,
        description = task.description,
        plan_section = plan_section,
        subtasks_section = subtasks_section,
        review_feedback_section = review_feedback_section,
    )
}

/// Builds the prompt for a breakdown agent
fn build_breakdown_prompt(task: &Task, agent_definition: &str) -> String {
    let plan_section = if let Some(plan) = &task.plan {
        format!(
            r#"

## Approved Implementation Plan

The following plan has been approved for implementation:

{}
"#,
            plan
        )
    } else {
        String::new()
    };

    let feedback_section = if let Some(feedback) = &task.breakdown_feedback {
        format!(
            r#"

## Previous Breakdown Feedback

The user has requested changes to the previous breakdown:

{}

Please revise your breakdown to address this feedback.
"#,
            feedback
        )
    } else {
        String::new()
    };

    let completion_instructions = if task.auto_approve {
        format!(
            r#"Remember: This task has AUTO-APPROVE enabled. When your breakdown is ready:
1. Create all subtasks using `ork task create-subtask {task_id} --title "..." --description "..."`
2. Run `ork task set-breakdown {task_id} --breakdown "YOUR_BREAKDOWN_SUMMARY"`
3. Run `ork task approve-breakdown {task_id}`"#,
            task_id = task.id
        )
    } else {
        format!(
            r#"Remember: When your breakdown is ready:
1. Create all subtasks using `ork task create-subtask {task_id} --title "..." --description "..."`
2. Run `ork task set-breakdown {task_id} --breakdown "YOUR_BREAKDOWN_SUMMARY"`

If the task is simple and doesn't need subtasks, instead run:
`ork task skip-breakdown {task_id}`"#,
            task_id = task.id
        )
    };

    format!(
        r#"{agent_definition}

---

## Your Current Task

**Task ID**: {task_id}
**Title**: {title}

### Description
{description}
{plan_section}{feedback_section}
---

{completion_instructions}
"#,
        agent_definition = agent_definition,
        task_id = task.id,
        title = task.title,
        description = task.description,
        plan_section = plan_section,
        feedback_section = feedback_section,
        completion_instructions = completion_instructions,
    )
}

/// Finds the ork CLI binary path
fn find_cli_path() -> Option<PathBuf> {
    // First check if ork is in PATH
    if let Ok(output) = Command::new("which").arg("ork").output() {
        if output.status.success() {
            let path = String::from_utf8_lossy(&output.stdout).trim().to_string();
            if !path.is_empty() {
                return Some(PathBuf::from(path));
            }
        }
    }

    // Check relative to current directory (development mode)
    let dev_path = std::env::current_dir()
        .ok()?
        .join("target/debug/ork");
    if dev_path.exists() {
        return Some(dev_path);
    }

    None
}

/// Loads the agent definition from the agents directory
pub fn load_agent_definition(agent_type: &str) -> std::io::Result<String> {
    // Try project .orkestra/agents/ first
    if let Ok(project_root) = project::find_project_root() {
        let local_path = project_root.join(".orkestra/agents").join(format!("{}.md", agent_type));
        if local_path.exists() {
            return fs::read_to_string(local_path);
        }
    }

    // Fall back to home directory for global/default agents
    if let Some(home) = dirs::home_dir() {
        let home_path = home.join(".orkestra/agents").join(format!("{}.md", agent_type));
        if home_path.exists() {
            return fs::read_to_string(home_path);
        }
    }

    Err(std::io::Error::new(
        std::io::ErrorKind::NotFound,
        format!("Agent definition not found: {} (searched .orkestra/agents/ and ~/.orkestra/agents/)", agent_type),
    ))
}

/// Result of spawning an agent
#[derive(Debug)]
pub struct SpawnedAgent {
    pub task_id: String,
    pub process_id: u32,
    pub session_id: Option<String>,
}

/// Get path to Claude's session file
pub fn get_claude_session_path(session_id: &str) -> Option<PathBuf> {
    let home = dirs::home_dir()?;
    let cwd = project::find_project_root().ok()?;

    // Encode cwd: /Users/foo/bar -> -Users-foo-bar
    let encoded_cwd = cwd.to_string_lossy().replace('/', "-");

    Some(home
        .join(".claude/projects")
        .join(&encoded_cwd)
        .join(format!("{}.jsonl", session_id)))
}

/// Recover logs from Claude's session file
pub fn recover_session_logs(session_id: &str) -> std::io::Result<Vec<LogEntry>> {
    let path = get_claude_session_path(session_id)
        .ok_or_else(|| std::io::Error::new(
            std::io::ErrorKind::NotFound,
            "Could not determine session path"
        ))?;

    if !path.exists() {
        return Err(std::io::Error::new(
            std::io::ErrorKind::NotFound,
            format!("Session file not found: {}", path.display())
        ));
    }

    let file = fs::File::open(&path)?;
    let reader = std::io::BufReader::new(file);
    let mut entries = Vec::new();

    // Track tool_use IDs to their tool names for correlating with results
    let mut tool_use_map: std::collections::HashMap<String, String> = std::collections::HashMap::new();
    // Track which tool_use IDs are Task tools (subagent parents)
    let mut task_tool_ids: std::collections::HashSet<String> = std::collections::HashSet::new();

    for line in reader.lines() {
        let line = line?;
        if line.trim().is_empty() {
            continue;
        }

        let v: serde_json::Value = match serde_json::from_str(&line) {
            Ok(v) => v,
            Err(_) => continue,
        };

        let msg_type = v.get("type").and_then(|t| t.as_str()).unwrap_or("");

        // Check if this event is part of a subagent (has parent_tool_use_id pointing to a Task)
        let parent_tool_use_id = v.get("parent_tool_use_id")
            .and_then(|p| p.as_str())
            .map(|s| s.to_string());
        let is_subagent_event = parent_tool_use_id.as_ref()
            .map(|id| task_tool_ids.contains(id))
            .unwrap_or(false);

        // Parse assistant messages from Claude's session format
        if msg_type == "assistant" {
            if let Some(content) = v.get("message")
                .and_then(|m| m.get("content"))
                .and_then(|c| c.as_array())
            {
                for item in content {
                    if let Some(item_type) = item.get("type").and_then(|t| t.as_str()) {
                        match item_type {
                            "text" => {
                                // Skip text from subagent events (we show tool uses instead)
                                if !is_subagent_event {
                                    if let Some(text) = item.get("text").and_then(|t| t.as_str()) {
                                        let trimmed = text.trim();
                                        if !trimmed.is_empty() {
                                            entries.push(LogEntry::Text {
                                                content: trimmed.to_string()
                                            });
                                        }
                                    }
                                }
                            }
                            "tool_use" => {
                                let tool_name = item.get("name")
                                    .and_then(|n| n.as_str())
                                    .unwrap_or("unknown")
                                    .to_string();
                                let tool_id = item.get("id")
                                    .and_then(|i| i.as_str())
                                    .unwrap_or("")
                                    .to_string();
                                let input = item.get("input")
                                    .cloned()
                                    .unwrap_or(serde_json::Value::Object(serde_json::Map::new()));

                                // Track tool_use ID -> tool name mapping
                                tool_use_map.insert(tool_id.clone(), tool_name.clone());

                                // Track Task tool IDs for identifying subagent events
                                if tool_name == "Task" {
                                    task_tool_ids.insert(tool_id.clone());
                                }

                                let tool_input = parse_tool_input(&tool_name, &input);

                                if is_subagent_event {
                                    // This is a subagent's tool use
                                    entries.push(LogEntry::SubagentToolUse {
                                        tool: tool_name,
                                        id: tool_id,
                                        input: tool_input,
                                        parent_task_id: parent_tool_use_id.clone().unwrap_or_default(),
                                    });
                                } else {
                                    entries.push(LogEntry::ToolUse {
                                        tool: tool_name,
                                        id: tool_id,
                                        input: tool_input,
                                    });
                                }
                            }
                            _ => {}
                        }
                    }
                }
            }
        }
        // Parse user messages for tool results
        else if msg_type == "user" {
            if let Some(content) = v.get("message")
                .and_then(|m| m.get("content"))
                .and_then(|c| c.as_array())
            {
                for item in content {
                    if item.get("type").and_then(|t| t.as_str()) == Some("tool_result") {
                        let tool_use_id = item.get("tool_use_id")
                            .and_then(|i| i.as_str())
                            .unwrap_or("")
                            .to_string();

                        // Look up the tool name from our map
                        let tool_name = tool_use_map.get(&tool_use_id)
                            .cloned()
                            .unwrap_or_else(|| "unknown".to_string());

                        // Check if this result is from a subagent's tool use
                        let is_subagent_result = is_subagent_event;

                        if is_subagent_result {
                            // Subagent tool result - show it inline
                            let content_str = extract_tool_result_content(item);
                            if !content_str.trim().is_empty() {
                                entries.push(LogEntry::SubagentToolResult {
                                    tool: tool_name,
                                    tool_use_id,
                                    content: content_str,
                                    parent_task_id: parent_tool_use_id.clone().unwrap_or_default(),
                                });
                            }
                        } else if tool_name == "Task" {
                            // Final Task result (subagent summary)
                            let content_str = extract_tool_result_content(item);
                            if !content_str.trim().is_empty() {
                                entries.push(LogEntry::ToolResult {
                                    tool: tool_name,
                                    tool_use_id,
                                    content: content_str,
                                });
                            }
                        }
                    }
                }
            }
        }
    }

    Ok(entries)
}

/// Extract text content from a tool_result item
fn extract_tool_result_content(item: &serde_json::Value) -> String {
    let result_content = item.get("content");
    match result_content {
        Some(serde_json::Value::String(s)) => s.clone(),
        Some(serde_json::Value::Array(arr)) => {
            // Content might be an array of text blocks
            arr.iter()
                .filter_map(|item| {
                    if item.get("type").and_then(|t| t.as_str()) == Some("text") {
                        item.get("text").and_then(|t| t.as_str()).map(|s| s.to_string())
                    } else {
                        None
                    }
                })
                .collect::<Vec<_>>()
                .join("\n")
        }
        _ => String::new(),
    }
}

/// Parses a tool input JSON into a structured ToolInput
fn parse_tool_input(tool_name: &str, input: &serde_json::Value) -> ToolInput {
    match tool_name {
        "Bash" => {
            let command = input.get("command")
                .and_then(|c| c.as_str())
                .unwrap_or("")
                .to_string();
            ToolInput::Bash { command }
        }
        "Read" => {
            let file_path = input.get("file_path")
                .and_then(|p| p.as_str())
                .unwrap_or("")
                .to_string();
            ToolInput::Read { file_path }
        }
        "Write" => {
            let file_path = input.get("file_path")
                .and_then(|p| p.as_str())
                .unwrap_or("")
                .to_string();
            ToolInput::Write { file_path }
        }
        "Edit" => {
            let file_path = input.get("file_path")
                .and_then(|p| p.as_str())
                .unwrap_or("")
                .to_string();
            ToolInput::Edit { file_path }
        }
        "Glob" => {
            let pattern = input.get("pattern")
                .and_then(|p| p.as_str())
                .unwrap_or("")
                .to_string();
            ToolInput::Glob { pattern }
        }
        "Grep" => {
            let pattern = input.get("pattern")
                .and_then(|p| p.as_str())
                .unwrap_or("")
                .to_string();
            ToolInput::Grep { pattern }
        }
        "Task" => {
            let description = input.get("description")
                .and_then(|d| d.as_str())
                .unwrap_or("")
                .to_string();
            ToolInput::Task { description }
        }
        _ => {
            // For other tools, create a compact summary
            let summary = serde_json::to_string(input)
                .map(|s| if s.len() > 100 { format!("{}...", &s[..100]) } else { s })
                .unwrap_or_else(|_| "{}".to_string());
            ToolInput::Other { summary }
        }
    }
}

/// Result from parsing a stream event
struct ParsedEvent {
    session_id: Option<String>,
    /// True if this event indicates new content was written to the session file
    has_new_content: bool,
}

/// Parses a streaming JSON event to extract useful information
/// Only fires update events when meaningful content is produced
fn parse_stream_event(json_line: &str) -> ParsedEvent {
    let v: serde_json::Value = match serde_json::from_str(json_line) {
        Ok(v) => v,
        Err(_) => return ParsedEvent { session_id: None, has_new_content: false },
    };

    let event_type = v.get("type").and_then(|t| t.as_str()).unwrap_or("");

    // Check for system init events which contain session_id
    if event_type == "system" {
        if v.get("subtype").and_then(|s| s.as_str()) == Some("init") {
            let session_id = v.get("session_id")
                .and_then(|s| s.as_str())
                .map(|s| s.to_string());
            return ParsedEvent { session_id, has_new_content: true };
        }
    }

    // Check for assistant message events (these are written to session file)
    // The "assistant" type with a "message" field indicates a complete message
    if event_type == "assistant" {
        // Check if it has actual content (not just status)
        if v.get("message").is_some() {
            return ParsedEvent { session_id: None, has_new_content: true };
        }
    }

    // Check for result events (tool results, which update the session)
    if event_type == "result" {
        return ParsedEvent { session_id: None, has_new_content: true };
    }

    ParsedEvent { session_id: None, has_new_content: false }
}

/// Spawns a Claude Code agent to work on a task
/// The `on_update` callback is called whenever there's new output (for real-time UI updates)
pub fn spawn_agent<F>(task: &Task, agent_type: AgentType, on_update: F) -> std::io::Result<SpawnedAgent>
where
    F: Fn(&str) + Send + 'static,
{
    // Load the appropriate agent definition
    let agent_name = match agent_type {
        AgentType::Planner => "planner",
        AgentType::Breakdown => "breakdown",
        AgentType::Worker => "worker",
    };
    let agent_def = load_agent_definition(agent_name)?;

    // Build the appropriate prompt
    let prompt = match agent_type {
        AgentType::Planner => build_planner_prompt(task, &agent_def),
        AgentType::Breakdown => build_breakdown_prompt(task, &agent_def),
        AgentType::Worker => {
            // Load subtasks (checklist items) for the worker
            let subtasks = get_subtasks(&task.id).ok();
            build_worker_prompt(task, &agent_def, subtasks.as_deref())
        }
    };

    // Update task status based on agent type
    let new_status = match agent_type {
        AgentType::Planner => TaskStatus::Planning,
        AgentType::Breakdown => TaskStatus::BreakingDown,
        AgentType::Worker => TaskStatus::Working,
    };
    update_task_status(&task.id, new_status)?;

    // Find the CLI path and add its directory to PATH for the subprocess
    let cli_path = find_cli_path();
    let mut path_env = std::env::var("PATH").unwrap_or_default();
    if let Some(ref cli) = cli_path {
        if let Some(parent) = cli.parent() {
            path_env = format!("{}:{}", parent.display(), path_env);
        }
    }

    // Get the project root to run Claude in the right directory
    let project_root = project::find_project_root()?;

    let task_id = task.id.clone();

    // Spawn claude with streaming JSON output for detailed tool usage logging
    use std::io::Write as IoWrite;
    let mut child = Command::new("claude")
        .args([
            "--print",
            "--verbose",
            "--output-format", "stream-json",
            "--dangerously-skip-permissions",
        ])
        .env("PATH", path_env)
        .current_dir(&project_root)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()?;

    // Write the prompt to stdin
    if let Some(mut stdin) = child.stdin.take() {
        stdin.write_all(prompt.as_bytes())?;
        // stdin is dropped here, closing the pipe
    }

    let pid = child.id();

    // Take stdout and stderr for processing
    let stdout = child.stdout.take();
    let stderr = child.stderr.take();

    // Determine the session type based on agent type and task state
    let session_type = match agent_type {
        AgentType::Planner => "plan".to_string(),
        AgentType::Breakdown => {
            // Check if this is a breakdown revision cycle (has breakdown_feedback)
            if task.breakdown_feedback.is_some() {
                get_next_breakdown_session_key(task)
            } else {
                "breakdown".to_string()
            }
        }
        AgentType::Worker => {
            // Check if this is a review cycle (has review_feedback)
            if task.review_feedback.is_some() {
                get_next_review_session_key(task)
            } else {
                "work".to_string()
            }
        }
    };

    // Clone task_id for the callback
    let task_id_for_callback = task_id.clone();

    // Spawn a thread to capture session_id and wait for process completion
    // Logs are not stored - they're read on-demand from Claude's session files
    std::thread::spawn(move || {
        // Spawn a thread to read stderr in parallel
        let stderr_handle = stderr.map(|stderr| {
            std::thread::spawn(move || {
                let reader = std::io::BufReader::new(stderr);
                let mut stderr_lines = Vec::new();
                for line in reader.lines() {
                    if let Ok(line) = line {
                        stderr_lines.push(line);
                    }
                }
                stderr_lines
            })
        });

        if let Some(stdout) = stdout {
            let reader = std::io::BufReader::new(stdout);

            for line in reader.lines() {
                if let Ok(json_line) = line {
                    if json_line.trim().is_empty() {
                        continue;
                    }

                    // Parse the streaming JSON event
                    let parsed = parse_stream_event(&json_line);

                    // Capture session_id if present (typically first event)
                    if let Some(sid) = parsed.session_id {
                        let _ = add_task_session(&task_id, &session_type, &sid, Some(pid));
                    }

                    // Only notify UI when there's meaningful new content
                    if parsed.has_new_content {
                        on_update(&task_id_for_callback);
                    }
                }
            }
        }

        // Collect stderr output for logging
        if let Some(handle) = stderr_handle {
            if let Ok(stderr_lines) = handle.join() {
                if !stderr_lines.is_empty() {
                    eprintln!("Agent {} stderr: {}", task_id, stderr_lines.join("\n"));
                }
            }
        }

        // Wait for the process to complete
        match child.wait() {
            Ok(status) => {
                eprintln!("Agent {} finished with exit code: {:?}", task_id, status.code());
                // Final notification on completion
                on_update(&task_id_for_callback);
            }
            Err(e) => {
                eprintln!("Agent {} error: {}", task_id, e);
                on_update(&task_id_for_callback);
            }
        }
    });

    Ok(SpawnedAgent {
        task_id: task.id.clone(),
        process_id: pid,
        session_id: None,
    })
}

/// Spawns a Claude Code agent and waits for session initialization before returning.
/// This is useful for CLI contexts where we need to ensure the session_id is captured
/// before the calling process exits.
///
/// Returns the SpawnedAgent with session_id populated.
/// The agent continues running in the background after this returns.
pub fn spawn_agent_sync(task: &Task, agent_type: AgentType, timeout_secs: u64) -> std::io::Result<SpawnedAgent> {
    // Load the appropriate agent definition
    let agent_name = match agent_type {
        AgentType::Planner => "planner",
        AgentType::Breakdown => "breakdown",
        AgentType::Worker => "worker",
    };
    let agent_def = load_agent_definition(agent_name)?;

    // Build the appropriate prompt
    let prompt = match agent_type {
        AgentType::Planner => build_planner_prompt(task, &agent_def),
        AgentType::Breakdown => build_breakdown_prompt(task, &agent_def),
        AgentType::Worker => {
            // Load subtasks (checklist items) for the worker
            let subtasks = get_subtasks(&task.id).ok();
            build_worker_prompt(task, &agent_def, subtasks.as_deref())
        }
    };

    // Update task status based on agent type
    let new_status = match agent_type {
        AgentType::Planner => TaskStatus::Planning,
        AgentType::Breakdown => TaskStatus::BreakingDown,
        AgentType::Worker => TaskStatus::Working,
    };
    update_task_status(&task.id, new_status)?;

    // Find the CLI path and add its directory to PATH for the subprocess
    let cli_path = find_cli_path();
    let mut path_env = std::env::var("PATH").unwrap_or_default();
    if let Some(ref cli) = cli_path {
        if let Some(parent) = cli.parent() {
            path_env = format!("{}:{}", parent.display(), path_env);
        }
    }

    // Get the project root to run Claude in the right directory
    let project_root = project::find_project_root()?;

    let task_id = task.id.clone();

    // Spawn claude with streaming JSON output
    use std::io::Write as IoWrite;
    let mut child = Command::new("claude")
        .args([
            "--print",
            "--verbose",
            "--output-format", "stream-json",
            "--dangerously-skip-permissions",
        ])
        .env("PATH", path_env)
        .current_dir(&project_root)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()?;

    // Write the prompt to stdin
    if let Some(mut stdin) = child.stdin.take() {
        stdin.write_all(prompt.as_bytes())?;
    }

    let pid = child.id();

    // Take stdout for synchronous session_id capture
    let stdout = child.stdout.take();
    let stderr = child.stderr.take();

    // Determine the session type based on agent type and task state
    let session_type = match agent_type {
        AgentType::Planner => "plan".to_string(),
        AgentType::Breakdown => {
            if task.breakdown_feedback.is_some() {
                get_next_breakdown_session_key(task)
            } else {
                "breakdown".to_string()
            }
        }
        AgentType::Worker => {
            if task.review_feedback.is_some() {
                get_next_review_session_key(task)
            } else {
                "work".to_string()
            }
        }
    };

    // Read stdout synchronously until we get the session_id or timeout
    let mut captured_session_id: Option<String> = None;
    let mut buffered_lines: Vec<String> = Vec::new();

    if let Some(stdout) = stdout {
        let reader = std::io::BufReader::new(stdout);
        let start_time = std::time::Instant::now();
        let timeout = std::time::Duration::from_secs(timeout_secs);

        // We'll read lines until we get session_id or timeout
        // Use a separate thread with a channel so we can timeout
        let (tx, rx) = std::sync::mpsc::channel();

        std::thread::spawn(move || {
            for line in reader.lines() {
                if tx.send(line).is_err() {
                    break;
                }
            }
        });

        loop {
            // Check for timeout
            if start_time.elapsed() > timeout {
                eprintln!("Warning: Timeout waiting for session_id after {} seconds", timeout_secs);
                break;
            }

            // Try to receive a line with a small timeout
            match rx.recv_timeout(std::time::Duration::from_millis(100)) {
                Ok(Ok(json_line)) => {
                    if json_line.trim().is_empty() {
                        continue;
                    }

                    buffered_lines.push(json_line.clone());

                    let parsed = parse_stream_event(&json_line);

                    if let Some(sid) = parsed.session_id {
                        // Store the session immediately with the PID
                        let _ = add_task_session(&task_id, &session_type, &sid, Some(pid));
                        captured_session_id = Some(sid);
                        // We have session_id, now spawn background thread for the rest
                        break;
                    }
                }
                Ok(Err(e)) => {
                    eprintln!("Error reading stdout: {}", e);
                    break;
                }
                Err(std::sync::mpsc::RecvTimeoutError::Timeout) => {
                    // Continue waiting
                    continue;
                }
                Err(std::sync::mpsc::RecvTimeoutError::Disconnected) => {
                    // Stream ended without session_id
                    break;
                }
            }
        }

        // Now spawn a background thread to continue processing the remaining output
        let task_id_clone = task_id.clone();
        std::thread::spawn(move || {
            // Continue reading from the channel until it's done
            for line_result in rx {
                if let Ok(json_line) = line_result {
                    if json_line.trim().is_empty() {
                        continue;
                    }
                    // We don't need to do anything with these lines
                    // The session file captures everything
                }
            }
            eprintln!("Agent {} stdout processing completed", task_id_clone);
        });
    }

    // Spawn a thread to handle stderr and wait for process completion
    let task_id_for_stderr = task_id.clone();
    std::thread::spawn(move || {
        // Read stderr
        if let Some(stderr) = stderr {
            let reader = std::io::BufReader::new(stderr);
            let mut stderr_lines = Vec::new();
            for line in reader.lines() {
                if let Ok(line) = line {
                    stderr_lines.push(line);
                }
            }
            if !stderr_lines.is_empty() {
                eprintln!("Agent {} stderr: {}", task_id_for_stderr, stderr_lines.join("\n"));
            }
        }

        // Wait for the process to complete
        match child.wait() {
            Ok(status) => {
                eprintln!("Agent {} finished with exit code: {:?}", task_id_for_stderr, status.code());
            }
            Err(e) => {
                eprintln!("Agent {} error: {}", task_id_for_stderr, e);
            }
        }
    });

    Ok(SpawnedAgent {
        task_id: task.id.clone(),
        process_id: pid,
        session_id: captured_session_id,
    })
}

/// Resumes an interrupted Claude Code session
/// session_key specifies which session to resume (e.g., "plan", "work", "review_0")
/// The `on_update` callback is called whenever there's new output (for real-time UI updates)
pub fn resume_agent<F>(task: &Task, session_key: &str, continuation_prompt: Option<&str>, on_update: F) -> std::io::Result<SpawnedAgent>
where
    F: Fn(&str) + Send + 'static,
{
    // Get the session_id from the sessions map
    let session_id = task.sessions.as_ref()
        .and_then(|s| s.get(session_key))
        .map(|info| info.session_id.clone())
        .ok_or_else(|| std::io::Error::new(
            std::io::ErrorKind::InvalidInput,
            format!("Task has no session '{}' to resume", session_key)
        ))?;

    // Determine default prompt based on session type
    let default_prompt = if session_key == "plan" {
        "The session was interrupted. Please continue creating the implementation plan where you left off."
    } else {
        "The session was interrupted. Please continue implementing the task where you left off."
    };

    let prompt = continuation_prompt.unwrap_or(default_prompt);

    // Find CLI path for PATH environment
    let cli_path = find_cli_path();
    let mut path_env = std::env::var("PATH").unwrap_or_default();
    if let Some(ref cli) = cli_path {
        if let Some(parent) = cli.parent() {
            path_env = format!("{}:{}", parent.display(), path_env);
        }
    }

    let project_root = project::find_project_root()?;
    let task_id = task.id.clone();

    // Spawn claude with --resume flag
    use std::io::Write as IoWrite;
    let mut child = Command::new("claude")
        .args([
            "--resume", &session_id,
            "--print",
            "--verbose",
            "--output-format", "stream-json",
            "--dangerously-skip-permissions",
        ])
        .env("PATH", path_env)
        .current_dir(&project_root)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()?;

    // Send continuation prompt
    if let Some(mut stdin) = child.stdin.take() {
        stdin.write_all(prompt.as_bytes())?;
    }

    let pid = child.id();

    // Take stdout and stderr for processing
    let stdout = child.stdout.take();
    let stderr = child.stderr.take();

    // Clone task_id for the callback
    let task_id_for_callback = task_id.clone();

    // Spawn a thread to wait for process completion
    // Logs are not stored - they're read on-demand from Claude's session files
    std::thread::spawn(move || {
        // Spawn a thread to read stderr in parallel
        let stderr_handle = stderr.map(|stderr| {
            std::thread::spawn(move || {
                let reader = std::io::BufReader::new(stderr);
                let mut stderr_lines = Vec::new();
                for line in reader.lines() {
                    if let Ok(line) = line {
                        stderr_lines.push(line);
                    }
                }
                stderr_lines
            })
        });

        // Process stdout and notify on meaningful updates
        if let Some(stdout) = stdout {
            let reader = std::io::BufReader::new(stdout);
            for line in reader.lines() {
                if let Ok(json_line) = line {
                    if json_line.trim().is_empty() {
                        continue;
                    }
                    // Parse and only notify on meaningful content
                    let parsed = parse_stream_event(&json_line);
                    if parsed.has_new_content {
                        on_update(&task_id_for_callback);
                    }
                }
            }
        }

        // Collect stderr output for logging
        if let Some(handle) = stderr_handle {
            if let Ok(stderr_lines) = handle.join() {
                if !stderr_lines.is_empty() {
                    eprintln!("Resumed agent {} stderr: {}", task_id, stderr_lines.join("\n"));
                }
            }
        }

        // Wait for the process to complete
        match child.wait() {
            Ok(status) => {
                eprintln!("Resumed agent {} finished with exit code: {:?}", task_id, status.code());
                // Final notification on completion
                on_update(&task_id_for_callback);
            }
            Err(e) => {
                eprintln!("Resumed agent {} error: {}", task_id, e);
                on_update(&task_id_for_callback);
            }
        }
    });

    Ok(SpawnedAgent {
        task_id: task.id.clone(),
        process_id: pid,
        session_id: None,
    })
}

