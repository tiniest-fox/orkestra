// Tauri commands require owned types for serialization
#![allow(clippy::needless_pass_by_value)]

use orkestra_core::{
    agents::{self, generate_title_sync},
    auto_tasks, find_project_root, orchestrator, recover_session_logs, resume_agent, tasks,
    AgentType, AutoTask, LogEntry, Project, Task, TaskStatus,
};
use tasks::{
    approve_breakdown as core_approve_breakdown, get_child_tasks as core_get_child_tasks,
    get_subtasks as core_get_subtasks, request_breakdown_changes as core_request_breakdown_changes,
    request_review_changes as core_request_review_changes, skip_breakdown as core_skip_breakdown,
    start_automated_review as core_start_automated_review,
};
use tauri::{AppHandle, Emitter};

use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use std::thread;
use std::time::Duration;

#[tauri::command]
fn get_tasks() -> Result<Vec<Task>, String> {
    let project = Project::discover().map_err(|e| e.to_string())?;
    tasks::load_tasks(&project).map_err(|e| e.to_string())
}

#[tauri::command]
fn create_task(title: String, description: String) -> Result<Task, String> {
    let project = Project::discover().map_err(|e| e.to_string())?;
    tasks::create_task(&project, &title, &description).map_err(|e| e.to_string())
}

#[tauri::command]
fn create_and_start_task(
    title: Option<String>,
    description: String,
    auto_approve: Option<bool>,
) -> Result<Task, String> {
    let project = Project::discover().map_err(|e| e.to_string())?;

    // Generate title if not provided or empty
    let final_title = match title {
        Some(t) if !t.trim().is_empty() => t,
        _ => {
            // Generate title using AI (30 second timeout)
            generate_title_sync(&description, 30).unwrap_or_else(|e| {
                eprintln!("Warning: Failed to generate title: {e}");
                // Fallback to a generic title based on description
                let preview: String = description.chars().take(50).collect();
                if preview.len() < description.len() {
                    format!("{preview}...")
                } else {
                    preview
                }
            })
        }
    };

    // Create task in Planning status - orchestrator will spawn the planner
    tasks::create_task_with_options(
        &project,
        &final_title,
        &description,
        auto_approve.unwrap_or(false),
    )
    .map_err(|e| e.to_string())
}

#[tauri::command]
fn update_task_status(id: String, status: TaskStatus) -> Result<Task, String> {
    let project = Project::discover().map_err(|e| e.to_string())?;
    tasks::update_task_status(&project, &id, status).map_err(|e| e.to_string())
}

#[tauri::command]
fn approve_plan(id: String) -> Result<Task, String> {
    let project = Project::discover().map_err(|e| e.to_string())?;
    // Approve plan (changes status to BreakingDown or Working)
    // Orchestrator will spawn the appropriate agent
    tasks::approve_task_plan(&project, &id).map_err(|e| e.to_string())
}

#[tauri::command]
fn request_plan_changes(id: String, feedback: String) -> Result<Task, String> {
    let project = Project::discover().map_err(|e| e.to_string())?;
    // Request changes (changes status to planning, stores feedback)
    // Orchestrator will resume the planner session
    tasks::request_plan_changes(&project, &id, &feedback).map_err(|e| e.to_string())
}

#[tauri::command]
fn request_review_changes(id: String, feedback: String) -> Result<Task, String> {
    let project = Project::discover().map_err(|e| e.to_string())?;
    // Request changes (clears summary, stores feedback, back to working)
    // Orchestrator will resume the worker session
    core_request_review_changes(&project, &id, &feedback).map_err(|e| e.to_string())
}

#[tauri::command]
fn approve_review(id: String) -> Result<Task, String> {
    let project = Project::discover().map_err(|e| e.to_string())?;
    // Transition to Reviewing status
    // Orchestrator will spawn the reviewer agent
    core_start_automated_review(&project, &id).map_err(|e| e.to_string())
}

#[tauri::command]
fn approve_breakdown(id: String) -> Result<Task, String> {
    let project = Project::discover().map_err(|e| e.to_string())?;
    // Approve breakdown (changes status to WaitingOnSubtasks or Working)
    // Orchestrator will spawn workers for child tasks if needed
    core_approve_breakdown(&project, &id).map_err(|e| e.to_string())
}

