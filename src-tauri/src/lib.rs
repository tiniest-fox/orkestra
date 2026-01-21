use orkestra_core::{Task, TaskStatus, tasks, agents, AgentType, load_tasks, recover_all_sessions, recover_session_logs, resume_agent};
use tasks::{request_review_changes as core_request_review_changes, approve_review as core_approve_review};

#[tauri::command]
fn get_tasks() -> Vec<Task> {
    tasks::load_tasks().unwrap_or_default()
}

#[tauri::command]
fn create_task(title: String, description: String) -> Result<Task, String> {
    tasks::create_task(&title, &description).map_err(|e| e.to_string())
}

#[tauri::command]
fn create_and_start_task(title: String, description: String) -> Result<Task, String> {
    let task = tasks::create_task(&title, &description).map_err(|e| e.to_string())?;

    // Spawn a planner agent to create the implementation plan
    match agents::spawn_agent(&task, AgentType::Planner) {
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
fn approve_plan(id: String) -> Result<Task, String> {
    // First approve the plan (changes status to in_progress)
    let task = tasks::approve_task_plan(&id).map_err(|e| e.to_string())?;

    // Then spawn a worker agent to implement it
    match agents::spawn_agent(&task, AgentType::Worker) {
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
fn request_plan_changes(id: String, feedback: String) -> Result<Task, String> {
    // Request changes (changes status to planning, stores feedback)
    let task = tasks::request_plan_changes(&id, &feedback).map_err(|e| e.to_string())?;

    // Spawn planner again with the feedback
    match agents::spawn_agent(&task, AgentType::Planner) {
        Ok(spawned) => {
            println!("Spawned planner for task {} revision (pid: {})", spawned.task_id, spawned.process_id);
        }
        Err(e) => {
            eprintln!("Failed to spawn planner for task {}: {}", task.id, e);
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
fn request_review_changes(id: String, feedback: String) -> Result<Task, String> {
    // Request changes (changes status to in_progress, stores feedback)
    let task = core_request_review_changes(&id, &feedback).map_err(|e| e.to_string())?;

    // Spawn worker agent again with the feedback
    match agents::spawn_agent(&task, AgentType::Worker) {
        Ok(spawned) => {
            println!("Spawned worker for task {} review revision (pid: {})", spawned.task_id, spawned.process_id);
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
fn approve_review(id: String) -> Result<Task, String> {
    core_approve_review(&id).map_err(|e| e.to_string())
}

/// Resume a task that was interrupted (agent process died but had session_id)
#[tauri::command]
fn resume_task(id: String, prompt: Option<String>) -> Result<Task, String> {
    let tasks = load_tasks().map_err(|e| e.to_string())?;
    let task = tasks.iter().find(|t| t.id == id)
        .ok_or_else(|| "Task not found".to_string())?;

    resume_agent(task, prompt.as_deref())
        .map_err(|e| e.to_string())?;

    // Return the updated task
    load_tasks()
        .map_err(|e| e.to_string())?
        .into_iter()
        .find(|t| t.id == id)
        .ok_or_else(|| "Task not found".to_string())
}

/// Recover logs for a specific task from Claude's session file
#[tauri::command]
fn recover_task_logs(id: String) -> Result<Task, String> {
    let tasks = load_tasks().map_err(|e| e.to_string())?;
    let task = tasks.iter().find(|t| t.id == id)
        .ok_or_else(|| "Task not found".to_string())?;

    let session_id = task.session_id.as_ref()
        .ok_or_else(|| "Task has no session_id".to_string())?;

    let entries = recover_session_logs(session_id)
        .map_err(|e| e.to_string())?;

    tasks::update_task_logs(&id, entries).map_err(|e| e.to_string())
}

/// Recover all sessions on app startup - recovers logs for tasks whose agent died
#[tauri::command]
fn recover_sessions() -> Result<u32, String> {
    recover_all_sessions().map_err(|e| e.to_string())
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
            recover_task_logs,
            recover_sessions
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
