//! Human action commands: approve, reject, answer questions.

use crate::{error::TauriError, project_registry::ProjectRegistry};
use orkestra_core::orkestra_debug;
use orkestra_core::workflow::{
    spawn_merge_integration, spawn_pr_creation, PrCheckData, PrCommentData, QuestionAnswer, Task,
};
use tauri::{Emitter, State, Window};

/// Approve the current stage artifact.
///
/// Moves the task to the next stage (or Done if this was the last stage).
#[tauri::command]
pub fn workflow_approve(
    registry: State<ProjectRegistry>,
    window: Window,
    task_id: String,
) -> Result<Task, TauriError> {
    orkestra_debug!("tauri", "approve {task_id}");
    registry.with_project(window.label(), |state| {
        state.api()?.approve(&task_id).map_err(Into::into)
    })
}

/// Reject the current stage artifact with feedback.
///
/// Creates a new iteration in the same stage so the agent can retry.
#[tauri::command]
pub fn workflow_reject(
    registry: State<ProjectRegistry>,
    window: Window,
    task_id: String,
    feedback: String,
) -> Result<Task, TauriError> {
    orkestra_debug!("tauri", "reject {task_id}");
    registry.with_project(window.label(), |state| {
        state.api()?.reject(&task_id, &feedback).map_err(Into::into)
    })
}

/// Answer pending questions from the agent.
///
/// Clears the pending questions and resumes the task.
#[tauri::command]
pub fn workflow_answer_questions(
    registry: State<ProjectRegistry>,
    window: Window,
    task_id: String,
    answers: Vec<QuestionAnswer>,
) -> Result<Task, TauriError> {
    orkestra_debug!(
        "tauri",
        "answer_questions {task_id}: {} answers",
        answers.len()
    );
    registry.with_project(window.label(), |state| {
        state
            .api()?
            .answer_questions(&task_id, answers)
            .map_err(Into::into)
    })
}

/// Retry a failed task by resuming from its last active stage.
///
/// Assumes the underlying issue has been resolved.
#[tauri::command]
pub fn workflow_retry(
    registry: State<ProjectRegistry>,
    window: Window,
    task_id: String,
    instructions: Option<String>,
) -> Result<Task, TauriError> {
    orkestra_debug!("tauri", "retry {task_id}");
    registry.with_project(window.label(), |state| {
        state
            .api()?
            .retry(&task_id, instructions.as_deref())
            .map_err(Into::into)
    })
}

/// Set the `auto_mode` flag on a task.
///
/// When enabling auto mode on a task that is awaiting review,
/// immediately auto-approves or auto-answers pending questions.
#[tauri::command]
pub fn workflow_set_auto_mode(
    registry: State<ProjectRegistry>,
    window: Window,
    task_id: String,
    auto_mode: bool,
) -> Result<Task, TauriError> {
    orkestra_debug!("tauri", "set_auto_mode {task_id}: {auto_mode}");
    registry.with_project(window.label(), |state| {
        state
            .api()?
            .set_auto_mode(&task_id, auto_mode)
            .map_err(Into::into)
    })
}

/// Interrupt a running agent execution.
///
/// Kills the agent process immediately and transitions to Interrupted phase.
#[tauri::command]
pub fn workflow_interrupt(
    registry: State<ProjectRegistry>,
    window: Window,
    task_id: String,
) -> Result<Task, TauriError> {
    orkestra_debug!("tauri", "interrupt {task_id}");
    registry.with_project(window.label(), |state| {
        state.api()?.interrupt(&task_id).map_err(Into::into)
    })
}

/// Resume an interrupted task with an optional message.
///
/// Creates a new iteration and sets the task to Idle for the orchestrator.
#[tauri::command]
pub fn workflow_resume(
    registry: State<ProjectRegistry>,
    window: Window,
    task_id: String,
    message: Option<String>,
) -> Result<Task, TauriError> {
    orkestra_debug!("tauri", "resume {task_id}");
    registry.with_project(window.label(), |state| {
        state.api()?.resume(&task_id, message).map_err(Into::into)
    })
}

