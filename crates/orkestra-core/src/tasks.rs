//! Task operations that work with a Project.
//!
//! All functions take a `&Project` reference and use its store and git service.

use crate::error::{OrkestraError, Result};
use crate::ports::TaskStore;
use crate::services::Project;

// Re-export domain types for convenience
pub use crate::domain::{
    IntegrationResult, LogEntry, SessionInfo, Task, TaskKind, TaskStatus, ToolInput,
};

// =============================================================================
// Integration Helper
// =============================================================================

/// Attempt to integrate a completed task's branch back to the primary branch.
/// Returns (`new_status`, `integration_result`, `conflict_message`).
///
/// Called by the orchestrator for tasks in Done status that have a branch
/// but no integration result yet.
pub fn try_integrate(
    project: &Project,
    task: &Task,
) -> (TaskStatus, Option<IntegrationResult>, Option<String>) {
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
    let Some(git) = project.git() else {
        return (
            TaskStatus::Done,
            Some(IntegrationResult::Skipped {
                reason: "Git service not available".into(),
            }),
            None,
        );
    };

    // Commit any uncommitted changes in the worktree before merging
    if let Some(worktree_path) = &task.worktree_path {
        if let Err(e) = git.commit_pending_changes(
            std::path::Path::new(worktree_path),
            &format!("Final changes for task {}", task.id),
        ) {
            crate::orkestra_debug!("task", "WARNING: Failed to commit pending changes: {e}");
        }
    }

    // Attempt merge
    match git.merge_to_primary(&branch_name) {
        Ok(commit_sha) => {
            // Success: cleanup worktree and branch
            let _ = git.remove_worktree(&task.id);
            let _ = git.delete_branch(&branch_name);

            let target_branch = git
                .detect_primary_branch()
                .unwrap_or_else(|_| "main".into());
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
            // Other error: don't mark as Done - return to Working so user can retry
            // This prevents tasks from being marked complete when the merge actually failed
            crate::orkestra_debug!("task", "WARNING: Failed to integrate task {}: {e}", task.id);
            let _ = git.abort_merge(); // Clean up any partial merge state

            let error_msg = format!(
                "Merge failed with error: {e}\n\nPlease resolve the issue and mark the task complete again to retry the merge."
            );

            (
                TaskStatus::Working,
                Some(IntegrationResult::Skipped {
                    reason: format!("Merge failed: {e}"),
                }),
                Some(error_msg),
            )
        }
    }
}

/// Called by orchestrator to integrate a Done task's branch back to primary.
/// - If merge succeeds: deletes the task from the store
/// - If merge conflicts: sets task back to Working with feedback
/// - If task is a child or has no branch: deletes the task (no merge needed)
pub fn integrate_done_task(project: &Project, id: &str) -> Result<()> {
    let task = require_task(project, id)?;

    if task.status != TaskStatus::Done {
        return Err(OrkestraError::InvalidState {
            expected: "Done".into(),
            actual: format!("{:?}", task.status),
        });
    }

    // Already successfully merged - nothing to do
    // But if it was a conflict or skip, we should retry the merge
    if let Some(IntegrationResult::Merged { .. }) = &task.integration_result {
        return Ok(());
    }

    let (new_status, integration_result, conflict_msg) = try_integrate(project, &task);

    let store = project.store();

    // If merge conflict or error, reopen the task for user to fix
    if new_status == TaskStatus::Working {
        store.update_status(id, TaskStatus::Working)?;
        store.update_field(id, "summary", None)?; // Clear summary to reopen
        store.update_field(id, "completed_at", None)?;
        if let Some(msg) = conflict_msg {
            // Use review_feedback so worker sees it when session is resumed
            store.update_field(id, "review_feedback", Some(&msg))?;
        }
        if let Some(result) = &integration_result {
            let result_json = serde_json::to_string(result)
                .map_err(|e| OrkestraError::InvalidInput(e.to_string()))?;
            store.update_field(id, "integration_result", Some(&result_json))?;
        }
        return Ok(());
    }

    // Store integration result before deleting
    if let Some(result) = &integration_result {
        let result_json = serde_json::to_string(result)
            .map_err(|e| OrkestraError::InvalidInput(e.to_string()))?;
        store.update_field(id, "integration_result", Some(&result_json))?;
    }

    // Successfully integrated (merged or skipped) - delete the task
    store.delete(id)?;

    Ok(())
}

