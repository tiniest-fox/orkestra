use std::sync::OnceLock;

use crate::adapters::SqliteStore;
use crate::ports::TaskStore;

// Re-export domain types that were previously defined here
pub use crate::domain::{Task, TaskStatus, TaskKind, SessionInfo, LogEntry, ToolInput};

/// Global SQLite store instance.
/// Using OnceLock for thread-safe lazy initialization.
static STORE: OnceLock<SqliteStore> = OnceLock::new();

/// Get or initialize the global store.
fn get_store() -> &'static SqliteStore {
    STORE.get_or_init(|| {
        SqliteStore::new().expect("Failed to initialize SQLite store")
    })
}

pub fn load_tasks() -> std::io::Result<Vec<Task>> {
    let store = get_store();
    store.load_all().map_err(|e| std::io::Error::new(std::io::ErrorKind::Other, e.to_string()))
}

pub fn save_tasks(tasks: &[Task]) -> std::io::Result<()> {
    let store = get_store();
    store.save_all(tasks).map_err(|e| std::io::Error::new(std::io::ErrorKind::Other, e.to_string()))
}

fn generate_task_id() -> String {
    let store = get_store();
    store.next_id().unwrap_or_else(|_| "TASK-001".to_string())
}

pub fn create_task(title: &str, description: &str) -> std::io::Result<Task> {
    create_task_with_options(title, description, false)
}

pub fn create_task_with_options(title: &str, description: &str, auto_approve: bool) -> std::io::Result<Task> {
    let store = get_store();
    let now = chrono::Utc::now().to_rfc3339();
    let task = Task {
        id: generate_task_id(),
        title: title.to_string(),
        description: description.to_string(),
        status: TaskStatus::Planning,
        kind: TaskKind::Task,
        created_at: now.clone(),
        updated_at: now,
        completed_at: None,
        summary: None,
        error: None,
        plan: None,
        plan_feedback: None,
        review_feedback: None,
        sessions: None,
        auto_approve,
        parent_id: None,
        breakdown: None,
        breakdown_feedback: None,
        skip_breakdown: false,
    };

    store.save(&task).map_err(|e| std::io::Error::new(std::io::ErrorKind::Other, e.to_string()))?;
    Ok(task)
}

pub fn update_task_status(id: &str, status: TaskStatus) -> std::io::Result<Task> {
    let store = get_store();

    // Update status atomically
    store.update_status(id, status.clone())
        .map_err(|e| std::io::Error::new(std::io::ErrorKind::Other, e.to_string()))?;

    // If transitioning to Done, also set completed_at
    if status == TaskStatus::Done {
        store.update_field(id, "completed_at", Some(&chrono::Utc::now().to_rfc3339()))
            .map_err(|e| std::io::Error::new(std::io::ErrorKind::Other, e.to_string()))?;
    }

    // Return updated task
    store.find_by_id(id)
        .map_err(|e| std::io::Error::new(std::io::ErrorKind::Other, e.to_string()))?
        .ok_or_else(|| std::io::Error::new(std::io::ErrorKind::NotFound, "Task not found"))
}

/// Mark task as complete - stays in Working status with summary set.
pub fn complete_task(id: &str, summary: &str) -> std::io::Result<Task> {
    let store = get_store();
    store.update_field(id, "summary", Some(summary))
        .map_err(|e| std::io::Error::new(std::io::ErrorKind::Other, e.to_string()))?;

    store.find_by_id(id)
        .map_err(|e| std::io::Error::new(std::io::ErrorKind::Other, e.to_string()))?
        .ok_or_else(|| std::io::Error::new(std::io::ErrorKind::NotFound, "Task not found"))
}

pub fn fail_task(id: &str, reason: &str) -> std::io::Result<Task> {
    let store = get_store();
    store.update_status(id, TaskStatus::Failed)
        .map_err(|e| std::io::Error::new(std::io::ErrorKind::Other, e.to_string()))?;
    store.update_field(id, "error", Some(reason))
        .map_err(|e| std::io::Error::new(std::io::ErrorKind::Other, e.to_string()))?;

    store.find_by_id(id)
        .map_err(|e| std::io::Error::new(std::io::ErrorKind::Other, e.to_string()))?
        .ok_or_else(|| std::io::Error::new(std::io::ErrorKind::NotFound, "Task not found"))
}