/// Merge a Done task's branch into its base branch.
///
/// Validates and marks the task as Integrating, then spawns the git work
/// (squash, rebase, merge) on a background thread so the UI is not blocked.
#[tauri::command]
pub fn workflow_merge_task(
    registry: State<ProjectRegistry>,
    window: Window,
    task_id: String,
) -> Result<Task, TauriError> {
    orkestra_debug!("tauri", "merge_task {task_id}");
    let notify_window = window.clone();
    let notify_task_id = task_id.clone();
    let on_complete = move || {
        let _ = notify_window.emit("task-updated", notify_task_id.clone());
    };
    registry.with_project(window.label(), |state| {
        spawn_merge_integration(state.api_arc(), &task_id, on_complete).map_err(Into::into)
    })
}

/// Create a pull request for a Done task's branch.
///
/// Validates and marks the task as Integrating, then spawns PR creation
/// (commit, push, gh pr create) on a background thread so the UI is not blocked.
#[tauri::command]
pub fn workflow_open_pr(
    registry: State<ProjectRegistry>,
    window: Window,
    task_id: String,
) -> Result<Task, TauriError> {
    orkestra_debug!("tauri", "open_pr {task_id}");
    registry.with_project(window.label(), |state| {
        spawn_pr_creation(state.api_arc(), &task_id).map_err(Into::into)
    })
}

/// Retry PR creation by recovering from Failed to Done+Idle.
///
/// Clears the error state so the user can attempt PR creation again.
#[tauri::command]
pub fn workflow_retry_pr(
    registry: State<ProjectRegistry>,
    window: Window,
    task_id: String,
) -> Result<Task, TauriError> {
    registry.with_project(window.label(), |state| {
        state.api()?.retry_pr_creation(&task_id).map_err(Into::into)
    })
}

/// Push updated changes to the existing PR for a Done task.
///
/// Commits any pending worktree changes and pushes the task's branch to origin.
/// Requires the task to be Done with an open PR.
#[tauri::command]
pub fn workflow_push_pr_changes(
    registry: State<ProjectRegistry>,
    window: Window,
    task_id: String,
) -> Result<Task, TauriError> {
    orkestra_debug!("tauri", "push_pr_changes {task_id}");
    registry.with_project(window.label(), |state| {
        state
            .api()?
            .commit_and_push_pr_changes(&task_id)
            .map_err(Into::into)
    })
}

/// Pull remote changes into the local worktree for a Done task with an open PR.
///
/// Fetches and fast-forwards the task's branch from origin so the local
/// worktree reflects updates made via the GitHub UI or by collaborators.
/// Requires the task to be Done with an open PR.
#[tauri::command]
pub fn workflow_pull_pr_changes(
    registry: State<ProjectRegistry>,
    window: Window,
    task_id: String,
) -> Result<Task, TauriError> {
    orkestra_debug!("tauri", "pull_pr_changes {task_id}");
    registry.with_project(window.label(), |state| {
        state.api()?.pull_pr_changes(&task_id).map_err(Into::into)
    })
}

/// Archive a Done task (marks it as complete after PR merge).
///
/// Validates the task is Done and Idle, then transitions to Archived.
#[tauri::command]
pub fn workflow_archive(
    registry: State<ProjectRegistry>,
    window: Window,
    task_id: String,
) -> Result<Task, TauriError> {
    orkestra_debug!("tauri", "archive {task_id}");
    registry.with_project(window.label(), |state| {
        state.api()?.archive_task(&task_id).map_err(Into::into)
    })
}

/// Reject an `AwaitingApproval` task with line-level comments.
///
/// Routes the task to the rejection target stage (typically "work") with
/// the submitted comments as context for the agent.
#[tauri::command]
pub fn workflow_reject_with_comments(
    registry: State<ProjectRegistry>,
    window: Window,
    task_id: String,
    comments: Vec<PrCommentData>,
    guidance: Option<String>,
) -> Result<Task, TauriError> {
    registry.with_project(window.label(), |state| {
        state
            .api()?
            .reject_with_comments(&task_id, comments, guidance)
            .map_err(Into::into)
    })
}

