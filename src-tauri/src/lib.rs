use orkestra_core::{Task, TaskStatus, tasks, agents, AgentType, load_tasks, recover_session_logs, resume_agent, LogEntry};
use tasks::{request_review_changes as core_request_review_changes, approve_review as core_approve_review, approve_breakdown as core_approve_breakdown, request_breakdown_changes as core_request_breakdown_changes, skip_breakdown as core_skip_breakdown, get_subtasks as core_get_subtasks, get_child_tasks as core_get_child_tasks};
use tauri::Emitter;

#[tauri::command]
fn get_tasks() -> Vec<Task> {
    tasks::load_tasks().unwrap_or_default()
}

#[tauri::command]
fn create_task(title: String, description: String) -> Result<Task, String> {
    tasks::create_task(&title, &description).map_err(|e| e.to_string())
}

#[tauri::command]
fn create_and_start_task(title: String, description: String, auto_approve: Option<bool>, app_handle: tauri::AppHandle) -> Result<Task, String> {
    let task = tasks::create_task_with_options(&title, &description, auto_approve.unwrap_or(false)).map_err(|e| e.to_string())?;

    // Create callback that emits Tauri events for real-time updates
    let handle = app_handle.clone();
    let on_update = move |task_id: &str| {
        let _ = handle.emit("task-logs-updated", task_id.to_string());
    };

    // Spawn a planner agent to create the implementation plan
    match agents::spawn_agent(&task, AgentType::Planner, on_update) {
        Ok(spawned) => {
            println!("Spawned planner for task {} (pid: {})", spawned.task_id, spawned.process_id);
        }
        Err(e) => {
            eprintln!("Failed to spawn planner for task {}: {}", task.id, e);
        }
    }

    // Return the task with updated status (now planning)
    tasks::load_tasks()
        .map_err(|e| e.to_string())?
        .into_iter()
        .find(|t| t.id == task.id)
        .ok_or_else(|| "Task not found after creation".to_string())
}

#[tauri::command]
fn update_task_status(id: String, status: TaskStatus) -> Result<Task, String> {
    tasks::update_task_status(&id, status).map_err(|e| e.to_string())
}

#[tauri::command]
fn approve_plan(id: String, app_handle: tauri::AppHandle) -> Result<Task, String> {
    // First approve the plan (changes status to BreakingDown or Working)
    let task = tasks::approve_task_plan(&id).map_err(|e| e.to_string())?;

    // Create callback that emits Tauri events for real-time updates
    let handle = app_handle.clone();
    let on_update = move |task_id: &str| {
        let _ = handle.emit("task-logs-updated", task_id.to_string());
    };

    // Spawn appropriate agent based on the new status
    match task.status {
        TaskStatus::BreakingDown => {
            // Spawn breakdown agent to create subtasks
            match agents::spawn_agent(&task, AgentType::Breakdown, on_update) {
                Ok(spawned) => {
                    println!("Spawned breakdown agent for task {} (pid: {})", spawned.task_id, spawned.process_id);
                }
                Err(e) => {
                    eprintln!("Failed to spawn breakdown agent for task {}: {}", task.id, e);
                }
            }
        }
        TaskStatus::Working => {
            // Skip breakdown, spawn worker directly
            match agents::spawn_agent(&task, AgentType::Worker, on_update) {
                Ok(spawned) => {
                    println!("Spawned worker for task {} (pid: {})", spawned.task_id, spawned.process_id);
                }
                Err(e) => {
                    eprintln!("Failed to spawn worker for task {}: {}", task.id, e);
                }
            }
        }
        _ => {}
    }

    // Return the updated task
    tasks::load_tasks()
        .map_err(|e| e.to_string())?
        .into_iter()
        .find(|t| t.id == id)
        .ok_or_else(|| "Task not found".to_string())
}

