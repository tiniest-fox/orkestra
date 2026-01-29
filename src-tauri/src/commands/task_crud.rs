//! Task CRUD commands.

use crate::{error::TauriError, state::AppState};
use orkestra_core::{is_process_running, kill_process_tree, workflow::Task};
use tauri::State;

/// Get all tasks from the workflow.
#[tauri::command]
pub fn workflow_get_tasks(state: State<AppState>) -> Result<Vec<Task>, TauriError> {
    state.api()?.list_tasks().map_err(Into::into)
}

/// Create a new task.
///
/// If git service is configured, creates a worktree and branch.
/// `base_branch` specifies which branch to create from (defaults to current).
#[tauri::command]
pub fn workflow_create_task(
    state: State<AppState>,
    title: String,
    description: String,
    base_branch: Option<String>,
) -> Result<Task, TauriError> {
    state
        .api()?
        .create_task(&title, &description, base_branch.as_deref())
        .map_err(Into::into)
}

/// Create a subtask under a parent task.
#[tauri::command]
pub fn workflow_create_subtask(
    state: State<AppState>,
    parent_id: String,
    title: String,
    description: String,
) -> Result<Task, TauriError> {
    state
        .api()?
        .create_subtask(&parent_id, &title, &description)
        .map_err(Into::into)
}

/// Get a specific task by ID.
#[tauri::command]
pub fn workflow_get_task(state: State<AppState>, task_id: String) -> Result<Task, TauriError> {
    state.api()?.get_task(&task_id).map_err(Into::into)
}

/// Delete a task, killing any running agents first.
///
/// Terminates running agent processes (instant signal sends), then deletes all
/// DB records in a single transaction. Git worktree cleanup is handled in the
/// background by the orchestrator's orphaned worktree cleanup on startup.
#[tauri::command]
pub fn workflow_delete_task(state: State<AppState>, task_id: String) -> Result<(), TauriError> {
    let api = state.api()?;

    // Kill running agents for the task and all subtasks (best-effort, instant)
    let task_ids = collect_task_tree_ids(&api, &task_id);
    kill_agents_for_tasks(&api, &task_ids);

    // Delete all DB records in a transaction — no git/filesystem work
    api.delete_task(&task_id).map_err(Into::into)
}

/// Collect the task ID and all descendant subtask IDs recursively.
fn collect_task_tree_ids(api: &orkestra_core::workflow::WorkflowApi, task_id: &str) -> Vec<String> {
    let mut ids = vec![task_id.to_string()];
    if let Ok(subtasks) = api.list_subtasks(task_id) {
        for subtask in subtasks {
            ids.extend(collect_task_tree_ids(api, &subtask.id));
        }
    }
    ids
}

/// Kill running agent processes for the given task IDs.
///
/// Queries stage sessions for each task and kills any processes that are still running.
/// Failures are logged but do not propagate — deletion should always proceed.
fn kill_agents_for_tasks(api: &orkestra_core::workflow::WorkflowApi, task_ids: &[String]) {
    let Ok(all_sessions) = api.get_running_agent_pids() else {
        return;
    };

    for (session_task_id, stage, pid) in all_sessions {
        if task_ids.contains(&session_task_id) && is_process_running(pid) {
            println!("[delete] Killing agent for task {session_task_id}/{stage} (pid: {pid})");
            if let Err(e) = kill_process_tree(pid) {
                eprintln!(
                    "[delete] Failed to kill agent pid {pid} for {session_task_id}/{stage}: {e}"
                );
            }
        }
    }
}

/// List subtasks for a parent task.
#[tauri::command]
pub fn workflow_list_subtasks(
    state: State<AppState>,
    parent_id: String,
) -> Result<Vec<Task>, TauriError> {
    state.api()?.list_subtasks(&parent_id).map_err(Into::into)
}

/// Get all archived tasks.
///
/// Archived tasks are completed tasks that have been integrated (branch merged).
#[tauri::command]
pub fn workflow_get_archived_tasks(state: State<AppState>) -> Result<Vec<Task>, TauriError> {
    state.api()?.list_archived_tasks().map_err(Into::into)
}
