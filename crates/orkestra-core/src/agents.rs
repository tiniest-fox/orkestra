use std::path::PathBuf;
use std::process::{Command, Stdio};
use std::fs;
use std::io::BufRead;

use crate::project;
use crate::tasks::{Task, TaskStatus, LogEntry, ToolInput, update_task_status, update_task_logs, set_task_agent_pid};

/// Agent types that can be spawned
#[derive(Debug, Clone, Copy, PartialEq)]
pub enum AgentType {
    Planner,
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

Remember: When your plan is ready, you MUST run:
`ork task set-plan {task_id} --plan "YOUR_MARKDOWN_PLAN"`
"#,
        agent_definition = agent_definition,
        task_id = task.id,
        title = task.title,
        description = task.description,
        feedback_section = feedback_section,
    )
}

/// Builds the prompt for a worker agent
fn build_worker_prompt(task: &Task, agent_definition: &str) -> String {
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

    format!(
        r#"{agent_definition}

---

## Your Current Task

**Task ID**: {task_id}
**Title**: {title}

### Description
{description}
{plan_section}{review_feedback_section}
---

Remember: When you are done, you MUST run one of these commands:
- `ork task complete {task_id} --summary "what you did"` - if successful
- `ork task fail {task_id} --reason "why"` - if you cannot complete it
- `ork task block {task_id} --reason "what you need"` - if you need clarification
"#,
        agent_definition = agent_definition,
        task_id = task.id,
        title = task.title,
        description = task.description,
        plan_section = plan_section,
        review_feedback_section = review_feedback_section,
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

/// Parses a streaming JSON event into structured LogEntry items
/// Only processes assistant events (text and tool_use), skips user/system/tool_result events
fn parse_stream_event(json_line: &str) -> Vec<LogEntry> {
    let v: serde_json::Value = match serde_json::from_str(json_line) {
        Ok(v) => v,
        Err(_) => return vec![],
    };

    let event_type = match v.get("type").and_then(|t| t.as_str()) {
        Some(t) => t,
        None => return vec![],
    };

    match event_type {
        "assistant" => {
            // Assistant message with potential tool use
            let message = match v.get("message") {
                Some(m) => m,
                None => return vec![],
            };
            let content = match message.get("content").and_then(|c| c.as_array()) {
                Some(c) => c,
                None => return vec![],
            };

            let mut entries = Vec::new();
            for item in content {
                if let Some(item_type) = item.get("type").and_then(|t| t.as_str()) {
                    match item_type {
                        "text" => {
                            if let Some(text) = item.get("text").and_then(|t| t.as_str()) {
                                let trimmed = text.trim();
                                if !trimmed.is_empty() {
                                    entries.push(LogEntry::Text {
                                        content: trimmed.to_string()
                                    });
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

                            let tool_input = parse_tool_input(&tool_name, &input);
                            entries.push(LogEntry::ToolUse {
                                tool: tool_name,
                                id: tool_id,
                                input: tool_input
                            });
                        }
                        _ => {}
                    }
                }
            }
            entries
        }
        "error" => {
            let error = v.get("error")
                .and_then(|e| e.as_str())
                .unwrap_or("Unknown error")
                .to_string();
            vec![LogEntry::Error { message: error }]
        }
        // Skip "user", "system", and "result" (tool_result) events
        _ => vec![],
    }
}

/// Spawns a Claude Code agent to work on a task
pub fn spawn_agent(task: &Task, agent_type: AgentType) -> std::io::Result<SpawnedAgent> {
    // Load the appropriate agent definition
    let agent_name = match agent_type {
        AgentType::Planner => "planner",
        AgentType::Worker => "worker",
    };
    let agent_def = load_agent_definition(agent_name)?;

    // Build the appropriate prompt
    let prompt = match agent_type {
        AgentType::Planner => build_planner_prompt(task, &agent_def),
        AgentType::Worker => build_worker_prompt(task, &agent_def),
    };

    // Update task status based on agent type
    let new_status = match agent_type {
        AgentType::Planner => TaskStatus::Planning,
        AgentType::Worker => TaskStatus::InProgress,
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

    // Store the PID in the task
    let _ = set_task_agent_pid(&task_id, pid);

    // Take stdout and stderr for processing
    let stdout = child.stdout.take();
    let stderr = child.stderr.take();

    // Spawn a thread to capture and process streaming JSON output
    std::thread::spawn(move || {
        let mut log_entries: Vec<LogEntry> = Vec::new();

        // Spawn a thread to read stderr in parallel (we'll capture errors if any)
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
                match line {
                    Ok(json_line) => {
                        if json_line.trim().is_empty() {
                            continue;
                        }

                        // Parse the streaming JSON event into structured entries
                        let entries = parse_stream_event(&json_line);
                        if !entries.is_empty() {
                            log_entries.extend(entries);

                            // Update logs incrementally so they can be viewed in real-time
                            let _ = update_task_logs(&task_id, log_entries.clone());
                        }
                    }
                    Err(e) => {
                        log_entries.push(LogEntry::Error {
                            message: format!("IO error: {}", e)
                        });
                    }
                }
            }
        }

        // Collect stderr output and add as error if non-empty
        if let Some(handle) = stderr_handle {
            if let Ok(stderr_lines) = handle.join() {
                if !stderr_lines.is_empty() {
                    log_entries.push(LogEntry::Error {
                        message: format!("stderr: {}", stderr_lines.join("\n"))
                    });
                }
            }
        }

        // Wait for the process to complete
        match child.wait() {
            Ok(status) => {
                log_entries.push(LogEntry::ProcessExit { code: status.code() });
                let _ = update_task_logs(&task_id, log_entries);
                eprintln!("Agent {} finished with exit code: {:?}", task_id, status.code());
            }
            Err(e) => {
                log_entries.push(LogEntry::Error {
                    message: format!("Process error: {}", e)
                });
                let _ = update_task_logs(&task_id, log_entries);
                eprintln!("Agent {} error: {}", task_id, e);
            }
        }
    });

    Ok(SpawnedAgent {
        task_id: task.id.clone(),
        process_id: pid,
    })
}