#[tauri::command]
fn request_plan_changes(id: String, feedback: String, app_handle: tauri::AppHandle) -> Result<Task, String> {
    // Request changes (changes status to planning, stores feedback)
    let task = tasks::request_plan_changes(&id, &feedback).map_err(|e| e.to_string())?;

    // Create callback that emits Tauri events for real-time updates
    let handle = app_handle.clone();
    let on_update = move |task_id: &str| {
        let _ = handle.emit("task-logs-updated", task_id.to_string());
    };

    // Resume existing plan session with feedback as the continuation prompt
    // This keeps the conversation context instead of starting fresh
    if task.sessions.as_ref().and_then(|s| s.get("plan")).is_some() {
        let prompt = format!(
            "The user has requested changes to your plan:\n\n{}\n\nPlease revise your plan to address this feedback.",
            feedback
        );
        match resume_agent(&task, "plan", Some(&prompt), on_update) {
            Ok(spawned) => {
                println!("Resumed planner for task {} revision (pid: {})", spawned.task_id, spawned.process_id);
            }
            Err(e) => {
                eprintln!("Failed to resume planner for task {}: {}", task.id, e);
            }
        }
    } else {
        // No existing session, spawn new (shouldn't normally happen)
        match agents::spawn_agent(&task, AgentType::Planner, on_update) {
            Ok(spawned) => {
                println!("Spawned planner for task {} revision (pid: {})", spawned.task_id, spawned.process_id);
            }
            Err(e) => {
                eprintln!("Failed to spawn planner for task {}: {}", task.id, e);
            }
        }
    }

    // Return the updated task
    tasks::load_tasks()
        .map_err(|e| e.to_string())?
        .into_iter()
        .find(|t| t.id == id)
        .ok_or_else(|| "Task not found".to_string())
}

#[tauri::command]
fn request_review_changes(id: String, feedback: String, app_handle: tauri::AppHandle) -> Result<Task, String> {
    // Request changes (clears summary, stores feedback)
    let task = core_request_review_changes(&id, &feedback).map_err(|e| e.to_string())?;

    // Create callback that emits Tauri events for real-time updates
    let handle = app_handle.clone();
    let on_update = move |task_id: &str| {
        let _ = handle.emit("task-logs-updated", task_id.to_string());
    };

    // Find the most recent work-related session to resume (work or latest review_N)
    // We specifically look for work sessions, not plan or breakdown sessions
    let session_to_resume = task.sessions.as_ref()
        .and_then(|s| {
            // First try to find the latest review session (review_0, review_1, etc.)
            let latest_review = s.keys()
                .filter(|k| k.starts_with("review_"))
                .max_by_key(|k| k.strip_prefix("review_").and_then(|n| n.parse::<u32>().ok()).unwrap_or(0))
                .cloned();

            // Fall back to "work" session if no review sessions exist
            latest_review.or_else(|| s.contains_key("work").then(|| "work".to_string()))
        });

    if let Some(session_key) = session_to_resume {
        let prompt = format!(
            "The reviewer has requested changes:\n\n{}\n\nPlease address this feedback and continue your implementation.",
            feedback
        );
        match resume_agent(&task, &session_key, Some(&prompt), on_update) {
            Ok(spawned) => {
                println!("Resumed worker for task {} review revision (pid: {})", spawned.task_id, spawned.process_id);
            }
            Err(e) => {
                eprintln!("Failed to resume worker for task {}: {}", task.id, e);
            }
        }
    } else {
        // Fallback to spawning new if no session exists
        match agents::spawn_agent(&task, AgentType::Worker, on_update) {
            Ok(spawned) => {
                println!("Spawned worker for task {} review revision (pid: {})", spawned.task_id, spawned.process_id);
            }
            Err(e) => {
                eprintln!("Failed to spawn worker for task {}: {}", task.id, e);
            }
        }
    }

    // Return the updated task
    tasks::load_tasks()
        .map_err(|e| e.to_string())?
        .into_iter()
        .find(|t| t.id == id)
        .ok_or_else(|| "Task not found".to_string())
}

#[tauri::command]
fn approve_review(id: String) -> Result<Task, String> {
    core_approve_review(&id).map_err(|e| e.to_string())
}

