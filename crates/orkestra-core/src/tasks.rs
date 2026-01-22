use std::sync::OnceLock;

use crate::adapters::SqliteStore;
use crate::ports::TaskStore;
use crate::project;
use crate::services::GitService;

use crate::error::OrkestraError;

// Re-export domain types that were previously defined here
pub use crate::domain::{
    IntegrationResult, LogEntry, SessionInfo, Task, TaskKind, TaskStatus, ToolInput,
};

/// Global `SQLite` store instance.
/// Using `OnceLock` for thread-safe lazy initialization.
static STORE: OnceLock<SqliteStore> = OnceLock::new();

/// Get or initialize the global store.
fn get_store() -> &'static SqliteStore {
    STORE.get_or_init(|| SqliteStore::new().expect("Failed to initialize SQLite store"))
}

/// Create a `GitService` for the current project.
/// Returns None if not in a git repository.
/// Note: `git2::Repository` is not thread-safe, so we create a new service each time.
fn create_git_service() -> Option<GitService> {
    project::find_project_root()
        .ok()
        .and_then(|root| GitService::new(&root).ok())
}

/// Attempt to integrate a completed task's branch back to the primary branch.
/// Called automatically when root tasks reach Done status.
/// Returns (`new_status`, `integration_result`, `conflict_message`).
/// - On success: (Done, Merged, None)
/// - On conflict: (Working, Conflict, Some(feedback message))
/// - On skip: (Done, Skipped, None)
fn try_integrate_task(task: &Task) -> (TaskStatus, Option<IntegrationResult>, Option<String>) {
    // Skip if not a root task (has parent)
    if task.parent_id.is_some() {
        return (
            TaskStatus::Done,
            Some(IntegrationResult::Skipped {
                reason: "Child task - parent handles integration".into(),
            }),
            None,
        );
    }

    // Skip if no worktree/branch
    let branch_name = match &task.branch_name {
        Some(b) => b.clone(),
        None => {
            return (
                TaskStatus::Done,
                Some(IntegrationResult::Skipped {
                    reason: "No branch associated with task".into(),
                }),
                None,
            )
        }
    };

    // Get git service
    let Some(git) = create_git_service() else {
        return (
            TaskStatus::Done,
            Some(IntegrationResult::Skipped {
                reason: "Git service not available".into(),
            }),
            None,
        );
    };

    // Attempt merge
    match git.merge_to_primary(&branch_name) {
        Ok(commit_sha) => {
            // Success: cleanup worktree and branch
            let _ = git.remove_worktree(&task.id);
            let _ = git.delete_branch(&branch_name);

            let target_branch = git.detect_primary_branch().unwrap_or_else(|_| "main".into());
            (
                TaskStatus::Done,
                Some(IntegrationResult::Merged {
                    merged_at: chrono::Utc::now().to_rfc3339(),
                    commit_sha,
                    target_branch,
                }),
                None,
            )
        }
        Err(OrkestraError::MergeConflict { files, .. }) => {
            // Conflict: abort merge, reopen task
            let _ = git.abort_merge();

            let conflict_msg = format!(
                "Merge conflict occurred when integrating to primary branch. Please resolve the following conflicts:\n\n{}\n\nAfter resolving, mark the task complete again.",
                files.iter().map(|f| format!("- {f}")).collect::<Vec<_>>().join("\n")
            );

            (
                TaskStatus::Working,
                Some(IntegrationResult::Conflict {
                    conflict_files: files,
                }),
                Some(conflict_msg),
            )
        }
        Err(e) => {
            // Other error: log and skip integration
            eprintln!("Warning: Failed to integrate task {}: {e}", task.id);
            (
                TaskStatus::Done,
                Some(IntegrationResult::Skipped {
                    reason: format!("Merge failed: {e}"),
                }),
                None,
            )
        }
    }
}

pub fn load_tasks() -> std::io::Result<Vec<Task>> {
    let store = get_store();
    store
        .load_all()
        .map_err(|e| std::io::Error::other(e.to_string()))
}

