//! Project management commands.

use crate::error::TauriError;
use crate::notifications::TaskNotifier;
use crate::project_init::{initialize_project, validate_project_path};
use crate::project_registry::{ProjectRegistry, RecentProject};
use orkestra_core::orkestra_debug;
use serde::Serialize;
use std::path::PathBuf;
use tauri::{AppHandle, Emitter, Manager, State, WebviewUrl, WebviewWindowBuilder};
use tauri_plugin_store::StoreExt;

/// Response from opening a project.
#[derive(Debug, Serialize)]
pub struct OpenProjectResponse {
    /// Window label for the opened project.
    pub window_label: String,
    /// Project root path.
    pub project_root: String,
}

/// Information about a project.
#[derive(Debug, Serialize)]
pub struct ProjectInfo {
    /// Project root path.
    pub project_root: String,
    /// Whether git service is available.
    pub has_git: bool,
}

/// Payload for review-ready events.
#[derive(Debug, Clone, Serialize)]
struct ReviewReadyPayload {
    task_id: String,
    parent_id: Option<String>,
}

/// Open a project folder.
///
/// Creates a new window for the project if it's not already open.
/// If already open, focuses the existing window.
#[tauri::command]
pub async fn open_project(
    app_handle: AppHandle,
    registry: State<'_, ProjectRegistry>,
    path: String,
) -> Result<OpenProjectResponse, TauriError> {
    let project_path = PathBuf::from(&path);

    // Validate the path
    validate_project_path(&project_path).map_err(|e| {
        TauriError::new("INVALID_PROJECT_PATH", format!("Invalid project path: {e}"))
    })?;

    // Check if this project is already open
    if let Some(existing_label) = registry.is_open(&project_path)? {
        orkestra_debug!(
            "project",
            "Project already open in window '{existing_label}', focusing"
        );

        // Focus the existing window
        if let Some(window) = app_handle.get_webview_window(&existing_label) {
            window.set_focus().ok();
        }

        return Ok(OpenProjectResponse {
            window_label: existing_label,
            project_root: path,
        });
    }

    // Initialize the project (creates .orkestra if needed)
    let project_state = initialize_project(&project_path).map_err(|e| {
        TauriError::new(
            "PROJECT_INIT_FAILED",
            format!("Failed to initialize project: {e}"),
        )
    })?;

    // Clean up orphaned agents from previous crash
    if let Ok(api) = project_state.api() {
        match api.cleanup_orphaned_agents() {
            Ok(orphans) if orphans > 0 => {
                orkestra_debug!("project", "Cleaned up {} orphaned agent(s)", orphans);
            }
            Ok(_) => {}
            Err(e) => {
                orkestra_debug!("project", "Failed to clean up orphaned agents: {}", e);
            }
        }
    }

    // Clean up stale target lock from killed check scripts
    orkestra_core::workflow::cleanup_stale_target_lock(&project_path);

    // Generate window label
    let window_label = ProjectRegistry::label_for_path(&project_path);

    // Register the project state
    registry
        .register(window_label.clone(), project_state)
        .map_err(|e| {
            TauriError::new(
                "PROJECT_REGISTRATION_FAILED",
                format!("Failed to register project: {e}"),
            )
        })?;

    // Add to global project roots list for signal handler cleanup
    {
        let mut roots = crate::PROJECT_ROOTS.lock().unwrap();
        roots.push(project_path.clone());
    }

    // Create a new window for this project
    let url = format!("/?project={}", urlencoding::encode(&path));
    let _window = WebviewWindowBuilder::new(
        &app_handle,
        &window_label,
        WebviewUrl::App(url.parse().unwrap()),
    )
    .title("Orkestra")
    .inner_size(1200.0, 800.0)
    .build()
    .map_err(|e| {
        TauriError::new(
            "WINDOW_CREATE_FAILED",
            format!("Failed to create window: {e}"),
        )
    })?;

    orkestra_debug!(
        "project",
        "Created window '{}' for project {}",
        window_label,
        path
    );

    // Start orchestrator for this project
    start_project_orchestrator(&app_handle, &window_label);

    // Update recent projects
    add_to_recents(&app_handle, &path)?;

    Ok(OpenProjectResponse {
        window_label,
        project_root: path,
    })
}

