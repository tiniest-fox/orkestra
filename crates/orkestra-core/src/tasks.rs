//! Task operations that work with a Project.
//!
//! All functions take a `&Project` reference and use its store and git service.

use crate::error::{OrkestraError, Result};
use crate::ports::TaskStore;
use crate::services::Project;

// Re-export domain types for convenience
pub use crate::domain::{
    BreakdownPlan, IntegrationResult, LogEntry, LoopOutcome, PlanOutcome, PlannedSubtask,
    ReviewOutcome, SessionInfo, Task, TaskKind, TaskStatus, ToolInput, WorkItem, WorkLoop,
    WorkOutcome,
};
use crate::state::TaskPhase;
use std::collections::{HashMap, HashSet, VecDeque};

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
            eprintln!("Warning: Failed to commit pending changes: {e}");
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
            eprintln!("Warning: Failed to integrate task {}: {e}", task.id);
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
/// - If merge conflicts: sets task back to Working with feedback in loop
/// - If task is a child or has no branch: deletes the task (no merge needed)
pub fn integrate_done_task(project: &Project, id: &str) -> Result<()> {
    let task = require_task(project, id)?;
    let store = project.store();

    if task.status != TaskStatus::Done {
        return Err(OrkestraError::InvalidState {
            expected: "Done".into(),
            actual: format!("{:?}", task.status),
        });
    }

    // Check if current loop already has an outcome (shouldn't happen, but be safe)
    if let Some(current_loop) = store.get_current_loop(id)? {
        if current_loop.outcome.is_some() {
            return Ok(()); // Loop already ended, nothing to do
        }
    }

    // Set phase to Integrating while we attempt the merge
    store.update_phase(id, TaskPhase::Integrating)?;

    let (new_status, integration_result, conflict_msg) = try_integrate(project, &task);

    // If merge conflict or error, reopen the task for user to fix
    if new_status == TaskStatus::Working {
        // End current loop with IntegrationFailed, start new loop (for backward compat)
        if let Some(current_loop) = store.get_current_loop(id)? {
            let outcome = match &integration_result {
                Some(IntegrationResult::Conflict { conflict_files }) => {
                    LoopOutcome::IntegrationFailed {
                        error: conflict_msg.clone().unwrap_or_default(),
                        conflict_files: Some(conflict_files.clone()),
                    }
                }
                _ => LoopOutcome::IntegrationFailed {
                    error: conflict_msg
                        .clone()
                        .unwrap_or_else(|| "Unknown error".to_string()),
                    conflict_files: None,
                },
            };
            store.end_loop(id, current_loop.loop_number, &outcome)?;
            store.start_loop(id, TaskStatus::Working)?;
        }

        // End work iteration with IntegrationFailed, start new one
        let work_outcome = match &integration_result {
            Some(IntegrationResult::Conflict { conflict_files }) => WorkOutcome::IntegrationFailed {
                error: conflict_msg.clone().unwrap_or_default(),
                conflict_files: Some(conflict_files.clone()),
            },
            _ => WorkOutcome::IntegrationFailed {
                error: conflict_msg
                    .clone()
                    .unwrap_or_else(|| "Unknown error".to_string()),
                conflict_files: None,
            },
        };
        let _ = store.end_work_iteration(id, &work_outcome);
        store.start_work_iteration(id)?;

        store.update_status(id, TaskStatus::Working)?;
        store.update_field(id, "summary", None)?; // Clear summary to reopen
        store.update_field(id, "completed_at", None)?;
        // Reset phase to Idle so orchestrator will spawn worker to resolve conflict
        store.update_phase(id, TaskPhase::Idle)?;
        // Conflict info is stored in the loop/iteration outcome, not on the task
        return Ok(());
    }

    // Successfully integrated - end loop with Completed (including merge details)
    if let Some(current_loop) = store.get_current_loop(id)? {
        let outcome = match &integration_result {
            Some(IntegrationResult::Merged {
                merged_at,
                commit_sha,
                target_branch,
            }) => LoopOutcome::Completed {
                merged_at: Some(merged_at.clone()),
                commit_sha: Some(commit_sha.clone()),
                target_branch: Some(target_branch.clone()),
            },
            _ => LoopOutcome::Completed {
                merged_at: None,
                commit_sha: None,
                target_branch: None,
            },
        };
        store.end_loop(id, current_loop.loop_number, &outcome)?;
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

pub fn create_task(project: &Project, title: Option<&str>, description: &str) -> Result<Task> {
    create_task_with_options(project, title, description, false, None)
}

pub fn create_task_with_options(
    project: &Project,
    title: Option<&str>,
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
                eprintln!("Warning: Failed to create worktree for task {id}: {e}");
                (None, None)
            }
        }
    } else {
        (None, None)
    };

    let task = Task {
        id,
        title: title.map(String::from),
        description: description.to_string(),
        status: TaskStatus::Planning,
        phase: TaskPhase::Idle,
        kind: TaskKind::Task,
        created_at: now.clone(),
        updated_at: now,
        completed_at: None,
        summary: None,
        error: None,
        plan: None,
        sessions: None,
        auto_approve,
        parent_id: None,
        breakdown: None,
        skip_breakdown: false,
        agent_pid: None,
        branch_name,
        worktree_path,
        depends_on: Vec::new(),
        work_items: Vec::new(),
        assigned_worker_task_id: None,
    };

    store.save(&task)?;

    // Start Loop 1 for new task
    store.start_loop(&task.id, TaskStatus::Planning)?;

    // Start first plan iteration
    store.start_plan_iteration(&task.id)?;

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
/// Sets summary on both the Task (for backward compat) and current WorkIteration.
pub fn complete_task(project: &Project, id: &str, summary: &str) -> Result<Task> {
    let store = project.store();

    // Set on Task for backward compatibility
    store.update_field(id, "summary", Some(summary))?;

    // Set on current work iteration (if exists)
    // Ignore error if no active iteration - task may not have been migrated yet
    let _ = store.set_iteration_summary(id, summary);

    // Set phase to AwaitingReview since work output is ready
    store.update_phase(id, TaskPhase::AwaitingReview)?;

    require_task(project, id)
}