pub fn block_task(id: &str, reason: &str) -> std::io::Result<Task> {
    let store = get_store();
    store.update_status(id, TaskStatus::Blocked)
        .map_err(|e| std::io::Error::new(std::io::ErrorKind::Other, e.to_string()))?;
    store.update_field(id, "error", Some(reason))
        .map_err(|e| std::io::Error::new(std::io::ErrorKind::Other, e.to_string()))?;

    store.find_by_id(id)
        .map_err(|e| std::io::Error::new(std::io::ErrorKind::Other, e.to_string()))?
        .ok_or_else(|| std::io::Error::new(std::io::ErrorKind::NotFound, "Task not found"))
}

/// Add a session to a task atomically with optional agent PID.
/// This is the key fix for the race condition.
pub fn add_task_session(id: &str, session_type: &str, session_id: &str, agent_pid: Option<u32>) -> std::io::Result<Task> {
    let store = get_store();
    store.add_session(id, session_type, session_id, agent_pid)
        .map_err(|e| std::io::Error::new(std::io::ErrorKind::Other, e.to_string()))?;

    store.find_by_id(id)
        .map_err(|e| std::io::Error::new(std::io::ErrorKind::Other, e.to_string()))?
        .ok_or_else(|| std::io::Error::new(std::io::ErrorKind::NotFound, "Task not found"))
}

/// Get the next review session key (review_0, review_1, etc.)
pub fn get_next_review_session_key(task: &Task) -> String {
    task.next_review_session_key()
}

/// Set the plan for a task.
pub fn set_task_plan(id: &str, plan: &str) -> std::io::Result<Task> {
    let store = get_store();
    store.update_field(id, "plan", Some(plan))
        .map_err(|e| std::io::Error::new(std::io::ErrorKind::Other, e.to_string()))?;

    store.find_by_id(id)
        .map_err(|e| std::io::Error::new(std::io::ErrorKind::Other, e.to_string()))?
        .ok_or_else(|| std::io::Error::new(std::io::ErrorKind::NotFound, "Task not found"))
}

/// Approve a task's plan. Transitions to BreakingDown or Working based on skip_breakdown.
pub fn approve_task_plan(id: &str) -> std::io::Result<Task> {
    let store = get_store();
    let task = store.find_by_id(id)
        .map_err(|e| std::io::Error::new(std::io::ErrorKind::Other, e.to_string()))?
        .ok_or_else(|| std::io::Error::new(std::io::ErrorKind::NotFound, "Task not found"))?;

    if task.status != TaskStatus::Planning || task.plan.is_none() {
        return Err(std::io::Error::new(
            std::io::ErrorKind::InvalidInput,
            "Task must be in Planning status with a plan set",
        ));
    }

    let new_status = if task.skip_breakdown {
        TaskStatus::Working
    } else {
        TaskStatus::BreakingDown
    };

    store.update_status(id, new_status)
        .map_err(|e| std::io::Error::new(std::io::ErrorKind::Other, e.to_string()))?;
    store.update_field(id, "plan_feedback", None)
        .map_err(|e| std::io::Error::new(std::io::ErrorKind::Other, e.to_string()))?;

    store.find_by_id(id)
        .map_err(|e| std::io::Error::new(std::io::ErrorKind::Other, e.to_string()))?
        .ok_or_else(|| std::io::Error::new(std::io::ErrorKind::NotFound, "Task not found"))
}