/// Address PR feedback (comments and/or failed CI checks) by returning the task to the work stage.
///
/// This transitions a Done/Idle task back to the work stage,
/// creating a new iteration with PR feedback context for the agent.
#[tauri::command]
pub fn workflow_address_pr_feedback(
    registry: State<ProjectRegistry>,
    window: Window,
    task_id: String,
    comments: Vec<PrCommentData>,
    checks: Vec<PrCheckData>,
    guidance: Option<String>,
) -> Result<Task, TauriError> {
    registry.with_project(window.label(), |state| {
        state
            .api()?
            .address_pr_feedback(&task_id, comments, checks, guidance)
            .map_err(Into::into)
    })
}

/// Address PR merge conflicts by returning to the work stage.
///
/// Creates a new iteration with integration failure context that instructs
/// the agent to rebase and resolve conflicts.
#[tauri::command]
pub fn workflow_address_pr_conflicts(
    registry: State<ProjectRegistry>,
    window: Window,
    task_id: String,
    base_branch: String,
) -> Result<Task, TauriError> {
    registry.with_project(window.label(), |state| {
        state
            .api()?
            .address_pr_conflicts(&task_id, &base_branch)
            .map_err(Into::into)
    })
}

/// Request update on a Done task by returning to the recovery stage.
///
/// Creates a new iteration with the feedback as context for the agent.
#[tauri::command]
pub fn workflow_request_update(
    registry: State<ProjectRegistry>,
    window: Window,
    task_id: String,
    feedback: String,
) -> Result<Task, TauriError> {
    registry.with_project(window.label(), |state| {
        state
            .api()?
            .request_update(&task_id, &feedback)
            .map_err(Into::into)
    })
}

/// Skip the current stage, advancing to the next stage with a message.
///
/// Moves the task forward without agent review. If this is the last stage, marks the task Done.
#[tauri::command]
pub fn workflow_skip_stage(
    registry: State<ProjectRegistry>,
    window: Window,
    task_id: String,
    message: String,
) -> Result<Task, TauriError> {
    orkestra_debug!("tauri", "skip_stage {task_id}");
    registry.with_project(window.label(), |state| {
        state
            .api()?
            .skip_stage(&task_id, &message)
            .map_err(Into::into)
    })
}

/// Send a task to a specific stage with a message explaining why.
///
/// Transitions the task to the target stage regardless of current stage order.
#[tauri::command]
pub fn workflow_send_to_stage(
    registry: State<ProjectRegistry>,
    window: Window,
    task_id: String,
    target_stage: String,
    message: String,
) -> Result<Task, TauriError> {
    orkestra_debug!("tauri", "send_to_stage {task_id} -> {target_stage}");
    registry.with_project(window.label(), |state| {
        state
            .api()?
            .send_to_stage(&task_id, &target_stage, &message)
            .map_err(Into::into)
    })
}

/// Return to structured work after chatting with the stage agent.
///
/// Clears chat state on the session and creates a new iteration with
/// `ReturnToWork` trigger so the agent resumes with the return-to-work prompt.
/// An optional `message` is attached to the iteration so the agent sees it as
/// a closing instruction before returning to structured output.
/// Valid from `AwaitingApproval` or `Interrupted`. Process killing is handled
/// by the domain interaction.
#[tauri::command]
pub fn workflow_return_to_work(
    registry: State<ProjectRegistry>,
    window: Window,
    task_id: String,
    message: Option<String>,
) -> Result<Task, TauriError> {
    orkestra_debug!("tauri", "return_to_work {task_id}");
    registry.with_project(window.label(), |state| {
        state
            .api()?
            .return_to_work(&task_id, message)
            .map_err(Into::into)
    })
}