pub fn save_tasks(tasks: &[Task]) -> std::io::Result<()> {
    let store = get_store();
    store
        .save_all(tasks)
        .map_err(|e| std::io::Error::other(e.to_string()))
}

fn generate_task_id() -> String {
    let store = get_store();
    store.next_id().unwrap_or_else(|_| "TASK-001".to_string())
}

pub fn create_task(title: &str, description: &str) -> std::io::Result<Task> {
    create_task_with_options(title, description, false)
}

pub fn create_task_with_options(
    title: &str,
    description: &str,
    auto_approve: bool,
) -> std::io::Result<Task> {
    let store = get_store();
    let now = chrono::Utc::now().to_rfc3339();
    let id = generate_task_id();

    // Create worktree for root task if GitService is available
    let (branch_name, worktree_path) = if let Some(git) = create_git_service() {
        match git.create_worktree(&id) {
            Ok((branch, path)) => (Some(branch), Some(path.to_string_lossy().to_string())),
            Err(e) => {
                eprintln!("Warning: Failed to create worktree for task {id}: {e}");
                (None, None)
            }
        }
    } else {
        (None, None)
    };

    let task = Task {
        id,
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
        reviewer_feedback: None,
        sessions: None,
        auto_approve,
        parent_id: None,
        breakdown: None,
        breakdown_feedback: None,
        skip_breakdown: false,
        agent_pid: None,
        branch_name,
        worktree_path,
        integration_result: None,
    };

    store
        .save(&task)
        .map_err(|e| std::io::Error::other(e.to_string()))?;
    Ok(task)
}

pub fn update_task_status(id: &str, status: TaskStatus) -> std::io::Result<Task> {
    let store = get_store();

    // Update status atomically
    store
        .update_status(id, status)
        .map_err(|e| std::io::Error::other(e.to_string()))?;

    // If transitioning to Done, also set completed_at and mark subtasks as done
    if status == TaskStatus::Done {
        let now = chrono::Utc::now().to_rfc3339();
        store
            .update_field(id, "completed_at", Some(&now))
            .map_err(|e| std::io::Error::other(e.to_string()))?;

        // Also mark all subtasks as Done (they're checklist items for this task)
        if let Ok(subtasks) = store.get_subtasks(id) {
            for subtask in subtasks {
                if subtask.status != TaskStatus::Done {
                    let _ = store.update_status(&subtask.id, TaskStatus::Done);
                    let _ = store.update_field(&subtask.id, "completed_at", Some(&now));
                }
            }
        }
    }

    // Return updated task
    store
        .find_by_id(id)
        .map_err(|e| std::io::Error::other(e.to_string()))?
        .ok_or_else(|| std::io::Error::new(std::io::ErrorKind::NotFound, "Task not found"))
}

/// Mark task as complete - stays in Working status with summary set.
pub fn complete_task(id: &str, summary: &str) -> std::io::Result<Task> {
    let store = get_store();
    store
        .update_field(id, "summary", Some(summary))
        .map_err(|e| std::io::Error::other(e.to_string()))?;

    store
        .find_by_id(id)
        .map_err(|e| std::io::Error::other(e.to_string()))?
        .ok_or_else(|| std::io::Error::new(std::io::ErrorKind::NotFound, "Task not found"))
}

pub fn fail_task(id: &str, reason: &str) -> std::io::Result<Task> {
    let store = get_store();
    store
        .update_status(id, TaskStatus::Failed)
        .map_err(|e| std::io::Error::other(e.to_string()))?;
    store
        .update_field(id, "error", Some(reason))
        .map_err(|e| std::io::Error::other(e.to_string()))?;

    store
        .find_by_id(id)
        .map_err(|e| std::io::Error::other(e.to_string()))?
        .ok_or_else(|| std::io::Error::new(std::io::ErrorKind::NotFound, "Task not found"))
}