pub fn fail_task(project: &Project, id: &str, reason: &str) -> Result<Task> {
    let store = project.store();
    store.update_status(id, TaskStatus::Failed)?;
    store.update_field(id, "error", Some(reason))?;
    // Reset phase to Idle for terminal state
    store.update_phase(id, TaskPhase::Idle)?;
    require_task(project, id)
}

pub fn block_task(project: &Project, id: &str, reason: &str) -> Result<Task> {
    let store = project.store();
    store.update_status(id, TaskStatus::Blocked)?;
    store.update_field(id, "error", Some(reason))?;
    // Reset phase to Idle for terminal state
    store.update_phase(id, TaskPhase::Idle)?;
    require_task(project, id)
}

// =============================================================================
// Agent/Session Management
// =============================================================================

/// Set or clear the `agent_pid` on a task.
pub fn set_agent_pid(project: &Project, id: &str, pid: Option<u32>) -> Result<()> {
    project.store().update_agent_pid(id, pid)
}

/// Set the phase on a task.
pub fn set_phase(project: &Project, id: &str, phase: TaskPhase) -> Result<()> {
    project.store().update_phase(id, phase)
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

/// Set the plan for a task.
/// Sets plan on both the Task (for backward compat) and current PlanIteration.
pub fn set_task_plan(project: &Project, id: &str, plan: &str) -> Result<Task> {
    let store = project.store();

    // Set on Task for backward compatibility
    store.update_field(id, "plan", Some(plan))?;

    // Set on current plan iteration (if exists)
    // Ignore error if no active iteration - task may not have been migrated yet
    let _ = store.set_iteration_plan(id, plan);

    // Set phase to AwaitingReview since plan output is ready
    store.update_phase(id, TaskPhase::AwaitingReview)?;

    require_task(project, id)
}

/// Set the title for a task (used for async title generation).
pub fn set_task_title(project: &Project, id: &str, title: &str) -> Result<Task> {
    project.store().update_field(id, "title", Some(title))?;
    require_task(project, id)
}

/// Update the title for a task by ID (async title generation).
pub fn update_task_title(project: &Project, id: &str, title: &str) -> Result<()> {
    project.store().update_field(id, "title", Some(title))?;
    Ok(())
}

/// Approve a task's plan. Transitions to `BreakingDown` or Working based on `skip_breakdown`.
/// Ends the current PlanIteration with Approved and starts a WorkIteration if going to Working.
pub fn approve_task_plan(project: &Project, id: &str) -> Result<Task> {
    let store = project.store();
    let task = require_task(project, id)?;

    if task.status != TaskStatus::Planning || task.plan.is_none() {
        return Err(OrkestraError::InvalidState {
            expected: "Planning with plan set".into(),
            actual: format!("{:?}", task.status),
        });
    }

    // End plan iteration with Approved
    let _ = store.end_plan_iteration(id, &PlanOutcome::Approved);

    let new_status = if task.skip_breakdown {
        TaskStatus::Working
    } else {
        TaskStatus::BreakingDown
    };

    store.update_status(id, new_status)?;

    // Reset phase to Idle - agent will be spawned by orchestrator
    store.update_phase(id, TaskPhase::Idle)?;

    // If going to Working, start a work iteration
    if new_status == TaskStatus::Working {
        store.start_work_iteration(id)?;
    }

    require_task(project, id)
}

/// Request changes to a task's plan. Ends current PlanIteration with Rejected, starts new one.
pub fn request_plan_changes(project: &Project, id: &str, feedback: &str) -> Result<Task> {
    let store = project.store();
    let task = require_task(project, id)?;

    if task.status != TaskStatus::Planning || task.plan.is_none() {
        return Err(OrkestraError::InvalidState {
            expected: "Planning with plan set".into(),
            actual: format!("{:?}", task.status),
        });
    }

    // End current loop with PlanRejected, start new loop (for backward compat)
    if let Some(current_loop) = store.get_current_loop(id)? {
        let outcome = LoopOutcome::PlanRejected {
            feedback: feedback.to_string(),
        };
        store.end_loop(id, current_loop.loop_number, &outcome)?;
        store.start_loop(id, TaskStatus::Planning)?;
    }

    // End plan iteration with Rejected, start new one
    let _ = store.end_plan_iteration(
        id,
        &PlanOutcome::Rejected {
            feedback: feedback.to_string(),
        },
    );
    store.start_plan_iteration(id)?;

    store.update_field(id, "plan", None)?;

    // Reset phase to Idle - agent will be spawned by orchestrator for revision
    store.update_phase(id, TaskPhase::Idle)?;

    // Feedback is stored in the loop/iteration outcome, not on the task
    require_task(project, id)
}

// =============================================================================
// Review Management
// =============================================================================

/// Request changes to a task's work. Ends current WorkIteration with Rejected, starts new one.
pub fn request_review_changes(project: &Project, id: &str, feedback: &str) -> Result<Task> {
    let store = project.store();
    let task = require_task(project, id)?;

    if task.status != TaskStatus::Working || task.summary.is_none() {
        return Err(OrkestraError::InvalidState {
            expected: "Working with summary set".into(),
            actual: format!("{:?}", task.status),
        });
    }

    // End current loop with WorkRejected, start new loop (for backward compat)
    if let Some(current_loop) = store.get_current_loop(id)? {
        let outcome = LoopOutcome::WorkRejected {
            feedback: feedback.to_string(),
        };
        store.end_loop(id, current_loop.loop_number, &outcome)?;
        store.start_loop(id, TaskStatus::Working)?;
    }

    // End work iteration with Rejected, start new one
    let _ = store.end_work_iteration(
        id,
        &WorkOutcome::Rejected {
            feedback: feedback.to_string(),
        },
    );
    store.start_work_iteration(id)?;

    store.update_field(id, "summary", None)?;

    // Reset phase to Idle - agent will be spawned by orchestrator for revision
    store.update_phase(id, TaskPhase::Idle)?;

    // Feedback is stored in the loop/iteration outcome, not on the task
    require_task(project, id)
}

/// Approve work review and transition to Done.
/// Orchestrator will handle branch integration and cleanup for Done tasks.
/// Ends current WorkIteration with Approved.
pub fn approve_review(project: &Project, id: &str) -> Result<Task> {
    let store = project.store();
    let task = require_task(project, id)?;

    if task.status != TaskStatus::Working || task.summary.is_none() {
        return Err(OrkestraError::InvalidState {
            expected: "Working with summary set".into(),
            actual: format!("{:?}", task.status),
        });
    }

    // End work iteration with Approved
    let _ = store.end_work_iteration(id, &WorkOutcome::Approved);

    let now = chrono::Utc::now().to_rfc3339();
    store.update_status(id, TaskStatus::Done)?;
    store.update_field(id, "completed_at", Some(&now))?;
    // Note: Integration status is tracked in WorkLoop/iteration outcomes, not on Task

    // Reset phase to Idle for terminal state (integration happens separately)
    store.update_phase(id, TaskPhase::Idle)?;

    require_task(project, id)
}

/// Transition task to Reviewing status (spawns reviewer agent).
/// Ends current WorkIteration with SentToReview and starts a ReviewIteration.
pub fn start_automated_review(project: &Project, id: &str) -> Result<Task> {
    let store = project.store();
    let task = require_task(project, id)?;

    if task.status != TaskStatus::Working || task.summary.is_none() {
        return Err(OrkestraError::InvalidState {
            expected: "Working with summary set".into(),
            actual: format!("{:?}", task.status),
        });
    }

    // End work iteration with SentToReview
    let _ = store.end_work_iteration(id, &WorkOutcome::SentToReview);

    // Start a review iteration
    store.start_review_iteration(id)?;

    store.update_status(id, TaskStatus::Reviewing)?;

    // Reset phase to Idle - reviewer agent will be spawned by orchestrator
    store.update_phase(id, TaskPhase::Idle)?;

    require_task(project, id)
}

/// Reviewer agent approves the implementation → Done.
/// Orchestrator will handle branch integration and cleanup for Done tasks.
/// Ends current ReviewIteration with Approved.
pub fn approve_automated_review(project: &Project, id: &str) -> Result<Task> {
    let store = project.store();
    let task = require_task(project, id)?;

    if task.status != TaskStatus::Reviewing {
        return Err(OrkestraError::InvalidState {
            expected: "Reviewing".into(),
            actual: format!("{:?}", task.status),
        });
    }

    // End review iteration with Approved
    let _ = store.end_review_iteration(id, &ReviewOutcome::Approved);

    let now = chrono::Utc::now().to_rfc3339();
    store.update_status(id, TaskStatus::Done)?;
    store.update_field(id, "completed_at", Some(&now))?;
    // Note: feedback is in WorkLoop/iteration outcomes, no need to clear

    // Reset phase to Idle for terminal state (integration happens separately)
    store.update_phase(id, TaskPhase::Idle)?;

    require_task(project, id)
}

/// Reviewer agent rejects the implementation → back to Working with feedback.
/// Ends current ReviewIteration with Rejected, starts new WorkIteration.
pub fn reject_automated_review(project: &Project, id: &str, feedback: &str) -> Result<Task> {
    let store = project.store();
    let task = require_task(project, id)?;

    if task.status != TaskStatus::Reviewing {
        return Err(OrkestraError::InvalidState {
            expected: "Reviewing".into(),
            actual: format!("{:?}", task.status),
        });
    }

    // End current loop with ReviewerRejected, start new loop (for backward compat)
    if let Some(current_loop) = store.get_current_loop(id)? {
        let outcome = LoopOutcome::ReviewerRejected {
            feedback: feedback.to_string(),
        };
        store.end_loop(id, current_loop.loop_number, &outcome)?;
        store.start_loop(id, TaskStatus::Working)?;
    }

    // End review iteration with Rejected
    let _ = store.end_review_iteration(
        id,
        &ReviewOutcome::Rejected {
            feedback: feedback.to_string(),
        },
    );

    // Start a new work iteration for the worker to fix the issues
    store.start_work_iteration(id)?;

    store.update_field(id, "summary", None)?;
    // Feedback is stored in the loop/iteration outcome, not on the task
    store.update_status(id, TaskStatus::Working)?;

    // Reset phase to Idle - worker agent will be spawned by orchestrator for revision
    store.update_phase(id, TaskPhase::Idle)?;

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
        title: Some(title.to_string()),
        description: description.to_string(),
        status: TaskStatus::Working,
        phase: TaskPhase::Idle,
        kind: TaskKind::Task,
        created_at: now.clone(),
        updated_at: now,
        completed_at: None,
        summary: None,
        error: None,
        plan: parent.plan.clone(),
        sessions: None,
        auto_approve: false,
        parent_id: Some(parent_id.to_string()),
        breakdown: None,
        skip_breakdown: true,
        agent_pid: None,
        branch_name: parent.branch_name.clone(),
        worktree_path: parent.worktree_path.clone(),
        depends_on: Vec::new(),
        work_items: Vec::new(),
        assigned_worker_task_id: None,
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
        title: Some(title.to_string()),
        description: description.to_string(),
        status: TaskStatus::Working,
        phase: TaskPhase::Idle,
        kind: TaskKind::Subtask,
        created_at: now.clone(),
        updated_at: now,
        completed_at: None,
        summary: None,
        error: None,
        plan: parent.plan.clone(),
        sessions: None,
        auto_approve: false,
        parent_id: Some(parent_id.to_string()),
        breakdown: None,
        skip_breakdown: true,
        agent_pid: None,
        branch_name: parent.branch_name.clone(),
        worktree_path: parent.worktree_path.clone(),
        depends_on: Vec::new(),
        work_items: Vec::new(),
        assigned_worker_task_id: None,
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

    // Set phase to AwaitingReview since breakdown output is ready
    store.update_phase(id, TaskPhase::AwaitingReview)?;

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
    // Note: feedback is in WorkLoop outcomes, no need to clear

    // Reset phase to Idle - agent will be spawned by orchestrator
    store.update_phase(id, TaskPhase::Idle)?;

    // If going to Working, start a work iteration
    if new_status == TaskStatus::Working {
        store.start_work_iteration(id)?;
    }

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

    // End current loop with BreakdownRejected, start new loop
    if let Some(current_loop) = store.get_current_loop(id)? {
        let outcome = LoopOutcome::BreakdownRejected {
            feedback: feedback.to_string(),
        };
        store.end_loop(id, current_loop.loop_number, &outcome)?;
        store.start_loop(id, TaskStatus::BreakingDown)?;
    }

    store.update_field(id, "breakdown", None)?;
    // Feedback is stored in the loop outcome, not on the task

    // Reset phase to Idle - agent will be spawned by orchestrator for revision
    store.update_phase(id, TaskPhase::Idle)?;

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

    // Reset phase to Idle - agent will be spawned by orchestrator
    store.update_phase(id, TaskPhase::Idle)?;

    // Start a work iteration
    store.start_work_iteration(id)?;

    require_task(project, id)
}

// =============================================================================
// Plan-Based Breakdown (New System)
// =============================================================================

/// Set a structured breakdown plan on a task.
/// The plan is stored as JSON in the `breakdown` field.
pub fn set_breakdown_plan(project: &Project, id: &str, plan: &BreakdownPlan) -> Result<Task> {
    let store = project.store();
    let task = require_task(project, id)?;

    if task.status != TaskStatus::BreakingDown {
        return Err(OrkestraError::InvalidState {
            expected: "BreakingDown".into(),
            actual: format!("{:?}", task.status),
        });
    }

    let json = serde_json::to_string(plan)?;

    store.update_field(id, "breakdown", Some(&json))?;

    // Set phase to AwaitingReview since breakdown plan is ready
    store.update_phase(id, TaskPhase::AwaitingReview)?;

    require_task(project, id)
}

/// Get the breakdown plan from a task (if it's a structured JSON plan).
pub fn get_breakdown_plan(project: &Project, id: &str) -> Result<Option<BreakdownPlan>> {
    let task = require_task(project, id)?;

    match &task.breakdown {
        Some(json) => {
            let plan: BreakdownPlan = serde_json::from_str(json)?;
            Ok(Some(plan))
        }
        None => Ok(None),
    }
}

/// Approve a breakdown plan and create subtasks from it.
/// This is the new plan-first workflow where subtasks are created AFTER approval.
pub fn approve_breakdown_plan(project: &Project, id: &str) -> Result<Task> {
    let store = project.store();
    let task = require_task(project, id)?;

    if task.status != TaskStatus::BreakingDown || task.breakdown.is_none() {
        return Err(OrkestraError::InvalidState {
            expected: "BreakingDown with breakdown set".into(),
            actual: format!("{:?}", task.status),
        });
    }

    // Parse the breakdown plan
    let plan = get_breakdown_plan(project, id)?.ok_or_else(|| OrkestraError::InvalidState {
        expected: "Valid breakdown plan JSON".into(),
        actual: "Could not parse breakdown".into(),
    })?;

    // If skip_breakdown is recommended, go directly to Working
    if plan.skip_breakdown || plan.subtasks.is_empty() {
        return skip_breakdown(project, id);
    }

    // Topologically sort subtasks by dependencies
    let sorted = topological_sort(&plan.subtasks)?;

    // Create subtasks in dependency order, mapping temp_id -> real_id
    let mut id_map: HashMap<String, String> = HashMap::new();

    for planned in sorted {
        // Map temp_id dependencies to real IDs
        let real_depends_on: Vec<String> = planned
            .depends_on
            .iter()
            .filter_map(|temp| id_map.get(temp).cloned())
            .collect();

        let subtask = create_subtask_from_plan(project, id, planned, real_depends_on)?;
        id_map.insert(planned.temp_id.clone(), subtask.id);
    }

    // Transition parent to WaitingOnSubtasks
    store.update_status(id, TaskStatus::WaitingOnSubtasks)?;
    store.update_phase(id, TaskPhase::Idle)?;

    require_task(project, id)
}

/// Create a subtask from a planned subtask (internal, called during plan approval).
fn create_subtask_from_plan(
    project: &Project,
    parent_id: &str,
    planned: &PlannedSubtask,
    depends_on: Vec<String>,
) -> Result<Task> {
    let store = project.store();
    let parent = require_task(project, parent_id)?;
    let now = chrono::Utc::now().to_rfc3339();

    // Convert planned work items to work items
    let work_items: Vec<WorkItem> = planned.work_items.iter().map(WorkItem::from).collect();

    let task = Task {
        id: store.next_id()?,
        title: Some(planned.title.clone()),
        description: planned.description.clone(),
        // Subtasks start in Working - they don't need their own planning phase
        status: TaskStatus::Working,
        phase: TaskPhase::Idle,
        kind: TaskKind::Subtask,
        created_at: now.clone(),
        updated_at: now,
        completed_at: None,
        summary: None,
        error: None,
        plan: parent.plan.clone(), // Inherit parent's plan
        sessions: None,
        auto_approve: false,
        parent_id: Some(parent_id.to_string()),
        breakdown: None,
        skip_breakdown: true, // Subtasks don't get broken down further
        agent_pid: None,
        branch_name: parent.branch_name.clone(),
        worktree_path: parent.worktree_path.clone(),
        depends_on,
        work_items,
        assigned_worker_task_id: None, // Set by orchestrator when assigning worker
    };

    store.save(&task)?;

    // Start Loop 1 for new subtask (subtasks start in Working, so use Working status)
    store.start_loop(&task.id, TaskStatus::Working)?;

    // Start first work iteration (subtasks skip planning phase)
    store.start_work_iteration(&task.id)?;

    Ok(task)
}

/// Topologically sort planned subtasks by dependencies using Kahn's algorithm.
/// Returns an error if a cycle is detected or if a dependency references a non-existent subtask.
fn topological_sort(subtasks: &[PlannedSubtask]) -> Result<Vec<&PlannedSubtask>> {
    let mut in_degree: HashMap<&str, usize> = HashMap::new();
    let mut graph: HashMap<&str, Vec<&str>> = HashMap::new();

    // Collect all valid temp_ids for validation
    let valid_ids: HashSet<&str> = subtasks.iter().map(|st| st.temp_id.as_str()).collect();

    // Initialize in-degree for all nodes and validate dependencies
    for st in subtasks {
        in_degree.entry(&st.temp_id).or_insert(0);
        for dep in &st.depends_on {
            // Validate that the dependency exists
            if !valid_ids.contains(dep.as_str()) {
                return Err(OrkestraError::InvalidInput(format!(
                    "Subtask '{}' depends on '{}' which does not exist",
                    st.temp_id, dep
                )));
            }
            graph.entry(dep.as_str()).or_default().push(&st.temp_id);
            *in_degree.entry(&st.temp_id).or_insert(0) += 1;
        }
    }

    // Find all nodes with no incoming edges
    let mut queue: VecDeque<&str> = in_degree
        .iter()
        .filter(|(_, &deg)| deg == 0)
        .map(|(&id, _)| id)
        .collect();

    let mut result: Vec<&PlannedSubtask> = Vec::new();
    let id_to_subtask: HashMap<&str, &PlannedSubtask> =
        subtasks.iter().map(|st| (st.temp_id.as_str(), st)).collect();

    while let Some(id) = queue.pop_front() {
        if let Some(&subtask) = id_to_subtask.get(id) {
            result.push(subtask);
        }

        if let Some(neighbors) = graph.get(id) {
            for &neighbor in neighbors {
                if let Some(deg) = in_degree.get_mut(neighbor) {
                    *deg -= 1;
                    if *deg == 0 {
                        queue.push_back(neighbor);
                    }
                }
            }
        }
    }

    if result.len() != subtasks.len() {
        return Err(OrkestraError::InvalidInput(
            "Circular dependency detected in subtask plan".into(),
        ));
    }

    Ok(result)
}

/// Get subtasks that are ready to work (all dependencies are satisfied).
/// A subtask is ready when all its dependencies are in Done status.
pub fn get_ready_subtasks(project: &Project, parent_id: &str) -> Result<Vec<Task>> {
    let subtasks = get_subtasks(project, parent_id)?;

    // Collect IDs of completed subtasks (owned strings to avoid borrow issues)
    let done_ids: HashSet<String> = subtasks
        .iter()
        .filter(|t| t.status == TaskStatus::Done)
        .map(|t| t.id.clone())
        .collect();

    // Filter to subtasks that are not done and have all dependencies satisfied
    Ok(subtasks
        .into_iter()
        .filter(|t| {
            t.status != TaskStatus::Done
                && t.depends_on.iter().all(|dep| done_ids.contains(dep))
        })
        .collect())
}

/// Toggle a work item's done status.
pub fn toggle_work_item(project: &Project, subtask_id: &str, item_index: usize) -> Result<Task> {
    let store = project.store();
    let mut task = require_task(project, subtask_id)?;

    if task.kind != TaskKind::Subtask {
        return Err(OrkestraError::InvalidInput(
            "Work items can only be toggled on subtasks".into(),
        ));
    }

    if item_index >= task.work_items.len() {
        return Err(OrkestraError::InvalidInput(format!(
            "Work item index {} out of bounds (task has {} items)",
            item_index,
            task.work_items.len()
        )));
    }

    task.work_items[item_index].done = !task.work_items[item_index].done;
    task.updated_at = chrono::Utc::now().to_rfc3339();

    store.save(&task)?;
    Ok(task)
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
        parent.updated_at = chrono::Utc::now().to_rfc3339();

        if new_status == TaskStatus::Done {
            parent.completed_at = Some(chrono::Utc::now().to_rfc3339());
            parent.summary = Some(format!(
                "All {} subtasks completed successfully",
                children.len()
            ));

            // End loop with Completed outcome
            if let Some(current_loop) = store.get_current_loop(&parent.id)? {
                let outcome = match &integration_result {
                    Some(IntegrationResult::Merged {
                        merged_at,
                        commit_sha,
                        target_branch,
                    }) => LoopOutcome::Completed {
                        merged_at: Some(merged_at.clone()),
                        commit_sha: Some(commit_sha.clone()),
                        target_branch: Some(target_branch.clone()),
                    },
                    _ => LoopOutcome::Completed {
                        merged_at: None,
                        commit_sha: None,
                        target_branch: None,
                    },
                };
                store.end_loop(&parent.id, current_loop.loop_number, &outcome)?;
            }

            if was_merged {
                store.delete(&parent.id)?;
                return Ok(Some(parent));
            }
        } else {
            parent.summary = None;

            // End current loop with IntegrationFailed, start new loop
            if let Some(current_loop) = store.get_current_loop(&parent.id)? {
                let outcome = match &integration_result {
                    Some(IntegrationResult::Conflict { conflict_files }) => {
                        LoopOutcome::IntegrationFailed {
                            error: conflict_msg.clone().unwrap_or_default(),
                            conflict_files: Some(conflict_files.clone()),
                        }
                    }
                    _ => LoopOutcome::IntegrationFailed {
                        error: conflict_msg.unwrap_or_else(|| "Unknown error".to_string()),
                        conflict_files: None,
                    },
                };
                store.end_loop(&parent.id, current_loop.loop_number, &outcome)?;
                store.start_loop(&parent.id, TaskStatus::Working)?;
            }
        }

        store.save(&parent)?;
        return Ok(Some(parent));
    }

    Ok(None)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::domain::{PlannedSubtask, PlannedWorkItem, SubtaskComplexity};

    fn make_subtask(temp_id: &str, depends_on: Vec<&str>) -> PlannedSubtask {
        PlannedSubtask {
            temp_id: temp_id.to_string(),
            title: format!("Subtask {temp_id}"),
            description: "Test subtask".to_string(),
            complexity: SubtaskComplexity::Small,
            depends_on: depends_on.into_iter().map(String::from).collect(),
            work_items: vec![PlannedWorkItem {
                title: "Work item".to_string(),
            }],
        }
    }

    #[test]
    fn test_topological_sort_empty() {
        let subtasks: Vec<PlannedSubtask> = vec![];
        let result = topological_sort(&subtasks).unwrap();
        assert!(result.is_empty());
    }

    #[test]
    fn test_topological_sort_single_no_deps() {
        let subtasks = vec![make_subtask("st1", vec![])];
        let result = topological_sort(&subtasks).unwrap();
        assert_eq!(result.len(), 1);
        assert_eq!(result[0].temp_id, "st1");
    }

    #[test]
    fn test_topological_sort_linear_chain() {
        // st1 -> st2 -> st3
        let subtasks = vec![
            make_subtask("st1", vec![]),
            make_subtask("st2", vec!["st1"]),
            make_subtask("st3", vec!["st2"]),
        ];
        let result = topological_sort(&subtasks).unwrap();
        assert_eq!(result.len(), 3);
        // st1 must come before st2, st2 must come before st3
        let pos: HashMap<&str, usize> = result
            .iter()
            .enumerate()
            .map(|(i, st)| (st.temp_id.as_str(), i))
            .collect();
        assert!(pos["st1"] < pos["st2"]);
        assert!(pos["st2"] < pos["st3"]);
    }

    #[test]
    fn test_topological_sort_fan_out() {
        // st1 -> st2, st1 -> st3
        let subtasks = vec![
            make_subtask("st1", vec![]),
            make_subtask("st2", vec!["st1"]),
            make_subtask("st3", vec!["st1"]),
        ];
        let result = topological_sort(&subtasks).unwrap();
        assert_eq!(result.len(), 3);
        let pos: HashMap<&str, usize> = result
            .iter()
            .enumerate()
            .map(|(i, st)| (st.temp_id.as_str(), i))
            .collect();
        assert!(pos["st1"] < pos["st2"]);
        assert!(pos["st1"] < pos["st3"]);
    }

    #[test]
    fn test_topological_sort_fan_in() {
        // st1 -> st3, st2 -> st3
        let subtasks = vec![
            make_subtask("st1", vec![]),
            make_subtask("st2", vec![]),
            make_subtask("st3", vec!["st1", "st2"]),
        ];
        let result = topological_sort(&subtasks).unwrap();
        assert_eq!(result.len(), 3);
        let pos: HashMap<&str, usize> = result
            .iter()
            .enumerate()
            .map(|(i, st)| (st.temp_id.as_str(), i))
            .collect();
        assert!(pos["st1"] < pos["st3"]);
        assert!(pos["st2"] < pos["st3"]);
    }

    #[test]
    fn test_topological_sort_cycle_detection() {
        // st1 -> st2 -> st1 (cycle)
        let subtasks = vec![
            make_subtask("st1", vec!["st2"]),
            make_subtask("st2", vec!["st1"]),
        ];
        let result = topological_sort(&subtasks);
        assert!(result.is_err());
        assert!(result
            .unwrap_err()
            .to_string()
            .contains("Circular dependency"));
    }

    #[test]
    fn test_topological_sort_self_reference() {
        // st1 depends on itself
        let subtasks = vec![make_subtask("st1", vec!["st1"])];
        let result = topological_sort(&subtasks);
        assert!(result.is_err());
        assert!(result
            .unwrap_err()
            .to_string()
            .contains("Circular dependency"));
    }

    #[test]
    fn test_topological_sort_missing_dependency() {
        // st2 depends on non-existent st_missing
        let subtasks = vec![
            make_subtask("st1", vec![]),
            make_subtask("st2", vec!["st_missing"]),
        ];
        let result = topological_sort(&subtasks);
        assert!(result.is_err());
        assert!(result.unwrap_err().to_string().contains("does not exist"));
    }

    #[test]
    fn test_topological_sort_complex_dag() {
        // Complex DAG:
        //   st1 -> st2 -> st4
        //   st1 -> st3 -> st4
        //   st2 -> st5
        let subtasks = vec![
            make_subtask("st1", vec![]),
            make_subtask("st2", vec!["st1"]),
            make_subtask("st3", vec!["st1"]),
            make_subtask("st4", vec!["st2", "st3"]),
            make_subtask("st5", vec!["st2"]),
        ];
        let result = topological_sort(&subtasks).unwrap();
        assert_eq!(result.len(), 5);
        let pos: HashMap<&str, usize> = result
            .iter()
            .enumerate()
            .map(|(i, st)| (st.temp_id.as_str(), i))
            .collect();
        // Verify all dependency constraints
        assert!(pos["st1"] < pos["st2"]);
        assert!(pos["st1"] < pos["st3"]);
        assert!(pos["st2"] < pos["st4"]);
        assert!(pos["st3"] < pos["st4"]);
        assert!(pos["st2"] < pos["st5"]);
    }
}