#[tauri::command]
fn request_breakdown_changes(id: String, feedback: String) -> Result<Task, String> {
    let project = Project::discover().map_err(|e| e.to_string())?;
    // Request changes (clears breakdown, stores feedback, back to BreakingDown)
    // Orchestrator will resume/spawn breakdown agent
    core_request_breakdown_changes(&project, &id, &feedback).map_err(|e| e.to_string())
}

#[tauri::command]
fn skip_breakdown(id: String) -> Result<Task, String> {
    let project = Project::discover().map_err(|e| e.to_string())?;
    // Skip breakdown (changes status to Working)
    // Orchestrator will spawn worker agent
    core_skip_breakdown(&project, &id).map_err(|e| e.to_string())
}

/// Delete a task and all its resources (worktree, branch, children)
#[tauri::command]
fn delete_task(id: String) -> Result<(), String> {
    let project = Project::discover().map_err(|e| e.to_string())?;
    tasks::delete_task(&project, &id).map_err(|e| e.to_string())
}

/// Get subtasks (checklist items) for a task
#[tauri::command]
fn get_subtasks(parent_id: String) -> Result<Vec<Task>, String> {
    let project = Project::discover().map_err(|e| e.to_string())?;
    core_get_subtasks(&project, &parent_id).map_err(|e| e.to_string())
}

/// Get child tasks (parallel tasks that appear in Kanban) for a task
#[tauri::command]
fn get_child_tasks(parent_id: String) -> Result<Vec<Task>, String> {
    let project = Project::discover().map_err(|e| e.to_string())?;
    core_get_child_tasks(&project, &parent_id).map_err(|e| e.to_string())
}

#[tauri::command]
fn set_task_auto_approve(id: String, enabled: bool) -> Result<Task, String> {
    let project = Project::discover().map_err(|e| e.to_string())?;
    tasks::set_auto_approve(&project, &id, enabled).map_err(|e| e.to_string())
}

/// Get all available auto-tasks from .orkestra/tasks/
#[tauri::command]
fn get_auto_tasks() -> Result<Vec<AutoTask>, String> {
    let project_root = find_project_root().map_err(|e| e.to_string())?;
    auto_tasks::list_auto_tasks(&project_root).map_err(|e| e.to_string())
}

/// Create a new task from an auto-task template
#[tauri::command]
fn create_task_from_auto_task(name: String) -> Result<Task, String> {
    let project = Project::discover().map_err(|e| e.to_string())?;
    let auto_task = auto_tasks::get_auto_task(project.root(), &name).map_err(|e| e.to_string())?;

    // Create the task using the auto-task's title, description, and auto_run setting
    tasks::create_task_with_options(
        &project,
        &auto_task.title,
        &auto_task.description,
        auto_task.auto_run,
    )
    .map_err(|e| e.to_string())
}

/// Resume a task that was interrupted (agent process died but had session)
/// session_key specifies which session to resume (e.g., "plan", "work", "review_0")
#[tauri::command]
fn resume_task(
    id: String,
    session_key: String,
    prompt: Option<String>,
    app_handle: tauri::AppHandle,
) -> Result<Task, String> {
    let project = Project::discover().map_err(|e| e.to_string())?;
    let tasks = tasks::load_tasks(&project).map_err(|e| e.to_string())?;
    let task = tasks
        .iter()
        .find(|t| t.id == id)
        .ok_or_else(|| "Task not found".to_string())?;

    // Create callback that emits Tauri events for real-time updates
    let handle = app_handle.clone();
    let on_update = move |task_id: &str| {
        let _ = handle.emit("task-logs-updated", task_id.to_string());
    };

    resume_agent(&project, task, &session_key, prompt.as_deref(), on_update)
        .map_err(|e| e.to_string())?;

    // Return the updated task
    tasks::load_tasks(&project)
        .map_err(|e| e.to_string())?
        .into_iter()
        .find(|t| t.id == id)
        .ok_or_else(|| "Task not found".to_string())
}

