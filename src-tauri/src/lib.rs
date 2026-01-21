use orkestra_core::{Task, TaskStatus, tasks, agents};

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

    // Spawn an agent to work on the task
    match agents::spawn_agent(&task) {
        Ok(spawned) => {
            println!("Spawned agent for task {} (pid: {})", spawned.task_id, spawned.process_id);
        }
        Err(e) => {
            eprintln!("Failed to spawn agent for task {}: {}", task.id, e);
            // Don't fail the whole operation, just log the error
            // The task is created, user can manually trigger agent later
        }
    }

    // Return the task with updated status (now in_progress)
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
fn spawn_agent_for_task(id: String) -> Result<u32, String> {
    let tasks_list = tasks::load_tasks().map_err(|e| e.to_string())?;
    let task = tasks_list
        .into_iter()
        .find(|t| t.id == id)
        .ok_or_else(|| format!("Task {} not found", id))?;

    let spawned = agents::spawn_agent(&task).map_err(|e| e.to_string())?;
    Ok(spawned.process_id)
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
            spawn_agent_for_task
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