/// Get information about the current project.
#[tauri::command]
pub fn get_project_info(
    registry: State<ProjectRegistry>,
    window: tauri::Window,
) -> Result<ProjectInfo, TauriError> {
    registry.with_project(window.label(), |state| {
        Ok(ProjectInfo {
            project_root: state.project_root().display().to_string(),
            has_git: state.has_git_service(),
        })
    })
}

/// Get recent projects list.
#[tauri::command]
pub fn get_recent_projects(app_handle: AppHandle) -> Result<Vec<RecentProject>, TauriError> {
    let store = app_handle
        .store("recents.json")
        .map_err(|e| TauriError::new("STORE_ERROR", format!("Failed to open store: {e}")))?;

    let recents: Vec<RecentProject> = store
        .get("recent_projects")
        .and_then(|v| serde_json::from_value(v.clone()).ok())
        .unwrap_or_default();

    Ok(recents)
}

/// Remove a project from recents.
#[tauri::command]
pub fn remove_recent_project(
    app_handle: AppHandle,
    path: String,
) -> Result<Vec<RecentProject>, TauriError> {
    let store = app_handle
        .store("recents.json")
        .map_err(|e| TauriError::new("STORE_ERROR", format!("Failed to open store: {e}")))?;

    let mut recents: Vec<RecentProject> = store
        .get("recent_projects")
        .and_then(|v| serde_json::from_value(v.clone()).ok())
        .unwrap_or_default();

    recents.retain(|r| r.path != path);

    store.set("recent_projects", serde_json::to_value(&recents).unwrap());
    // Recent projects are best-effort: failure to persist doesn't break functionality
    // (user can re-open via folder picker). Silent failure is acceptable here.
    store.save().ok();

    Ok(recents)
}

/// Pick a folder using the native dialog.
#[tauri::command]
pub async fn pick_folder(app: AppHandle) -> Result<Option<String>, TauriError> {
    use tauri_plugin_dialog::DialogExt;

    let path = app.dialog().file().blocking_pick_folder();

    Ok(path.as_ref().map(std::string::ToString::to_string))
}

// =============================================================================
// Helper Functions
// =============================================================================

/// Start the orchestrator loop for a project.
fn start_project_orchestrator(app_handle: &AppHandle, window_label: &str) {
    let registry: State<ProjectRegistry> = app_handle.state();

    // Extract the data we need from ProjectState
    let (api, config, project_root, store, stop_flag) =
        match registry.with_project(window_label, |state| {
            Ok((
                state.api_arc(),
                state.config().clone(),
                state.project_root().to_path_buf(),
                state.create_store(),
                state.stop_flag.clone(),
            ))
        }) {
            Ok(data) => data,
            Err(e) => {
                orkestra_debug!("orchestrator", "Failed to get project state: {}", e);
                return;
            }
        };

    // Create StageExecutionService externally so we can share it with ProjectState
    let iteration_service = {
        let api_lock = api.lock().unwrap();
        api_lock.iteration_service().clone()
    };

    let stage_executor = std::sync::Arc::new(orkestra_core::workflow::StageExecutionService::new(
        config.clone(),
        project_root.clone(),
        store.clone(),
        iteration_service,
    ));

    // Inject AgentKiller into WorkflowApi so interrupt() can kill agents internally
    {
        let mut api_lock = api.lock().unwrap();
        api_lock.set_agent_killer(std::sync::Arc::clone(&stage_executor)
            as std::sync::Arc<dyn orkestra_core::workflow::AgentKiller>);
    }

    let app_handle = app_handle.clone();
    let window_label_owned = window_label.to_string();
    let window_label_for_log = window_label.to_string();

    std::thread::spawn(move || {
        // Create orchestrator with the shared executor
        let orchestrator = orkestra_core::workflow::OrchestratorLoop::new(api, stage_executor);

        // Share stop flag with orchestrator
        let orch_stop = orchestrator.stop_flag();

        // Forward stop signal
        let stop_flag_clone = stop_flag.clone();
        std::thread::spawn(move || {
            while !stop_flag_clone.load(std::sync::atomic::Ordering::Relaxed) {
                std::thread::sleep(std::time::Duration::from_millis(100));
            }
            orch_stop.store(true, std::sync::atomic::Ordering::Relaxed);
        });

        orchestrator.run(move |event| {
            handle_orchestrator_event(&app_handle, &window_label_owned, &event);
        });

        orkestra_debug!(
            "orchestrator",
            "Stopped orchestrator for {}",
            window_label_for_log
        );
    });
}