/// Get the project root path
#[tauri::command]
fn get_project_root() -> Result<String, String> {
    find_project_root()
        .map(|p| p.to_string_lossy().to_string())
        .map_err(|e| e.to_string())
}

/// Get logs for a specific task session from Claude's session file
/// session_key specifies which session to load (e.g., "plan", "work", "review_0")
/// If session_key is None, returns the most recent session's logs
#[tauri::command]
fn get_task_logs(id: String, session_key: Option<String>) -> Result<Vec<LogEntry>, String> {
    let project = Project::discover().map_err(|e| e.to_string())?;
    let tasks = tasks::load_tasks(&project).map_err(|e| e.to_string())?;
    let task = tasks
        .iter()
        .find(|t| t.id == id)
        .ok_or_else(|| "Task not found".to_string())?;

    let Some(sessions) = &task.sessions else {
        return Ok(vec![]); // No sessions = no logs
    };

    // Determine which session to load
    let session_id = match session_key {
        Some(key) => sessions
            .get(&key)
            .map(|info| info.session_id.clone())
            .ok_or_else(|| format!("Session '{key}' not found"))?,
        None => {
            // Default: return most recent session (last in the ordered map)
            sessions
                .values()
                .last()
                .map(|info| info.session_id.clone())
                .ok_or_else(|| "No sessions available".to_string())?
        }
    };

    // Use worktree path if available, otherwise fall back to project root
    // Agents run in worktrees, so Claude creates session files based on that path
    let session_cwd = task
        .worktree_path
        .as_ref()
        .map_or_else(|| project.root().to_path_buf(), std::path::PathBuf::from);

    recover_session_logs(&session_id, &session_cwd).map_err(|e| e.to_string())
}

