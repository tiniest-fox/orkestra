use serde::{Deserialize, Serialize};
use std::fs::{self, OpenOptions};
use std::io::{BufRead, BufReader, Write};
use std::path::PathBuf;

use crate::project;

/// Session information for tracking agent sessions
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SessionInfo {
    pub session_id: String,
    pub started_at: String,
}

/// Structured log entry for task execution (loaded from Claude's session files)
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum LogEntry {
    Text { content: String },
    ToolUse { tool: String, id: String, input: ToolInput },
    /// Tool result, especially useful for Task subagent output
    ToolResult { tool: String, tool_use_id: String, content: String },
    /// Subagent activity (tool use within a Task subagent)
    SubagentToolUse { tool: String, id: String, input: ToolInput, parent_task_id: String },
    /// Subagent tool result
    SubagentToolResult { tool: String, tool_use_id: String, content: String, parent_task_id: String },
    ProcessExit { code: Option<i32> },
    Error { message: String },
}

/// Tool input details for structured logging
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "tool", rename_all = "snake_case")]
pub enum ToolInput {
    Bash { command: String },
    Read { file_path: String },
    Write { file_path: String },
    Edit { file_path: String },
    Glob { pattern: String },
    Grep { pattern: String },
    Task { description: String },
    Other { summary: String },
}

