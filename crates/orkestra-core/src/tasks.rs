use serde::{Deserialize, Serialize};
use std::fs::{self, OpenOptions};
use std::io::{BufRead, BufReader, Write};
use std::path::PathBuf;

use crate::project;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "snake_case")]
pub enum TaskStatus {
    Pending,
    InProgress,
    ReadyForReview,
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
    pub logs: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub agent_pid: Option<u32>,
}

fn get_tasks_file() -> PathBuf {
    project::get_orkestra_dir().join("tasks.jsonl")
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
    Ok(tasks)
}

fn save_tasks(tasks: &[Task]) -> std::io::Result<()> {
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
    let now = chrono::Utc::now().to_rfc3339();
    let task = Task {
        id: generate_task_id(),
        title: title.to_string(),
        description: description.to_string(),
        status: TaskStatus::Pending,
        created_at: now.clone(),
        updated_at: now,
        completed_at: None,
        summary: None,
        error: None,
        logs: None,
        agent_pid: None,
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

pub fn complete_task(id: &str, summary: &str) -> std::io::Result<Task> {
    let mut tasks = load_tasks()?;
    let task = tasks
        .iter_mut()
        .find(|t| t.id == id)
        .ok_or_else(|| std::io::Error::new(std::io::ErrorKind::NotFound, "Task not found"))?;

    task.status = TaskStatus::ReadyForReview;
    task.updated_at = chrono::Utc::now().to_rfc3339();
    task.summary = Some(summary.to_string());

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

pub fn update_task_logs(id: &str, logs: &str) -> std::io::Result<Task> {
    let mut tasks = load_tasks()?;
    let task = tasks
        .iter_mut()
        .find(|t| t.id == id)
        .ok_or_else(|| std::io::Error::new(std::io::ErrorKind::NotFound, "Task not found"))?;

    task.logs = Some(logs.to_string());
    task.updated_at = chrono::Utc::now().to_rfc3339();

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