/// Request changes to a task's plan.
pub fn request_plan_changes(id: &str, feedback: &str) -> std::io::Result<Task> {
    let store = get_store();
    let task = store.find_by_id(id)
        .map_err(|e| std::io::Error::new(std::io::ErrorKind::Other, e.to_string()))?
        .ok_or_else(|| std::io::Error::new(std::io::ErrorKind::NotFound, "Task not found"))?;

    if task.status != TaskStatus::Planning || task.plan.is_none() {
        return Err(std::io::Error::new(
            std::io::ErrorKind::InvalidInput,
            "Task must be in Planning status with a plan set",
        ));
    }

    store.update_field(id, "plan", None)
        .map_err(|e| std::io::Error::new(std::io::ErrorKind::Other, e.to_string()))?;
    store.update_field(id, "plan_feedback", Some(feedback))
        .map_err(|e| std::io::Error::new(std::io::ErrorKind::Other, e.to_string()))?;

    store.find_by_id(id)
        .map_err(|e| std::io::Error::new(std::io::ErrorKind::Other, e.to_string()))?
        .ok_or_else(|| std::io::Error::new(std::io::ErrorKind::NotFound, "Task not found"))
}

/// Request changes during work review.
pub fn request_review_changes(id: &str, feedback: &str) -> std::io::Result<Task> {
    let store = get_store();
    let task = store.find_by_id(id)
        .map_err(|e| std::io::Error::new(std::io::ErrorKind::Other, e.to_string()))?
        .ok_or_else(|| std::io::Error::new(std::io::ErrorKind::NotFound, "Task not found"))?;

    if task.status != TaskStatus::Working || task.summary.is_none() {
        return Err(std::io::Error::new(
            std::io::ErrorKind::InvalidInput,
            "Task must be in Working status with a summary set",
        ));
    }

    store.update_field(id, "summary", None)
        .map_err(|e| std::io::Error::new(std::io::ErrorKind::Other, e.to_string()))?;
    store.update_field(id, "review_feedback", Some(feedback))
        .map_err(|e| std::io::Error::new(std::io::ErrorKind::Other, e.to_string()))?;

    store.find_by_id(id)
        .map_err(|e| std::io::Error::new(std::io::ErrorKind::Other, e.to_string()))?
        .ok_or_else(|| std::io::Error::new(std::io::ErrorKind::NotFound, "Task not found"))
}

/// Approve work review and transition to Done.
pub fn approve_review(id: &str) -> std::io::Result<Task> {
    let store = get_store();
    let task = store.find_by_id(id)
        .map_err(|e| std::io::Error::new(std::io::ErrorKind::Other, e.to_string()))?
        .ok_or_else(|| std::io::Error::new(std::io::ErrorKind::NotFound, "Task not found"))?;

    if task.status != TaskStatus::Working || task.summary.is_none() {
        return Err(std::io::Error::new(
            std::io::ErrorKind::InvalidInput,
            "Task must be in Working status with a summary set",
        ));
    }

    store.update_status(id, TaskStatus::Done)
        .map_err(|e| std::io::Error::new(std::io::ErrorKind::Other, e.to_string()))?;
    store.update_field(id, "completed_at", Some(&chrono::Utc::now().to_rfc3339()))
        .map_err(|e| std::io::Error::new(std::io::ErrorKind::Other, e.to_string()))?;
    store.update_field(id, "review_feedback", None)
        .map_err(|e| std::io::Error::new(std::io::ErrorKind::Other, e.to_string()))?;

    store.find_by_id(id)
        .map_err(|e| std::io::Error::new(std::io::ErrorKind::Other, e.to_string()))?
        .ok_or_else(|| std::io::Error::new(std::io::ErrorKind::NotFound, "Task not found"))
}

pub fn set_auto_approve(id: &str, enabled: bool) -> std::io::Result<Task> {
    let store = get_store();
    let mut task = store.find_by_id(id)
        .map_err(|e| std::io::Error::new(std::io::ErrorKind::Other, e.to_string()))?
        .ok_or_else(|| std::io::Error::new(std::io::ErrorKind::NotFound, "Task not found"))?;

    task.auto_approve = enabled;
    task.updated_at = chrono::Utc::now().to_rfc3339();
    store.save(&task)
        .map_err(|e| std::io::Error::new(std::io::ErrorKind::Other, e.to_string()))?;

    Ok(task)
}