/// Task status representing the current state in the workflow.
///
/// The workflow is simplified to 3 main phases:
/// - Planning: Agent is creating a plan, or plan is ready for review
/// - Working: Agent is implementing, or work is ready for review
/// - Done: Task completed
///
/// "Needs review" is detected by checking data fields:
/// - Planning + plan.is_some() → needs plan approval
/// - Working + summary.is_some() → needs work review
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "snake_case")]
pub enum TaskStatus {
    Planning,
    Working,
    Done,
    Failed,
    Blocked,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Task {
    pub id: String,
    pub title: String,
    pub description: String,
    pub status: TaskStatus,
    pub created_at: String,
    pub updated_at: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub completed_at: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub summary: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub agent_pid: Option<u32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub plan: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub plan_feedback: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub review_feedback: Option<String>,
    // Multi-session tracking - logs are loaded on-demand from Claude's session files
    // Keys are session types: "plan", "work", "review_0", "review_1", etc.
    // Ordered by insertion (creation time)
    #[serde(skip_serializing_if = "Option::is_none")]
    pub sessions: Option<indexmap::IndexMap<String, SessionInfo>>,
    // Auto-approve mode - when enabled, plans are automatically approved without manual review
    #[serde(default)]
    pub auto_approve: bool,
}

fn get_tasks_file() -> PathBuf {
    project::get_orkestra_dir().join("tasks.jsonl")
}

/// Check if a process with the given PID is still running
fn is_process_running(pid: u32) -> bool {
    // On Unix, we can use kill with signal 0 to check if process exists
    #[cfg(unix)]
    {
        // kill(pid, 0) returns 0 if process exists, -1 otherwise
        unsafe { libc::kill(pid as i32, 0) == 0 }
    }
    #[cfg(not(unix))]
    {
        // On non-Unix, assume process is not running to be safe
        let _ = pid;
        false
    }
}

pub fn load_tasks() -> std::io::Result<Vec<Task>> {
    let path = get_tasks_file();
    if !path.exists() {
        return Ok(vec![]);
    }

    let file = fs::File::open(&path)?;
    let reader = BufReader::new(file);
    let mut task_map: std::collections::HashMap<String, Task> = std::collections::HashMap::new();

    // JSONL is append-only, so later entries override earlier ones
    for line in reader.lines() {
        let line = line?;
        if line.trim().is_empty() {
            continue;
        }
        if let Ok(task) = serde_json::from_str::<Task>(&line) {
            task_map.insert(task.id.clone(), task);
        }
    }

    let mut tasks: Vec<Task> = task_map.into_values().collect();
    tasks.sort_by(|a, b| a.created_at.cmp(&b.created_at));

    // Check for stale PIDs and clear them
    let mut needs_save = false;
    for task in &mut tasks {
        if let Some(pid) = task.agent_pid {
            if !is_process_running(pid) {
                task.agent_pid = None;
                needs_save = true;
            }
        }
    }

    // Save if we cleared any stale PIDs
    if needs_save {
        let _ = save_tasks(&tasks);
    }

    Ok(tasks)
}

pub fn save_tasks(tasks: &[Task]) -> std::io::Result<()> {
    project::ensure_orkestra_dir()?;
    let path = get_tasks_file();
    let mut file = OpenOptions::new()
        .create(true)
        .write(true)
        .truncate(true)
        .open(&path)?;

    for task in tasks {
        let json = serde_json::to_string(task)?;
        writeln!(file, "{}", json)?;
    }
    Ok(())
}

fn generate_task_id() -> String {
    let tasks = load_tasks().unwrap_or_default();
    let max_num = tasks
        .iter()
        .filter_map(|t| t.id.strip_prefix("TASK-").and_then(|n| n.parse::<u32>().ok()))
        .max()
        .unwrap_or(0);
    format!("TASK-{:03}", max_num + 1)
}

pub fn create_task(title: &str, description: &str) -> std::io::Result<Task> {
    create_task_with_options(title, description, false)
}

pub fn create_task_with_options(title: &str, description: &str, auto_approve: bool) -> std::io::Result<Task> {
    let now = chrono::Utc::now().to_rfc3339();
    let task = Task {
        id: generate_task_id(),
        title: title.to_string(),
        description: description.to_string(),
        status: TaskStatus::Planning,
        created_at: now.clone(),
        updated_at: now,
        completed_at: None,
        summary: None,
        error: None,
        agent_pid: None,
        plan: None,
        plan_feedback: None,
        review_feedback: None,
        sessions: None,
        auto_approve,
    };

    let mut tasks = load_tasks()?;
    tasks.push(task.clone());
    save_tasks(&tasks)?;
    Ok(task)
}

pub fn update_task_status(id: &str, status: TaskStatus) -> std::io::Result<Task> {
    let mut tasks = load_tasks()?;
    let task = tasks
        .iter_mut()
        .find(|t| t.id == id)
        .ok_or_else(|| std::io::Error::new(std::io::ErrorKind::NotFound, "Task not found"))?;

    task.status = status.clone();
    task.updated_at = chrono::Utc::now().to_rfc3339();

    if status == TaskStatus::Done {
        task.completed_at = Some(task.updated_at.clone());
    }

    let result = task.clone();
    save_tasks(&tasks)?;
    Ok(result)
}

/// Mark task as complete - stays in Working status with summary set.
/// The presence of summary indicates work is ready for review.
pub fn complete_task(id: &str, summary: &str) -> std::io::Result<Task> {
    let mut tasks = load_tasks()?;
    let task = tasks
        .iter_mut()
        .find(|t| t.id == id)
        .ok_or_else(|| std::io::Error::new(std::io::ErrorKind::NotFound, "Task not found"))?;

    // Stay in Working status - summary indicates ready for review
    task.summary = Some(summary.to_string());
    task.updated_at = chrono::Utc::now().to_rfc3339();

    let result = task.clone();
    save_tasks(&tasks)?;
    Ok(result)
}

pub fn fail_task(id: &str, reason: &str) -> std::io::Result<Task> {
    let mut tasks = load_tasks()?;
    let task = tasks
        .iter_mut()
        .find(|t| t.id == id)
        .ok_or_else(|| std::io::Error::new(std::io::ErrorKind::NotFound, "Task not found"))?;

    task.status = TaskStatus::Failed;
    task.updated_at = chrono::Utc::now().to_rfc3339();
    task.error = Some(reason.to_string());

    let result = task.clone();
    save_tasks(&tasks)?;
    Ok(result)
}

pub fn block_task(id: &str, reason: &str) -> std::io::Result<Task> {
    let mut tasks = load_tasks()?;
    let task = tasks
        .iter_mut()
        .find(|t| t.id == id)
        .ok_or_else(|| std::io::Error::new(std::io::ErrorKind::NotFound, "Task not found"))?;

    task.status = TaskStatus::Blocked;
    task.updated_at = chrono::Utc::now().to_rfc3339();
    task.error = Some(reason.to_string());

    let result = task.clone();
    save_tasks(&tasks)?;
    Ok(result)
}

pub fn set_task_agent_pid(id: &str, pid: u32) -> std::io::Result<Task> {
    let mut tasks = load_tasks()?;
    let task = tasks
        .iter_mut()
        .find(|t| t.id == id)
        .ok_or_else(|| std::io::Error::new(std::io::ErrorKind::NotFound, "Task not found"))?;

    task.agent_pid = Some(pid);
    task.updated_at = chrono::Utc::now().to_rfc3339();

    let result = task.clone();
    save_tasks(&tasks)?;
    Ok(result)
}

/// Add a session to a task. Session types: "plan", "work", "review_0", "review_1", etc.
pub fn add_task_session(id: &str, session_type: &str, session_id: &str) -> std::io::Result<Task> {
    let mut tasks = load_tasks()?;
    let task = tasks
        .iter_mut()
        .find(|t| t.id == id)
        .ok_or_else(|| std::io::Error::new(std::io::ErrorKind::NotFound, "Task not found"))?;

    let session = SessionInfo {
        session_id: session_id.to_string(),
        started_at: chrono::Utc::now().to_rfc3339(),
    };

    match &mut task.sessions {
        Some(sessions) => {
            sessions.insert(session_type.to_string(), session);
        }
        None => {
            let mut sessions = indexmap::IndexMap::new();
            sessions.insert(session_type.to_string(), session);
            task.sessions = Some(sessions);
        }
    }
    task.updated_at = chrono::Utc::now().to_rfc3339();

    let result = task.clone();
    save_tasks(&tasks)?;
    Ok(result)
}

/// Get the next review session key (review_0, review_1, etc.)
pub fn get_next_review_session_key(task: &Task) -> String {
    let count = task.sessions
        .as_ref()
        .map(|s| s.keys().filter(|k| k.starts_with("review_")).count())
        .unwrap_or(0);
    format!("review_{}", count)
}

/// Set the plan for a task. Stays in Planning status - plan field indicates ready for review.
pub fn set_task_plan(id: &str, plan: &str) -> std::io::Result<Task> {
    let mut tasks = load_tasks()?;
    let task = tasks
        .iter_mut()
        .find(|t| t.id == id)
        .ok_or_else(|| std::io::Error::new(std::io::ErrorKind::NotFound, "Task not found"))?;

    task.plan = Some(plan.to_string());
    // Stay in Planning status - plan field indicates ready for review
    task.updated_at = chrono::Utc::now().to_rfc3339();

    let result = task.clone();
    save_tasks(&tasks)?;
    Ok(result)
}

/// Approve a task's plan and transition to Working status.
/// Requires: Planning status + plan is set.
pub fn approve_task_plan(id: &str) -> std::io::Result<Task> {
    let mut tasks = load_tasks()?;
    let task = tasks
        .iter_mut()
        .find(|t| t.id == id)
        .ok_or_else(|| std::io::Error::new(std::io::ErrorKind::NotFound, "Task not found"))?;

    // Must be in Planning with a plan set
    if task.status != TaskStatus::Planning || task.plan.is_none() {
        return Err(std::io::Error::new(
            std::io::ErrorKind::InvalidInput,
            "Task must be in Planning status with a plan set",
        ));
    }

    task.status = TaskStatus::Working;
    task.plan_feedback = None;
    task.updated_at = chrono::Utc::now().to_rfc3339();

    let result = task.clone();
    save_tasks(&tasks)?;
    Ok(result)
}

/// Request changes to a task's plan. Requires: Planning status + plan is set.
/// Clears the plan and stores feedback for the agent.
pub fn request_plan_changes(id: &str, feedback: &str) -> std::io::Result<Task> {
    let mut tasks = load_tasks()?;
    let task = tasks
        .iter_mut()
        .find(|t| t.id == id)
        .ok_or_else(|| std::io::Error::new(std::io::ErrorKind::NotFound, "Task not found"))?;

    // Must be in Planning with a plan set
    if task.status != TaskStatus::Planning || task.plan.is_none() {
        return Err(std::io::Error::new(
            std::io::ErrorKind::InvalidInput,
            "Task must be in Planning status with a plan set",
        ));
    }

    // Clear the plan and set feedback - stays in Planning
    task.plan = None;
    task.plan_feedback = Some(feedback.to_string());
    task.updated_at = chrono::Utc::now().to_rfc3339();

    let result = task.clone();
    save_tasks(&tasks)?;
    Ok(result)
}

/// Request changes during work review. Requires: Working status + summary is set.
/// Clears the summary and stores feedback for the agent.
pub fn request_review_changes(id: &str, feedback: &str) -> std::io::Result<Task> {
    let mut tasks = load_tasks()?;
    let task = tasks
        .iter_mut()
        .find(|t| t.id == id)
        .ok_or_else(|| std::io::Error::new(std::io::ErrorKind::NotFound, "Task not found"))?;

    // Must be in Working with a summary set
    if task.status != TaskStatus::Working || task.summary.is_none() {
        return Err(std::io::Error::new(
            std::io::ErrorKind::InvalidInput,
            "Task must be in Working status with a summary set",
        ));
    }

    // Clear the summary and set feedback - stays in Working
    task.summary = None;
    task.review_feedback = Some(feedback.to_string());
    task.updated_at = chrono::Utc::now().to_rfc3339();

    let result = task.clone();
    save_tasks(&tasks)?;
    Ok(result)
}

/// Approve work review and transition to Done. Requires: Working status + summary is set.
pub fn approve_review(id: &str) -> std::io::Result<Task> {
    let mut tasks = load_tasks()?;
    let task = tasks
        .iter_mut()
        .find(|t| t.id == id)
        .ok_or_else(|| std::io::Error::new(std::io::ErrorKind::NotFound, "Task not found"))?;

    // Must be in Working with a summary set
    if task.status != TaskStatus::Working || task.summary.is_none() {
        return Err(std::io::Error::new(
            std::io::ErrorKind::InvalidInput,
            "Task must be in Working status with a summary set",
        ));
    }

    task.status = TaskStatus::Done;
    task.completed_at = Some(chrono::Utc::now().to_rfc3339());
    task.review_feedback = None;
    task.updated_at = chrono::Utc::now().to_rfc3339();

    let result = task.clone();
    save_tasks(&tasks)?;
    Ok(result)
}

pub fn set_auto_approve(id: &str, enabled: bool) -> std::io::Result<Task> {
    let mut tasks = load_tasks()?;
    let task = tasks
        .iter_mut()
        .find(|t| t.id == id)
        .ok_or_else(|| std::io::Error::new(std::io::ErrorKind::NotFound, "Task not found"))?;

    task.auto_approve = enabled;
    task.updated_at = chrono::Utc::now().to_rfc3339();

    let result = task.clone();
    save_tasks(&tasks)?;
    Ok(result)
}