#[tauri::command]
fn approve_breakdown(id: String, app_handle: tauri::AppHandle) -> Result<Task, String> {
    // Approve breakdown (changes status to WaitingOnSubtasks)
    let _task = core_approve_breakdown(&id).map_err(|e| e.to_string())?;

    // Create callback that emits Tauri events for real-time updates
    let handle = app_handle.clone();

    // Spawn worker agents for child tasks only (not subtasks/checklist items)
    // Child tasks are parallel work items that each get their own worker
    // Subtasks are checklist items worked through by the parent's worker
    match core_get_child_tasks(&id) {
        Ok(child_tasks) => {
            for child in child_tasks {
                let handle_clone = handle.clone();
                let on_update = move |task_id: &str| {
                    let _ = handle_clone.emit("task-logs-updated", task_id.to_string());
                };
                match agents::spawn_agent(&child, AgentType::Worker, on_update) {
                    Ok(spawned) => {
                        println!("Spawned worker for child task {} (pid: {})", spawned.task_id, spawned.process_id);
                    }
                    Err(e) => {
                        eprintln!("Failed to spawn worker for child task {}: {}", child.id, e);
                    }
                }
            }
        }
        Err(e) => {
            eprintln!("Failed to get child tasks for task {}: {}", id, e);
        }
    }

    // Return the updated task
    tasks::load_tasks()
        .map_err(|e| e.to_string())?
        .into_iter()
        .find(|t| t.id == id)
        .ok_or_else(|| "Task not found".to_string())
}

#[tauri::command]
fn request_breakdown_changes(id: String, feedback: String, app_handle: tauri::AppHandle) -> Result<Task, String> {
    // Request changes (clears breakdown, stores feedback)
    let task = core_request_breakdown_changes(&id, &feedback).map_err(|e| e.to_string())?;

    // Create callback that emits Tauri events for real-time updates
    let handle = app_handle.clone();
    let on_update = move |task_id: &str| {
        let _ = handle.emit("task-logs-updated", task_id.to_string());
    };

    // Find the most recent breakdown session to resume (breakdown or latest breakdown_N)
    let session_to_resume = task.sessions.as_ref()
        .and_then(|s| {
            // First try to find the latest breakdown revision session (breakdown_0, breakdown_1, etc.)
            let latest_revision = s.keys()
                .filter(|k| k.starts_with("breakdown_"))
                .max_by_key(|k| k.strip_prefix("breakdown_").and_then(|n| n.parse::<u32>().ok()).unwrap_or(0))
                .cloned();

            // Fall back to "breakdown" session if no revision sessions exist
            latest_revision.or_else(|| s.contains_key("breakdown").then(|| "breakdown".to_string()))
        });

    if let Some(session_key) = session_to_resume {
        let prompt = format!(
            "The user has requested changes to your breakdown:\n\n{}\n\nPlease revise your subtask breakdown to address this feedback.",
            feedback
        );
        match resume_agent(&task, &session_key, Some(&prompt), on_update) {
            Ok(spawned) => {
                println!("Resumed breakdown agent for task {} revision (pid: {})", spawned.task_id, spawned.process_id);
            }
            Err(e) => {
                eprintln!("Failed to resume breakdown agent for task {}: {}", task.id, e);
            }
        }
    } else {
        // No existing session, spawn new (shouldn't normally happen)
        match agents::spawn_agent(&task, AgentType::Breakdown, on_update) {
            Ok(spawned) => {
                println!("Spawned breakdown agent for task {} revision (pid: {})", spawned.task_id, spawned.process_id);
            }
            Err(e) => {
                eprintln!("Failed to spawn breakdown agent for task {}: {}", task.id, e);
            }
        }
    }

    // Return the updated task
    tasks::load_tasks()
        .map_err(|e| e.to_string())?
        .into_iter()
        .find(|t| t.id == id)
        .ok_or_else(|| "Task not found".to_string())
}