// ========== Breakdown functions ==========

/// Create a child task under a parent task (parallel work, appears in Kanban).
pub fn create_child_task(parent_id: &str, title: &str, description: &str) -> std::io::Result<Task> {
    let store = get_store();
    let parent = store.find_by_id(parent_id)
        .map_err(|e| std::io::Error::new(std::io::ErrorKind::Other, e.to_string()))?
        .ok_or_else(|| std::io::Error::new(std::io::ErrorKind::NotFound, "Parent task not found"))?;

    if parent.status != TaskStatus::BreakingDown {
        return Err(std::io::Error::new(
            std::io::ErrorKind::InvalidInput,
            "Parent task must be in BreakingDown status",
        ));
    }

    let now = chrono::Utc::now().to_rfc3339();
    let task = Task {
        id: generate_task_id(),
        title: title.to_string(),
        description: description.to_string(),
        status: TaskStatus::Working,
        kind: TaskKind::Task,
        created_at: now.clone(),
        updated_at: now,
        completed_at: None,
        summary: None,
        error: None,
        plan: parent.plan.clone(),
        plan_feedback: None,
        review_feedback: None,
        sessions: None,
        auto_approve: false,
        parent_id: Some(parent_id.to_string()),
        breakdown: None,
        breakdown_feedback: None,
        skip_breakdown: true,
    };

    store.save(&task).map_err(|e| std::io::Error::new(std::io::ErrorKind::Other, e.to_string()))?;
    Ok(task)
}

/// Create a subtask under a parent task (checklist item, hidden from Kanban).
pub fn create_subtask(parent_id: &str, title: &str, description: &str) -> std::io::Result<Task> {
    let store = get_store();
    let parent = store.find_by_id(parent_id)
        .map_err(|e| std::io::Error::new(std::io::ErrorKind::Other, e.to_string()))?
        .ok_or_else(|| std::io::Error::new(std::io::ErrorKind::NotFound, "Parent task not found"))?;

    if parent.status != TaskStatus::BreakingDown {
        return Err(std::io::Error::new(
            std::io::ErrorKind::InvalidInput,
            "Parent task must be in BreakingDown status",
        ));
    }

    let now = chrono::Utc::now().to_rfc3339();
    let task = Task {
        id: generate_task_id(),
        title: title.to_string(),
        description: description.to_string(),
        status: TaskStatus::Working,
        kind: TaskKind::Subtask,
        created_at: now.clone(),
        updated_at: now,
        completed_at: None,
        summary: None,
        error: None,
        plan: parent.plan.clone(),
        plan_feedback: None,
        review_feedback: None,
        sessions: None,
        auto_approve: false,
        parent_id: Some(parent_id.to_string()),
        breakdown: None,
        breakdown_feedback: None,
        skip_breakdown: true,
    };

    store.save(&task).map_err(|e| std::io::Error::new(std::io::ErrorKind::Other, e.to_string()))?;
    Ok(task)
}

/// Complete a subtask (checklist item). Marks it as Done.
pub fn complete_subtask(id: &str) -> std::io::Result<Task> {
    let store = get_store();
    let task = store.find_by_id(id)
        .map_err(|e| std::io::Error::new(std::io::ErrorKind::Other, e.to_string()))?
        .ok_or_else(|| std::io::Error::new(std::io::ErrorKind::NotFound, "Task not found"))?;

    if task.kind != TaskKind::Subtask {
        return Err(std::io::Error::new(
            std::io::ErrorKind::InvalidInput,
            "Task must be a subtask",
        ));
    }

    store.update_status(id, TaskStatus::Done)
        .map_err(|e| std::io::Error::new(std::io::ErrorKind::Other, e.to_string()))?;
    store.update_field(id, "completed_at", Some(&chrono::Utc::now().to_rfc3339()))
        .map_err(|e| std::io::Error::new(std::io::ErrorKind::Other, e.to_string()))?;

    store.find_by_id(id)
        .map_err(|e| std::io::Error::new(std::io::ErrorKind::Other, e.to_string()))?
        .ok_or_else(|| std::io::Error::new(std::io::ErrorKind::NotFound, "Task not found"))
}