/// Start the orchestrator background loop
#[allow(clippy::too_many_lines)]
fn start_orchestrator(app_handle: AppHandle, stop_flag: Arc<AtomicBool>) {
    thread::spawn(move || {
        // Discover project for this thread
        let project = match Project::discover() {
            Ok(p) => p,
            Err(e) => {
                eprintln!("[orchestrator] Failed to discover project: {e}");
                return;
            }
        };

        while !stop_flag.load(Ordering::Relaxed) {
            // Check for tasks that need agents
            match orchestrator::check_tasks(&project) {
                Ok(actions) => {
                    for action in actions {
                        let handle = app_handle.clone();
                        let on_update = move |task_id: &str| {
                            let _ = handle.emit("task-logs-updated", task_id.to_string());
                        };

                        match action {
                            orchestrator::OrchestratorAction::SpawnPlanner(task) => {
                                match agents::spawn_agent(
                                    &project,
                                    &task,
                                    AgentType::Planner,
                                    on_update,
                                ) {
                                    Ok(spawned) => {
                                        println!(
                                            "[orchestrator] Spawned planner for {} (pid: {})",
                                            spawned.task_id, spawned.process_id
                                        );
                                    }
                                    Err(e) => {
                                        eprintln!(
                                            "[orchestrator] Failed to spawn planner for {}: {}",
                                            task.id, e
                                        );
                                        let _ = tasks::fail_task(
                                            &project,
                                            &task.id,
                                            &format!("Failed to spawn planner: {e}"),
                                        );
                                    }
                                }
                            }
                            orchestrator::OrchestratorAction::SpawnBreakdown(task) => {
                                match agents::spawn_agent(
                                    &project,
                                    &task,
                                    AgentType::Breakdown,
                                    on_update,
                                ) {
                                    Ok(spawned) => {
                                        println!(
                                            "[orchestrator] Spawned breakdown for {} (pid: {})",
                                            spawned.task_id, spawned.process_id
                                        );
                                    }
                                    Err(e) => {
                                        eprintln!(
                                            "[orchestrator] Failed to spawn breakdown for {}: {}",
                                            task.id, e
                                        );
                                        let _ = tasks::fail_task(
                                            &project,
                                            &task.id,
                                            &format!("Failed to spawn breakdown: {e}"),
                                        );
                                    }
                                }
                            }
                            orchestrator::OrchestratorAction::SpawnWorker(task) => {
                                match agents::spawn_agent(
                                    &project,
                                    &task,
                                    AgentType::Worker,
                                    on_update,
                                ) {
                                    Ok(spawned) => {
                                        println!(
                                            "[orchestrator] Spawned worker for {} (pid: {})",
                                            spawned.task_id, spawned.process_id
                                        );
                                    }
                                    Err(e) => {
                                        eprintln!(
                                            "[orchestrator] Failed to spawn worker for {}: {}",
                                            task.id, e
                                        );
                                        let _ = tasks::fail_task(
                                            &project,
                                            &task.id,
                                            &format!("Failed to spawn worker: {e}"),
                                        );
                                    }
                                }
                            }
                            orchestrator::OrchestratorAction::ResumeWorker {
                                task,
                                session_key,
                            } => {
                                let handle2 = app_handle.clone();
                                let on_update2 = move |task_id: &str| {
                                    let _ = handle2.emit("task-logs-updated", task_id.to_string());
                                };
                                match resume_agent(&project, &task, &session_key, None, on_update2)
                                {
                                    Ok(spawned) => {
                                        println!(
                                            "[orchestrator] Resumed worker for {} (pid: {})",
                                            spawned.task_id, spawned.process_id
                                        );
                                    }
                                    Err(e) => {
                                        eprintln!(
                                            "[orchestrator] Failed to resume worker for {}: {}",
                                            task.id, e
                                        );
                                        let _ = tasks::fail_task(
                                            &project,
                                            &task.id,
                                            &format!("Failed to resume worker: {e}"),
                                        );
                                    }
                                }
                            }
                            orchestrator::OrchestratorAction::SpawnReviewer(task) => {
                                match agents::spawn_agent(
                                    &project,
                                    &task,
                                    AgentType::Reviewer,
                                    on_update,
                                ) {
                                    Ok(spawned) => {
                                        println!(
                                            "[orchestrator] Spawned reviewer for {} (pid: {})",
                                            spawned.task_id, spawned.process_id
                                        );
                                    }
                                    Err(e) => {
                                        eprintln!(
                                            "[orchestrator] Failed to spawn reviewer for {}: {}",
                                            task.id, e
                                        );
                                        let _ = tasks::fail_task(
                                            &project,
                                            &task.id,
                                            &format!("Failed to spawn reviewer: {e}"),
                                        );
                                    }
                                }
                            }
                            orchestrator::OrchestratorAction::ResumeReviewer {
                                task,
                                session_key,
                            } => {
                                let handle2 = app_handle.clone();
                                let on_update2 = move |task_id: &str| {
                                    let _ = handle2.emit("task-logs-updated", task_id.to_string());
                                };
                                match resume_agent(&project, &task, &session_key, None, on_update2)
                                {
                                    Ok(spawned) => {
                                        println!(
                                            "[orchestrator] Resumed reviewer for {} (pid: {})",
                                            spawned.task_id, spawned.process_id
                                        );
                                    }
                                    Err(e) => {
                                        eprintln!(
                                            "[orchestrator] Failed to resume reviewer for {}: {}",
                                            task.id, e
                                        );
                                        let _ = tasks::fail_task(
                                            &project,
                                            &task.id,
                                            &format!("Failed to resume reviewer: {e}"),
                                        );
                                    }
                                }
                            }
                        }
                    }
                }
                Err(e) => {
                    eprintln!("[orchestrator] Error checking tasks: {e}");
                }
            }

            // Sleep for 1 second
            thread::sleep(Duration::from_secs(1));
        }
        println!("[orchestrator] Stopped");
    });
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .setup(|app| {
            // Start the orchestrator background loop
            let stop_flag = Arc::new(AtomicBool::new(false));
            start_orchestrator(app.handle().clone(), stop_flag);
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            get_tasks,
            create_task,
            create_and_start_task,
            update_task_status,
            approve_plan,
            request_plan_changes,
            request_review_changes,
            approve_review,
            approve_breakdown,
            request_breakdown_changes,
            skip_breakdown,
            delete_task,
            get_subtasks,
            get_child_tasks,
            resume_task,
            get_task_logs,
            get_project_root,
            set_task_auto_approve,
            get_auto_tasks,
            create_task_from_auto_task
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