// =============================================================================
// Core Task Operations
// =============================================================================

pub fn load_tasks(project: &Project) -> Result<Vec<Task>> {
    project.store().load_all()
}

pub fn save_tasks(project: &Project, tasks: &[Task]) -> Result<()> {
    project.store().save_all(tasks)
}

pub fn create_task(project: &Project, title: &str, description: &str) -> Result<Task> {
    create_task_with_options(project, title, description, false, None)
}

pub fn create_task_with_options(
    project: &Project,
    title: &str,
    description: &str,
    auto_approve: bool,
    base_branch: Option<&str>,
) -> Result<Task> {
    let store = project.store();
    let now = chrono::Utc::now().to_rfc3339();
    let id = store.next_id()?;

    // Create worktree for root task if git is available
    let (branch_name, worktree_path) = if let Some(git) = project.git() {
        match git.create_worktree(&id, base_branch) {
            Ok((branch, path)) => (Some(branch), Some(path.to_string_lossy().to_string())),
            Err(e) => {
                crate::orkestra_debug!("task", "WARNING: Failed to create worktree for task {id}: {e}");
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

    store.save(&task)?;
    Ok(task)
}

pub fn get_task(project: &Project, id: &str) -> Result<Option<Task>> {
    project.store().find_by_id(id)
}

fn require_task(project: &Project, id: &str) -> Result<Task> {
    project
        .store()
        .find_by_id(id)?
        .ok_or_else(|| OrkestraError::TaskNotFound(id.to_string()))
}

pub fn update_task_status(project: &Project, id: &str, status: TaskStatus) -> Result<Task> {
    let store = project.store();

    store.update_status(id, status)?;

    // If transitioning to Done, also set completed_at and mark subtasks as done
    if status == TaskStatus::Done {
        let now = chrono::Utc::now().to_rfc3339();
        store.update_field(id, "completed_at", Some(&now))?;

        // Also mark all subtasks as Done
        if let Ok(subtasks) = store.get_subtasks(id) {
            for subtask in subtasks {
                if subtask.status != TaskStatus::Done {
                    let _ = store.update_status(&subtask.id, TaskStatus::Done);
                    let _ = store.update_field(&subtask.id, "completed_at", Some(&now));
                }
            }
        }
    }

    require_task(project, id)
}

/// Mark task as complete - stays in Working status with summary set.
pub fn complete_task(project: &Project, id: &str, summary: &str) -> Result<Task> {
    project.store().update_field(id, "summary", Some(summary))?;
    require_task(project, id)
}

pub fn fail_task(project: &Project, id: &str, reason: &str) -> Result<Task> {
    let store = project.store();
    store.update_status(id, TaskStatus::Failed)?;
    store.update_field(id, "error", Some(reason))?;
    require_task(project, id)
}

pub fn block_task(project: &Project, id: &str, reason: &str) -> Result<Task> {
    let store = project.store();
    store.update_status(id, TaskStatus::Blocked)?;
    store.update_field(id, "error", Some(reason))?;
    require_task(project, id)
}

// =============================================================================
// Agent/Session Management
// =============================================================================

/// Set or clear the `agent_pid` on a task.
pub fn set_agent_pid(project: &Project, id: &str, pid: Option<u32>) -> Result<()> {
    project.store().update_agent_pid(id, pid)
}

/// Add a session to a task atomically with optional agent PID.
pub fn add_task_session(
    project: &Project,
    id: &str,
    session_type: &str,
    session_id: &str,
    agent_pid: Option<u32>,
) -> Result<Task> {
    project
        .store()
        .add_session(id, session_type, session_id, agent_pid)?;
    require_task(project, id)
}

// =============================================================================
// Plan Management
// =============================================================================

pub fn set_task_plan(project: &Project, id: &str, plan: &str) -> Result<Task> {
    project.store().update_field(id, "plan", Some(plan))?;
    require_task(project, id)
}

/// Set the title for a task.
pub fn set_task_title(project: &Project, id: &str, title: &str) -> Result<Task> {
    project.store().update_field(id, "title", Some(title))?;
    require_task(project, id)
}

/// Approve a task's plan. Transitions to `BreakingDown` or Working based on `skip_breakdown`.
pub fn approve_task_plan(project: &Project, id: &str) -> Result<Task> {
    let store = project.store();
    let task = require_task(project, id)?;

    if task.status != TaskStatus::Planning || task.plan.is_none() {
        return Err(OrkestraError::InvalidState {
            expected: "Planning with plan set".into(),
            actual: format!("{:?}", task.status),
        });
    }

    let new_status = if task.skip_breakdown {
        TaskStatus::Working
    } else {
        TaskStatus::BreakingDown
    };

    store.update_status(id, new_status)?;
    store.update_field(id, "plan_feedback", None)?;
    require_task(project, id)
}

pub fn request_plan_changes(project: &Project, id: &str, feedback: &str) -> Result<Task> {
    let store = project.store();
    let task = require_task(project, id)?;

    if task.status != TaskStatus::Planning || task.plan.is_none() {
        return Err(OrkestraError::InvalidState {
            expected: "Planning with plan set".into(),
            actual: format!("{:?}", task.status),
        });
    }

    store.update_field(id, "plan", None)?;
    store.update_field(id, "plan_feedback", Some(feedback))?;
    require_task(project, id)
}

// =============================================================================
// Review Management
// =============================================================================

pub fn request_review_changes(project: &Project, id: &str, feedback: &str) -> Result<Task> {
    let store = project.store();
    let task = require_task(project, id)?;

    if task.status != TaskStatus::Working || task.summary.is_none() {
        return Err(OrkestraError::InvalidState {
            expected: "Working with summary set".into(),
            actual: format!("{:?}", task.status),
        });
    }

    store.update_field(id, "summary", None)?;
    store.update_field(id, "review_feedback", Some(feedback))?;
    require_task(project, id)
}

/// Approve work review and transition to Done.
/// Orchestrator will handle branch integration and cleanup for Done tasks.
pub fn approve_review(project: &Project, id: &str) -> Result<Task> {
    let store = project.store();
    let task = require_task(project, id)?;

    if task.status != TaskStatus::Working || task.summary.is_none() {
        return Err(OrkestraError::InvalidState {
            expected: "Working with summary set".into(),
            actual: format!("{:?}", task.status),
        });
    }

    let now = chrono::Utc::now().to_rfc3339();
    store.update_status(id, TaskStatus::Done)?;
    store.update_field(id, "completed_at", Some(&now))?;
    store.update_field(id, "review_feedback", None)?;

    require_task(project, id)
}

/// Transition task to Reviewing status (spawns reviewer agent).
pub fn start_automated_review(project: &Project, id: &str) -> Result<Task> {
    let store = project.store();
    let task = require_task(project, id)?;

    if task.status != TaskStatus::Working || task.summary.is_none() {
        return Err(OrkestraError::InvalidState {
            expected: "Working with summary set".into(),
            actual: format!("{:?}", task.status),
        });
    }

    store.update_status(id, TaskStatus::Reviewing)?;
    store.update_field(id, "review_feedback", None)?;
    require_task(project, id)
}

/// Reviewer agent approves the implementation → Done.
/// Orchestrator will handle branch integration and cleanup for Done tasks.
pub fn approve_automated_review(project: &Project, id: &str) -> Result<Task> {
    let store = project.store();
    let task = require_task(project, id)?;

    if task.status != TaskStatus::Reviewing {
        return Err(OrkestraError::InvalidState {
            expected: "Reviewing".into(),
            actual: format!("{:?}", task.status),
        });
    }

    let now = chrono::Utc::now().to_rfc3339();
    store.update_status(id, TaskStatus::Done)?;
    store.update_field(id, "completed_at", Some(&now))?;
    store.update_field(id, "reviewer_feedback", None)?;

    require_task(project, id)
}

/// Reviewer agent rejects the implementation → back to Working with feedback.
pub fn reject_automated_review(project: &Project, id: &str, feedback: &str) -> Result<Task> {
    let store = project.store();
    let task = require_task(project, id)?;

    if task.status != TaskStatus::Reviewing {
        return Err(OrkestraError::InvalidState {
            expected: "Reviewing".into(),
            actual: format!("{:?}", task.status),
        });
    }

    store.update_field(id, "summary", None)?;
    store.update_field(id, "reviewer_feedback", Some(feedback))?;
    store.update_status(id, TaskStatus::Working)?;
    require_task(project, id)
}

// =============================================================================
// Misc Settings
// =============================================================================

pub fn set_auto_approve(project: &Project, id: &str, enabled: bool) -> Result<Task> {
    let store = project.store();
    let mut task = require_task(project, id)?;

    task.auto_approve = enabled;
    task.updated_at = chrono::Utc::now().to_rfc3339();
    store.save(&task)?;
    Ok(task)
}

// =============================================================================
// Breakdown / Child Task Management
// =============================================================================

/// Create a child task under a parent task (parallel work, appears in Kanban).
pub fn create_child_task(
    project: &Project,
    parent_id: &str,
    title: &str,
    description: &str,
) -> Result<Task> {
    let store = project.store();
    let parent = require_task(project, parent_id)?;

    if parent.status != TaskStatus::BreakingDown {
        return Err(OrkestraError::InvalidState {
            expected: "BreakingDown".into(),
            actual: format!("{:?}", parent.status),
        });
    }

    let now = chrono::Utc::now().to_rfc3339();
    let task = Task {
        id: store.next_id()?,
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
        branch_name: parent.branch_name.clone(),
        worktree_path: parent.worktree_path.clone(),
        integration_result: None,
    };

    store.save(&task)?;
    Ok(task)
}

/// Create a subtask under a parent task (checklist item, hidden from Kanban).
pub fn create_subtask(
    project: &Project,
    parent_id: &str,
    title: &str,
    description: &str,
) -> Result<Task> {
    let store = project.store();
    let parent = require_task(project, parent_id)?;

    if parent.status != TaskStatus::BreakingDown {
        return Err(OrkestraError::InvalidState {
            expected: "BreakingDown".into(),
            actual: format!("{:?}", parent.status),
        });
    }

    let now = chrono::Utc::now().to_rfc3339();
    let task = Task {
        id: store.next_id()?,
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
        branch_name: parent.branch_name.clone(),
        worktree_path: parent.worktree_path.clone(),
        integration_result: None,
    };

    store.save(&task)?;
    Ok(task)
}

/// Complete a subtask (checklist item). Marks it as Done.
pub fn complete_subtask(project: &Project, id: &str) -> Result<Task> {
    let store = project.store();
    let task = require_task(project, id)?;

    if task.kind != TaskKind::Subtask {
        return Err(OrkestraError::InvalidInput("Task must be a subtask".into()));
    }

    store.update_status(id, TaskStatus::Done)?;
    store.update_field(id, "completed_at", Some(&chrono::Utc::now().to_rfc3339()))?;
    require_task(project, id)
}

pub fn get_subtasks(project: &Project, parent_id: &str) -> Result<Vec<Task>> {
    project.store().get_subtasks(parent_id)
}

pub fn get_child_tasks(project: &Project, parent_id: &str) -> Result<Vec<Task>> {
    project.store().get_child_tasks(parent_id)
}

pub fn set_breakdown(project: &Project, id: &str, breakdown: &str) -> Result<Task> {
    let store = project.store();
    let task = require_task(project, id)?;

    if task.status != TaskStatus::BreakingDown {
        return Err(OrkestraError::InvalidState {
            expected: "BreakingDown".into(),
            actual: format!("{:?}", task.status),
        });
    }

    store.update_field(id, "breakdown", Some(breakdown))?;
    require_task(project, id)
}

/// Approve a breakdown and transition to Working or `WaitingOnSubtasks`.
pub fn approve_breakdown(project: &Project, id: &str) -> Result<Task> {
    let store = project.store();
    let task = require_task(project, id)?;

    if task.status != TaskStatus::BreakingDown || task.breakdown.is_none() {
        return Err(OrkestraError::InvalidState {
            expected: "BreakingDown with breakdown set".into(),
            actual: format!("{:?}", task.status),
        });
    }

    // Check if there are child tasks (not subtasks) - those get parallel workers
    let child_tasks = get_child_tasks(project, id)?;
    let new_status = if child_tasks.is_empty() {
        TaskStatus::Working
    } else {
        TaskStatus::WaitingOnSubtasks
    };

    store.update_status(id, new_status)?;
    store.update_field(id, "breakdown_feedback", None)?;
    require_task(project, id)
}

pub fn request_breakdown_changes(project: &Project, id: &str, feedback: &str) -> Result<Task> {
    let store = project.store();
    let task = require_task(project, id)?;

    if task.status != TaskStatus::BreakingDown || task.breakdown.is_none() {
        return Err(OrkestraError::InvalidState {
            expected: "BreakingDown with breakdown set".into(),
            actual: format!("{:?}", task.status),
        });
    }

    store.update_field(id, "breakdown", None)?;
    store.update_field(id, "breakdown_feedback", Some(feedback))?;
    require_task(project, id)
}

/// Skip breakdown and go directly to Working.
pub fn skip_breakdown(project: &Project, id: &str) -> Result<Task> {
    let store = project.store();
    let task = require_task(project, id)?;

    if task.status != TaskStatus::BreakingDown {
        return Err(OrkestraError::InvalidState {
            expected: "BreakingDown".into(),
            actual: format!("{:?}", task.status),
        });
    }

    store.update_status(id, TaskStatus::Working)?;
    require_task(project, id)
}

/// Get all children of a task.
pub fn get_children(project: &Project, parent_id: &str) -> Result<Vec<Task>> {
    let tasks = load_tasks(project)?;
    Ok(tasks
        .into_iter()
        .filter(|t| t.parent_id.as_deref() == Some(parent_id))
        .collect())
}

/// Delete a task and all its resources (worktree, branch, children).
pub fn delete_task(project: &Project, id: &str) -> Result<()> {
    let store = project.store();
    let task = require_task(project, id)?;

    // Kill agent if running
    if let Some(pid) = task.agent_pid {
        let _ = std::process::Command::new("kill")
            .arg(pid.to_string())
            .output();
    }

    // Recursively delete children first
    let children = get_children(project, id)?;
    for child in children {
        delete_task(project, &child.id)?;
    }

    // Clean up git resources
    if let Some(git) = project.git() {
        let _ = git.remove_worktree(id);
        if let Some(branch) = &task.branch_name {
            let _ = git.delete_branch(branch);
        }
    }

    // Delete from database
    store.delete(id)?;

    Ok(())
}

/// Check if parent should transition based on children states.
pub fn check_parent_completion(project: &Project, parent_id: &str) -> Result<Option<Task>> {
    let store = project.store();
    let mut parent = require_task(project, parent_id)?;

    if parent.status != TaskStatus::WaitingOnSubtasks {
        return Ok(None);
    }

    let children = get_children(project, parent_id)?;
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
        return Ok(Some(block_task(project, parent_id, reason)?));
    }

    // Check if all children are done
    let all_done = children.iter().all(|c| c.status == TaskStatus::Done);
    if all_done {
        let (new_status, integration_result, conflict_msg) = try_integrate(project, &parent);
        let was_merged = matches!(integration_result, Some(IntegrationResult::Merged { .. }));

        parent.status = new_status;
        parent.integration_result = integration_result;
        parent.updated_at = chrono::Utc::now().to_rfc3339();

        if new_status == TaskStatus::Done {
            parent.completed_at = Some(chrono::Utc::now().to_rfc3339());
            parent.summary = Some(format!(
                "All {} subtasks completed successfully",
                children.len()
            ));

            if was_merged {
                store.delete(&parent.id)?;
                return Ok(Some(parent));
            }
        } else {
            parent.summary = None;
            parent.reviewer_feedback = conflict_msg;
        }

        store.save(&parent)?;
        return Ok(Some(parent));
    }

    Ok(None)
}