/// Get subtasks (checklist items) for a task.
pub fn get_subtasks(parent_id: &str) -> std::io::Result<Vec<Task>> {
    let store = get_store();
    store.get_subtasks(parent_id)
        .map_err(|e| std::io::Error::new(std::io::ErrorKind::Other, e.to_string()))
}

/// Get child tasks (parallel tasks that appear in Kanban) for a task.
pub fn get_child_tasks(parent_id: &str) -> std::io::Result<Vec<Task>> {
    let store = get_store();
    store.get_child_tasks(parent_id)
        .map_err(|e| std::io::Error::new(std::io::ErrorKind::Other, e.to_string()))
}

/// Set the breakdown for a task. Requires: BreakingDown status.
pub fn set_breakdown(id: &str, breakdown: &str) -> std::io::Result<Task> {
    let store = get_store();
    let task = store.find_by_id(id)
        .map_err(|e| std::io::Error::new(std::io::ErrorKind::Other, e.to_string()))?
        .ok_or_else(|| std::io::Error::new(std::io::ErrorKind::NotFound, "Task not found"))?;

    if task.status != TaskStatus::BreakingDown {
        return Err(std::io::Error::new(
            std::io::ErrorKind::InvalidInput,
            "Task must be in BreakingDown status",
        ));
    }

    store.update_field(id, "breakdown", Some(breakdown))
        .map_err(|e| std::io::Error::new(std::io::ErrorKind::Other, e.to_string()))?;

    store.find_by_id(id)
        .map_err(|e| std::io::Error::new(std::io::ErrorKind::Other, e.to_string()))?
        .ok_or_else(|| std::io::Error::new(std::io::ErrorKind::NotFound, "Task not found"))
}

/// Approve a breakdown and transition to WaitingOnSubtasks.
pub fn approve_breakdown(id: &str) -> std::io::Result<Task> {
    let store = get_store();
    let task = store.find_by_id(id)
        .map_err(|e| std::io::Error::new(std::io::ErrorKind::Other, e.to_string()))?
        .ok_or_else(|| std::io::Error::new(std::io::ErrorKind::NotFound, "Task not found"))?;

    if task.status != TaskStatus::BreakingDown || task.breakdown.is_none() {
        return Err(std::io::Error::new(
            std::io::ErrorKind::InvalidInput,
            "Task must be in BreakingDown status with a breakdown set",
        ));
    }

    store.update_status(id, TaskStatus::WaitingOnSubtasks)
        .map_err(|e| std::io::Error::new(std::io::ErrorKind::Other, e.to_string()))?;
    store.update_field(id, "breakdown_feedback", None)
        .map_err(|e| std::io::Error::new(std::io::ErrorKind::Other, e.to_string()))?;

    store.find_by_id(id)
        .map_err(|e| std::io::Error::new(std::io::ErrorKind::Other, e.to_string()))?
        .ok_or_else(|| std::io::Error::new(std::io::ErrorKind::NotFound, "Task not found"))
}

/// Request changes to a breakdown.
pub fn request_breakdown_changes(id: &str, feedback: &str) -> std::io::Result<Task> {
    let store = get_store();
    let task = store.find_by_id(id)
        .map_err(|e| std::io::Error::new(std::io::ErrorKind::Other, e.to_string()))?
        .ok_or_else(|| std::io::Error::new(std::io::ErrorKind::NotFound, "Task not found"))?;

    if task.status != TaskStatus::BreakingDown || task.breakdown.is_none() {
        return Err(std::io::Error::new(
            std::io::ErrorKind::InvalidInput,
            "Task must be in BreakingDown status with a breakdown set",
        ));
    }

    store.update_field(id, "breakdown", None)
        .map_err(|e| std::io::Error::new(std::io::ErrorKind::Other, e.to_string()))?;
    store.update_field(id, "breakdown_feedback", Some(feedback))
        .map_err(|e| std::io::Error::new(std::io::ErrorKind::Other, e.to_string()))?;

    store.find_by_id(id)
        .map_err(|e| std::io::Error::new(std::io::ErrorKind::Other, e.to_string()))?
        .ok_or_else(|| std::io::Error::new(std::io::ErrorKind::NotFound, "Task not found"))
}