pub fn block_task(id: &str, reason: &str) -> std::io::Result<Task> {
    let store = get_store();
    store
        .update_status(id, TaskStatus::Blocked)
        .map_err(|e| std::io::Error::other(e.to_string()))?;
    store
        .update_field(id, "error", Some(reason))
        .map_err(|e| std::io::Error::other(e.to_string()))?;

    store
        .find_by_id(id)
        .map_err(|e| std::io::Error::other(e.to_string()))?
        .ok_or_else(|| std::io::Error::new(std::io::ErrorKind::NotFound, "Task not found"))
}

/// Set or clear the `agent_pid` on a task.
/// Call with Some(pid) immediately when spawning, None when agent finishes.
pub fn set_agent_pid(id: &str, pid: Option<u32>) -> std::io::Result<()> {
    let store = get_store();
    store
        .update_agent_pid(id, pid)
        .map_err(|e| std::io::Error::other(e.to_string()))
}

/// Add a session to a task atomically with optional agent PID.
/// This is the key fix for the race condition.
pub fn add_task_session(
    id: &str,
    session_type: &str,
    session_id: &str,
    agent_pid: Option<u32>,
) -> std::io::Result<Task> {
    let store = get_store();
    store
        .add_session(id, session_type, session_id, agent_pid)
        .map_err(|e| std::io::Error::other(e.to_string()))?;

    store
        .find_by_id(id)
        .map_err(|e| std::io::Error::other(e.to_string()))?
        .ok_or_else(|| std::io::Error::new(std::io::ErrorKind::NotFound, "Task not found"))
}

/// Set the plan for a task.
pub fn set_task_plan(id: &str, plan: &str) -> std::io::Result<Task> {
    let store = get_store();
    store
        .update_field(id, "plan", Some(plan))
        .map_err(|e| std::io::Error::other(e.to_string()))?;

    store
        .find_by_id(id)
        .map_err(|e| std::io::Error::other(e.to_string()))?
        .ok_or_else(|| std::io::Error::new(std::io::ErrorKind::NotFound, "Task not found"))
}

/// Approve a task's plan. Transitions to `BreakingDown` or Working based on `skip_breakdown`.
pub fn approve_task_plan(id: &str) -> std::io::Result<Task> {
    let store = get_store();
    let task = store
        .find_by_id(id)
        .map_err(|e| std::io::Error::other(e.to_string()))?
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

    store
        .update_status(id, new_status)
        .map_err(|e| std::io::Error::other(e.to_string()))?;
    store
        .update_field(id, "plan_feedback", None)
        .map_err(|e| std::io::Error::other(e.to_string()))?;

    store
        .find_by_id(id)
        .map_err(|e| std::io::Error::other(e.to_string()))?
        .ok_or_else(|| std::io::Error::new(std::io::ErrorKind::NotFound, "Task not found"))
}

/// Request changes to a task's plan.
pub fn request_plan_changes(id: &str, feedback: &str) -> std::io::Result<Task> {
    let store = get_store();
    let task = store
        .find_by_id(id)
        .map_err(|e| std::io::Error::other(e.to_string()))?
        .ok_or_else(|| std::io::Error::new(std::io::ErrorKind::NotFound, "Task not found"))?;

    if task.status != TaskStatus::Planning || task.plan.is_none() {
        return Err(std::io::Error::new(
            std::io::ErrorKind::InvalidInput,
            "Task must be in Planning status with a plan set",
        ));
    }

    store
        .update_field(id, "plan", None)
        .map_err(|e| std::io::Error::other(e.to_string()))?;
    store
        .update_field(id, "plan_feedback", Some(feedback))
        .map_err(|e| std::io::Error::other(e.to_string()))?;

    store
        .find_by_id(id)
        .map_err(|e| std::io::Error::other(e.to_string()))?
        .ok_or_else(|| std::io::Error::new(std::io::ErrorKind::NotFound, "Task not found"))
}

