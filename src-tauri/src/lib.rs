use orkestra_core::{Task, TaskStatus, tasks, agents, AgentType, load_tasks, recover_session_logs, resume_agent, LogEntry};
use tasks::{request_review_changes as core_request_review_changes, approve_review as core_approve_review};
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
    // First approve the plan (changes status to working)
    let task = tasks::approve_task_plan(&id).map_err(|e| e.to_string())?;

    // Create callback that emits Tauri events for real-time updates
    let handle = app_handle.clone();
    let on_update = move |task_id: &str| {
        let _ = handle.emit("task-logs-updated", task_id.to_string());
    };

    // Then spawn a worker agent to implement it
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

    // Find the most recent session to resume (work or latest review)
    // Sessions are ordered by insertion time, so last key is most recent
    let session_to_resume = task.sessions.as_ref()
        .and_then(|s| s.keys().last().map(|k| k.to_string()));

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
            resume_task,
            get_task_logs,
            set_task_auto_approve
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