#[tauri::command]
fn skip_breakdown(id: String, app_handle: tauri::AppHandle) -> Result<Task, String> {
    // Skip breakdown (changes status to Working)
    let task = core_skip_breakdown(&id).map_err(|e| e.to_string())?;

    // Create callback that emits Tauri events for real-time updates
    let handle = app_handle.clone();
    let on_update = move |task_id: &str| {
        let _ = handle.emit("task-logs-updated", task_id.to_string());
    };

    // Spawn worker agent
    match agents::spawn_agent(&task, AgentType::Worker, on_update) {
        Ok(spawned) => {
            println!("Spawned worker for task {} (pid: {})", spawned.task_id, spawned.process_id);
        }
        Err(e) => {
            eprintln!("Failed to spawn worker for task {}: {}", task.id, e);
        }
    }

    // Return the updated task
    tasks::load_tasks()
        .map_err(|e| e.to_string())?
        .into_iter()
        .find(|t| t.id == id)
        .ok_or_else(|| "Task not found".to_string())
}

/// Get subtasks (checklist items) for a task
#[tauri::command]
fn get_subtasks(parent_id: String) -> Result<Vec<Task>, String> {
    core_get_subtasks(&parent_id).map_err(|e| e.to_string())
}

/// Get child tasks (parallel tasks that appear in Kanban) for a task
#[tauri::command]
fn get_child_tasks(parent_id: String) -> Result<Vec<Task>, String> {
    core_get_child_tasks(&parent_id).map_err(|e| e.to_string())
}

#[tauri::command]
fn set_task_auto_approve(id: String, enabled: bool) -> Result<Task, String> {
    tasks::set_auto_approve(&id, enabled).map_err(|e| e.to_string())
}

/// Resume a task that was interrupted (agent process died but had session)
/// session_key specifies which session to resume (e.g., "plan", "work", "review_0")
#[tauri::command]
fn resume_task(id: String, session_key: String, prompt: Option<String>, app_handle: tauri::AppHandle) -> Result<Task, String> {
    let tasks = load_tasks().map_err(|e| e.to_string())?;
    let task = tasks.iter().find(|t| t.id == id)
        .ok_or_else(|| "Task not found".to_string())?;

    // Create callback that emits Tauri events for real-time updates
    let handle = app_handle.clone();
    let on_update = move |task_id: &str| {
        let _ = handle.emit("task-logs-updated", task_id.to_string());
    };

    resume_agent(task, &session_key, prompt.as_deref(), on_update)
        .map_err(|e| e.to_string())?;

    // Return the updated task
    load_tasks()
        .map_err(|e| e.to_string())?
        .into_iter()
        .find(|t| t.id == id)
        .ok_or_else(|| "Task not found".to_string())
}

/// Get logs for a specific task session from Claude's session file
/// session_key specifies which session to load (e.g., "plan", "work", "review_0")
/// If session_key is None, returns the most recent session's logs
#[tauri::command]
fn get_task_logs(id: String, session_key: Option<String>) -> Result<Vec<LogEntry>, String> {
    let tasks = load_tasks().map_err(|e| e.to_string())?;
    let task = tasks.iter().find(|t| t.id == id)
        .ok_or_else(|| "Task not found".to_string())?;

    let sessions = match &task.sessions {
        Some(s) => s,
        None => return Ok(vec![]), // No sessions = no logs
    };

    // Determine which session to load
    let session_id = match session_key {
        Some(key) => {
            sessions.get(&key)
                .map(|info| info.session_id.clone())
                .ok_or_else(|| format!("Session '{}' not found", key))?
        }
        None => {
            // Default: return most recent session (last in the ordered map)
            sessions.values()
                .last()
                .map(|info| info.session_id.clone())
                .ok_or_else(|| "No sessions available".to_string())?
        }
    };

    recover_session_logs(&session_id).map_err(|e| e.to_string())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
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
            get_subtasks,
            get_child_tasks,
            resume_task,
            get_task_logs,
            set_task_auto_approve
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