/// Request changes during work review.
pub fn request_review_changes(id: &str, feedback: &str) -> std::io::Result<Task> {
    let store = get_store();
    let task = store
        .find_by_id(id)
        .map_err(|e| std::io::Error::other(e.to_string()))?
        .ok_or_else(|| std::io::Error::new(std::io::ErrorKind::NotFound, "Task not found"))?;

    if task.status != TaskStatus::Working || task.summary.is_none() {
        return Err(std::io::Error::new(
            std::io::ErrorKind::InvalidInput,
            "Task must be in Working status with a summary set",
        ));
    }

    store
        .update_field(id, "summary", None)
        .map_err(|e| std::io::Error::other(e.to_string()))?;
    store
        .update_field(id, "review_feedback", Some(feedback))
        .map_err(|e| std::io::Error::other(e.to_string()))?;

    store
        .find_by_id(id)
        .map_err(|e| std::io::Error::other(e.to_string()))?
        .ok_or_else(|| std::io::Error::new(std::io::ErrorKind::NotFound, "Task not found"))
}

/// Approve work review and transition to Done.
/// For root tasks with worktrees, this also attempts to merge the branch back to primary.
pub fn approve_review(id: &str) -> std::io::Result<Task> {
    let store = get_store();
    let mut task = store
        .find_by_id(id)
        .map_err(|e| std::io::Error::other(e.to_string()))?
        .ok_or_else(|| std::io::Error::new(std::io::ErrorKind::NotFound, "Task not found"))?;

    if task.status != TaskStatus::Working || task.summary.is_none() {
        return Err(std::io::Error::new(
            std::io::ErrorKind::InvalidInput,
            "Task must be in Working status with a summary set",
        ));
    }

    // Try to integrate the branch back to primary
    let (new_status, integration_result, conflict_msg) = try_integrate_task(&task);

    task.status = new_status;
    task.integration_result = integration_result;
    task.updated_at = chrono::Utc::now().to_rfc3339();

    if new_status == TaskStatus::Done {
        // Success or skipped - mark as done
        task.completed_at = Some(chrono::Utc::now().to_rfc3339());
        task.review_feedback = None;
    } else {
        // Conflict - reopen task with feedback
        task.summary = None; // Clear so worker knows to continue
        task.reviewer_feedback = conflict_msg;
    }

    store
        .save(&task)
        .map_err(|e| std::io::Error::other(e.to_string()))?;

    Ok(task)
}

/// Transition task to Reviewing status (spawns reviewer agent).
/// Called when human approves the work.
pub fn start_automated_review(id: &str) -> std::io::Result<Task> {
    let store = get_store();
    let task = store
        .find_by_id(id)
        .map_err(|e| std::io::Error::other(e.to_string()))?
        .ok_or_else(|| std::io::Error::new(std::io::ErrorKind::NotFound, "Task not found"))?;

    if task.status != TaskStatus::Working || task.summary.is_none() {
        return Err(std::io::Error::new(
            std::io::ErrorKind::InvalidInput,
            "Task must be in Working status with a summary set",
        ));
    }

    store
        .update_status(id, TaskStatus::Reviewing)
        .map_err(|e| std::io::Error::other(e.to_string()))?;
    store
        .update_field(id, "review_feedback", None)
        .map_err(|e| std::io::Error::other(e.to_string()))?;

    store
        .find_by_id(id)
        .map_err(|e| std::io::Error::other(e.to_string()))?
        .ok_or_else(|| std::io::Error::new(std::io::ErrorKind::NotFound, "Task not found"))
}

/// Reviewer agent approves the implementation → Done.
/// For root tasks with worktrees, this also attempts to merge the branch back to primary.
pub fn approve_automated_review(id: &str) -> std::io::Result<Task> {
    let store = get_store();
    let mut task = store
        .find_by_id(id)
        .map_err(|e| std::io::Error::other(e.to_string()))?
        .ok_or_else(|| std::io::Error::new(std::io::ErrorKind::NotFound, "Task not found"))?;

    if task.status != TaskStatus::Reviewing {
        return Err(std::io::Error::new(
            std::io::ErrorKind::InvalidInput,
            "Task must be in Reviewing status",
        ));
    }

    // Try to integrate the branch back to primary
    let (new_status, integration_result, conflict_msg) = try_integrate_task(&task);

    task.status = new_status;
    task.integration_result = integration_result;
    task.updated_at = chrono::Utc::now().to_rfc3339();

    if new_status == TaskStatus::Done {
        // Success or skipped - mark as done
        task.completed_at = Some(chrono::Utc::now().to_rfc3339());
        task.reviewer_feedback = None;
    } else {
        // Conflict - reopen task with feedback
        task.summary = None; // Clear so worker knows to continue
        task.reviewer_feedback = conflict_msg;
    }

    store
        .save(&task)
        .map_err(|e| std::io::Error::other(e.to_string()))?;

    Ok(task)
}