/// Skip breakdown and go directly to Working.
pub fn skip_breakdown(id: &str) -> std::io::Result<Task> {
    let store = get_store();
    let task = store.find_by_id(id)
        .map_err(|e| std::io::Error::new(std::io::ErrorKind::Other, e.to_string()))?
        .ok_or_else(|| std::io::Error::new(std::io::ErrorKind::NotFound, "Task not found"))?;

    if task.status != TaskStatus::BreakingDown {
        return Err(std::io::Error::new(
            std::io::ErrorKind::InvalidInput,
            "Task must be in BreakingDown status",
        ));
    }

    store.update_status(id, TaskStatus::Working)
        .map_err(|e| std::io::Error::new(std::io::ErrorKind::Other, e.to_string()))?;

    store.find_by_id(id)
        .map_err(|e| std::io::Error::new(std::io::ErrorKind::Other, e.to_string()))?
        .ok_or_else(|| std::io::Error::new(std::io::ErrorKind::NotFound, "Task not found"))
}

/// Get all children of a task.
pub fn get_children(parent_id: &str) -> std::io::Result<Vec<Task>> {
    let tasks = load_tasks()?;
    Ok(tasks
        .into_iter()
        .filter(|t| t.parent_id.as_deref() == Some(parent_id))
        .collect())
}

/// Check if parent should transition based on children states.
pub fn check_parent_completion(parent_id: &str) -> std::io::Result<Option<Task>> {
    let store = get_store();
    let parent = store.find_by_id(parent_id)
        .map_err(|e| std::io::Error::new(std::io::ErrorKind::Other, e.to_string()))?
        .ok_or_else(|| std::io::Error::new(std::io::ErrorKind::NotFound, "Task not found"))?;

    if parent.status != TaskStatus::WaitingOnSubtasks {
        return Ok(None);
    }

    let children = get_children(parent_id)?;
    if children.is_empty() {
        return Ok(None);
    }

    // Check for any failed/blocked children
    let has_failed = children.iter().any(|c| c.status == TaskStatus::Failed);
    let has_blocked = children.iter().any(|c| c.status == TaskStatus::Blocked);

    if has_failed || has_blocked {
        let reason = if has_failed { "Child task failed" } else { "Child task blocked" };
        return Ok(Some(block_task(parent_id, reason)?));
    }

    // Check if all children are done
    let all_done = children.iter().all(|c| c.status == TaskStatus::Done);
    if all_done {
        let now = chrono::Utc::now().to_rfc3339();
        store.update_status(parent_id, TaskStatus::Done)
            .map_err(|e| std::io::Error::new(std::io::ErrorKind::Other, e.to_string()))?;
        store.update_field(parent_id, "completed_at", Some(&now))
            .map_err(|e| std::io::Error::new(std::io::ErrorKind::Other, e.to_string()))?;
        store.update_field(parent_id, "summary", Some(&format!("All {} subtasks completed successfully", children.len())))
            .map_err(|e| std::io::Error::new(std::io::ErrorKind::Other, e.to_string()))?;

        let updated = store.find_by_id(parent_id)
            .map_err(|e| std::io::Error::new(std::io::ErrorKind::Other, e.to_string()))?
            .ok_or_else(|| std::io::Error::new(std::io::ErrorKind::NotFound, "Task not found"))?;
        return Ok(Some(updated));
    }

    Ok(None)
}

/// Get the next breakdown session key (breakdown_0, breakdown_1, etc.)
pub fn get_next_breakdown_session_key(task: &Task) -> String {
    task.next_breakdown_session_key()
}