/// Handle orchestrator events for a specific project window.
#[allow(clippy::too_many_lines)]
fn handle_orchestrator_event(
    app_handle: &AppHandle,
    window_label: &str,
    event: &orkestra_core::workflow::OrchestratorEvent,
) {
    use orkestra_core::workflow::OrchestratorEvent;

    // Get the window for this project
    let Some(window) = app_handle.get_webview_window(window_label) else {
        return;
    };

    match event {
        OrchestratorEvent::AgentSpawned {
            task_id,
            stage,
            pid,
        } => {
            orkestra_debug!(
                "orchestrator",
                "[{}] Spawned {} agent for {} (pid: {})",
                window_label,
                stage,
                task_id,
                pid
            );
            let _ = window.emit("task-updated", task_id);
        }
        OrchestratorEvent::OutputProcessed {
            task_id,
            stage,
            output_type,
        } => {
            orkestra_debug!(
                "orchestrator",
                "[{}] Processed {} output from {} for {}",
                window_label,
                output_type,
                stage,
                task_id
            );
            let _ = window.emit("task-updated", task_id);

            let registry: tauri::State<ProjectRegistry> = app_handle.state();
            if let Ok(task) = registry.with_project(window_label, |state| {
                state.api()?.get_task(task_id).map_err(Into::into)
            }) {
                if task.phase.needs_human_action() {
                    let notifier = TaskNotifier::new(app_handle, window_label);
                    notifier.stage_review_needed(task_id, &task.title, stage, output_type);

                    // Emit review-ready event for smart frontend navigation
                    let _ = window.emit(
                        "review-ready",
                        ReviewReadyPayload {
                            task_id: task_id.to_string(),
                            parent_id: task.parent_id.clone(),
                        },
                    );
                }
            }
        }
        OrchestratorEvent::Error { task_id, error } => {
            orkestra_debug!("orchestrator", "[{}] Error: {}", window_label, error);
            if let Some(id) = task_id {
                let _ = window.emit("task-updated", id);
                TaskNotifier::new(app_handle, window_label).task_error(id, error);
            }
        }
        OrchestratorEvent::IntegrationStarted { task_id, branch } => {
            orkestra_debug!(
                "orchestrator",
                "[{}] Starting integration for {} (branch: {})",
                window_label,
                task_id,
                branch
            );
            let _ = window.emit("task-updated", task_id);
        }
        OrchestratorEvent::IntegrationCompleted { task_id } => {
            orkestra_debug!(
                "orchestrator",
                "[{}] Integration completed for {}",
                window_label,
                task_id
            );
            let _ = window.emit("task-updated", task_id);
        }
        OrchestratorEvent::IntegrationFailed {
            task_id,
            error,
            conflict_files,
        } => {
            orkestra_debug!(
                "orchestrator",
                "[{}] Integration failed for {}: {}",
                window_label,
                task_id,
                error
            );
            let _ = window.emit("task-updated", task_id);
            let notifier = TaskNotifier::new(app_handle, window_label);
            if conflict_files.is_empty() {
                notifier.task_error(task_id, error);
            } else {
                notifier.merge_conflict(task_id, conflict_files.len());
            }
        }
        OrchestratorEvent::ScriptSpawned {
            task_id,
            stage,
            command,
            pid,
        } => {
            orkestra_debug!(
                "orchestrator",
                "[{}] Spawned script for {}/{}: {} (pid: {})",
                window_label,
                task_id,
                stage,
                command,
                pid
            );
            let _ = window.emit("task-updated", task_id);
        }
        OrchestratorEvent::ScriptCompleted { task_id, stage } => {
            orkestra_debug!(
                "orchestrator",
                "[{}] Script completed for {}/{}",
                window_label,
                task_id,
                stage
            );
            let _ = window.emit("task-updated", task_id);
        }
        OrchestratorEvent::ScriptFailed {
            task_id,
            stage,
            error,
            recovery_stage,
        } => {
            let recovery = recovery_stage.as_deref().unwrap_or("none");
            orkestra_debug!(
                "orchestrator",
                "[{}] Script failed for {}/{}: {} (recovery: {})",
                window_label,
                task_id,
                stage,
                error,
                recovery
            );
            let _ = window.emit("task-updated", task_id);
        }
        OrchestratorEvent::ParentAdvanced {
            task_id,
            subtask_count,
        } => {
            orkestra_debug!(
                "orchestrator",
                "[{}] Parent {} advanced: all {} subtasks done",
                window_label,
                task_id,
                subtask_count
            );
            let _ = window.emit("task-updated", task_id);
        }
        OrchestratorEvent::PrCreationStarted { task_id, branch } => {
            orkestra_debug!(
                "orchestrator",
                "[{}] Starting PR creation for {} (branch: {})",
                window_label,
                task_id,
                branch
            );
            let _ = window.emit("task-updated", task_id);
        }
        OrchestratorEvent::PrCreationCompleted { task_id, pr_url } => {
            orkestra_debug!(
                "orchestrator",
                "[{}] PR creation completed for {}: {}",
                window_label,
                task_id,
                pr_url
            );
            let _ = window.emit("task-updated", task_id);
        }
        OrchestratorEvent::PrCreationFailed { task_id, error } => {
            orkestra_debug!(
                "orchestrator",
                "[{}] PR creation failed for {}: {}",
                window_label,
                task_id,
                error
            );
            let _ = window.emit("task-updated", task_id);
            TaskNotifier::new(app_handle, window_label).task_error(task_id, error);
        }
    }
}

/// Add a project to the recents list.
fn add_to_recents(app_handle: &AppHandle, path: &str) -> Result<(), TauriError> {
    let store = app_handle
        .store("recents.json")
        .map_err(|e| TauriError::new("STORE_ERROR", format!("Failed to open store: {e}")))?;

    let mut recents: Vec<RecentProject> = store
        .get("recent_projects")
        .and_then(|v| serde_json::from_value(v.clone()).ok())
        .unwrap_or_default();

    // Remove existing entry if present
    recents.retain(|r| r.path != path);

    // Add to front
    let display_name = std::path::Path::new(path)
        .file_name()
        .and_then(|n| n.to_str())
        .unwrap_or(path)
        .to_string();

    recents.insert(
        0,
        RecentProject {
            path: path.to_string(),
            display_name,
            last_opened: chrono::Utc::now().to_rfc3339(),
        },
    );

    // Keep only last 10
    recents.truncate(10);

    store.set("recent_projects", serde_json::to_value(&recents).unwrap());
    // Recent projects are best-effort: failure to persist doesn't break functionality
    // (user can re-open via folder picker). Silent failure is acceptable here.
    store.save().ok();

    Ok(())
}