/// Reviewer agent rejects the implementation → back to Working with feedback.
pub fn reject_automated_review(id: &str, feedback: &str) -> std::io::Result<Task> {
    let store = get_store();
    let task = store
        .find_by_id(id)
        .map_err(|e| std::io::Error::other(e.to_string()))?
        .ok_or_else(|| std::io::Error::new(std::io::ErrorKind::NotFound, "Task not found"))?;

    if task.status != TaskStatus::Reviewing {
        return Err(std::io::Error::new(
            std::io::ErrorKind::InvalidInput,
            "Task must be in Reviewing status",
        ));
    }

    // Clear the summary so worker knows to continue working
    store
        .update_field(id, "summary", None)
        .map_err(|e| std::io::Error::other(e.to_string()))?;
    // Set feedback from reviewer
    store
        .update_field(id, "reviewer_feedback", Some(feedback))
        .map_err(|e| std::io::Error::other(e.to_string()))?;
    // Transition back to Working
    store
        .update_status(id, TaskStatus::Working)
        .map_err(|e| std::io::Error::other(e.to_string()))?;

    store
        .find_by_id(id)
        .map_err(|e| std::io::Error::other(e.to_string()))?
        .ok_or_else(|| std::io::Error::new(std::io::ErrorKind::NotFound, "Task not found"))
}

pub fn set_auto_approve(id: &str, enabled: bool) -> std::io::Result<Task> {
    let store = get_store();
    let mut task = store
        .find_by_id(id)
        .map_err(|e| std::io::Error::other(e.to_string()))?
        .ok_or_else(|| std::io::Error::new(std::io::ErrorKind::NotFound, "Task not found"))?;

    task.auto_approve = enabled;
    task.updated_at = chrono::Utc::now().to_rfc3339();
    store
        .save(&task)
        .map_err(|e| std::io::Error::other(e.to_string()))?;

    Ok(task)
}

// ========== Breakdown functions ==========

/// Create a child task under a parent task (parallel work, appears in Kanban).
/// Child tasks inherit the parent's worktree.
pub fn create_child_task(parent_id: &str, title: &str, description: &str) -> std::io::Result<Task> {
    let store = get_store();
    let parent = store
        .find_by_id(parent_id)
        .map_err(|e| std::io::Error::other(e.to_string()))?
        .ok_or_else(|| {
            std::io::Error::new(std::io::ErrorKind::NotFound, "Parent task not found")
        })?;

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
        reviewer_feedback: None,
        sessions: None,
        auto_approve: false,
        parent_id: Some(parent_id.to_string()),
        breakdown: None,
        breakdown_feedback: None,
        skip_breakdown: true,
        agent_pid: None,
        // Inherit parent's worktree
        branch_name: parent.branch_name.clone(),
        worktree_path: parent.worktree_path.clone(),
        integration_result: None, // Child tasks don't do integration
    };

    store
        .save(&task)
        .map_err(|e| std::io::Error::other(e.to_string()))?;
    Ok(task)
}

/// Create a subtask under a parent task (checklist item, hidden from Kanban).
/// Subtasks inherit the parent's worktree.
pub fn create_subtask(parent_id: &str, title: &str, description: &str) -> std::io::Result<Task> {
    let store = get_store();
    let parent = store
        .find_by_id(parent_id)
        .map_err(|e| std::io::Error::other(e.to_string()))?
        .ok_or_else(|| {
            std::io::Error::new(std::io::ErrorKind::NotFound, "Parent task not found")
        })?;

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
        reviewer_feedback: None,
        sessions: None,
        auto_approve: false,
        parent_id: Some(parent_id.to_string()),
        breakdown: None,
        breakdown_feedback: None,
        skip_breakdown: true,
        agent_pid: None,
        // Inherit parent's worktree
        branch_name: parent.branch_name.clone(),
        worktree_path: parent.worktree_path.clone(),
        integration_result: None, // Subtasks don't do integration
    };

    store
        .save(&task)
        .map_err(|e| std::io::Error::other(e.to_string()))?;
    Ok(task)
}

/// Complete a subtask (checklist item). Marks it as Done.
pub fn complete_subtask(id: &str) -> std::io::Result<Task> {
    let store = get_store();
    let task = store
        .find_by_id(id)
        .map_err(|e| std::io::Error::other(e.to_string()))?
        .ok_or_else(|| std::io::Error::new(std::io::ErrorKind::NotFound, "Task not found"))?;

    if task.kind != TaskKind::Subtask {
        return Err(std::io::Error::new(
            std::io::ErrorKind::InvalidInput,
            "Task must be a subtask",
        ));
    }

    store
        .update_status(id, TaskStatus::Done)
        .map_err(|e| std::io::Error::other(e.to_string()))?;
    store
        .update_field(id, "completed_at", Some(&chrono::Utc::now().to_rfc3339()))
        .map_err(|e| std::io::Error::other(e.to_string()))?;

    store
        .find_by_id(id)
        .map_err(|e| std::io::Error::other(e.to_string()))?
        .ok_or_else(|| std::io::Error::new(std::io::ErrorKind::NotFound, "Task not found"))
}

/// Get subtasks (checklist items) for a task.
pub fn get_subtasks(parent_id: &str) -> std::io::Result<Vec<Task>> {
    let store = get_store();
    store
        .get_subtasks(parent_id)
        .map_err(|e| std::io::Error::other(e.to_string()))
}

/// Get child tasks (parallel tasks that appear in Kanban) for a task.
pub fn get_child_tasks(parent_id: &str) -> std::io::Result<Vec<Task>> {
    let store = get_store();
    store
        .get_child_tasks(parent_id)
        .map_err(|e| std::io::Error::other(e.to_string()))
}

/// Set the breakdown for a task. Requires: `BreakingDown` status.
pub fn set_breakdown(id: &str, breakdown: &str) -> std::io::Result<Task> {
    let store = get_store();
    let task = store
        .find_by_id(id)
        .map_err(|e| std::io::Error::other(e.to_string()))?
        .ok_or_else(|| std::io::Error::new(std::io::ErrorKind::NotFound, "Task not found"))?;

    if task.status != TaskStatus::BreakingDown {
        return Err(std::io::Error::new(
            std::io::ErrorKind::InvalidInput,
            "Task must be in BreakingDown status",
        ));
    }

    store
        .update_field(id, "breakdown", Some(breakdown))
        .map_err(|e| std::io::Error::other(e.to_string()))?;

    store
        .find_by_id(id)
        .map_err(|e| std::io::Error::other(e.to_string()))?
        .ok_or_else(|| std::io::Error::new(std::io::ErrorKind::NotFound, "Task not found"))
}

/// Approve a breakdown and transition to Working or `WaitingOnSubtasks`.
/// - If there are child tasks (kind: task), go to `WaitingOnSubtasks` (they get parallel workers)
/// - If only subtasks (kind: subtask) or none, go to Working (checklist for worker)
pub fn approve_breakdown(id: &str) -> std::io::Result<Task> {
    let store = get_store();
    let task = store
        .find_by_id(id)
        .map_err(|e| std::io::Error::other(e.to_string()))?
        .ok_or_else(|| std::io::Error::new(std::io::ErrorKind::NotFound, "Task not found"))?;

    if task.status != TaskStatus::BreakingDown || task.breakdown.is_none() {
        return Err(std::io::Error::new(
            std::io::ErrorKind::InvalidInput,
            "Task must be in BreakingDown status with a breakdown set",
        ));
    }

    // Check if there are child tasks (not subtasks) - those get parallel workers
    let child_tasks = get_child_tasks(id)?;
    let new_status = if child_tasks.is_empty() {
        // No child tasks, just subtasks (checklist) - go to Working
        TaskStatus::Working
    } else {
        // Has child tasks that need their own workers - wait on them
        TaskStatus::WaitingOnSubtasks
    };

    store
        .update_status(id, new_status)
        .map_err(|e| std::io::Error::other(e.to_string()))?;
    store
        .update_field(id, "breakdown_feedback", None)
        .map_err(|e| std::io::Error::other(e.to_string()))?;

    store
        .find_by_id(id)
        .map_err(|e| std::io::Error::other(e.to_string()))?
        .ok_or_else(|| std::io::Error::new(std::io::ErrorKind::NotFound, "Task not found"))
}

/// Request changes to a breakdown.
pub fn request_breakdown_changes(id: &str, feedback: &str) -> std::io::Result<Task> {
    let store = get_store();
    let task = store
        .find_by_id(id)
        .map_err(|e| std::io::Error::other(e.to_string()))?
        .ok_or_else(|| std::io::Error::new(std::io::ErrorKind::NotFound, "Task not found"))?;

    if task.status != TaskStatus::BreakingDown || task.breakdown.is_none() {
        return Err(std::io::Error::new(
            std::io::ErrorKind::InvalidInput,
            "Task must be in BreakingDown status with a breakdown set",
        ));
    }

    store
        .update_field(id, "breakdown", None)
        .map_err(|e| std::io::Error::other(e.to_string()))?;
    store
        .update_field(id, "breakdown_feedback", Some(feedback))
        .map_err(|e| std::io::Error::other(e.to_string()))?;

    store
        .find_by_id(id)
        .map_err(|e| std::io::Error::other(e.to_string()))?
        .ok_or_else(|| std::io::Error::new(std::io::ErrorKind::NotFound, "Task not found"))
}

/// Skip breakdown and go directly to Working.
pub fn skip_breakdown(id: &str) -> std::io::Result<Task> {
    let store = get_store();
    let task = store
        .find_by_id(id)
        .map_err(|e| std::io::Error::other(e.to_string()))?
        .ok_or_else(|| std::io::Error::new(std::io::ErrorKind::NotFound, "Task not found"))?;

    if task.status != TaskStatus::BreakingDown {
        return Err(std::io::Error::new(
            std::io::ErrorKind::InvalidInput,
            "Task must be in BreakingDown status",
        ));
    }

    store
        .update_status(id, TaskStatus::Working)
        .map_err(|e| std::io::Error::other(e.to_string()))?;

    store
        .find_by_id(id)
        .map_err(|e| std::io::Error::other(e.to_string()))?
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
/// For root tasks with worktrees, also attempts to merge the branch back to primary.
pub fn check_parent_completion(parent_id: &str) -> std::io::Result<Option<Task>> {
    let store = get_store();
    let mut parent = store
        .find_by_id(parent_id)
        .map_err(|e| std::io::Error::other(e.to_string()))?
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
        let reason = if has_failed {
            "Child task failed"
        } else {
            "Child task blocked"
        };
        return Ok(Some(block_task(parent_id, reason)?));
    }

    // Check if all children are done
    let all_done = children.iter().all(|c| c.status == TaskStatus::Done);
    if all_done {
        // Try to integrate the branch back to primary
        let (new_status, integration_result, conflict_msg) = try_integrate_task(&parent);

        parent.status = new_status;
        parent.integration_result = integration_result;
        parent.updated_at = chrono::Utc::now().to_rfc3339();

        if new_status == TaskStatus::Done {
            // Success or skipped - mark as done
            parent.completed_at = Some(chrono::Utc::now().to_rfc3339());
            parent.summary = Some(format!(
                "All {} subtasks completed successfully",
                children.len()
            ));
        } else {
            // Conflict - reopen task with feedback
            // Note: Parent goes to Working status so worker can resolve conflicts
            parent.summary = None;
            parent.reviewer_feedback = conflict_msg;
        }

        store
            .save(&parent)
            .map_err(|e| std::io::Error::other(e.to_string()))?;

        return Ok(Some(parent));
    }

    Ok(None)
}
