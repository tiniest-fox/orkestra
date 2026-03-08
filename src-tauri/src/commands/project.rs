//! Project management commands.

use crate::commands::queries::StartupData;
use crate::error::TauriError;
use crate::notifications::TaskNotifier;
use crate::project_init::{initialize_project, validate_project_path};
use crate::project_registry::{ProjectRegistry, RecentProject};
use orkestra_core::orkestra_debug;
use serde::Serialize;
use std::path::PathBuf;
use std::sync::atomic::Ordering;
use tauri::{AppHandle, Emitter, Manager, State, WebviewUrl, WebviewWindowBuilder};
use tauri_plugin_store::StoreExt;

pub use orkestra_types::config::ProjectInfo;

/// Response from opening a project.
#[derive(Debug, Serialize)]
pub struct OpenProjectResponse {
    /// Window label for the opened project.
    pub window_label: String,
    /// Project root path.
    pub project_root: String,
}

/// Payload for the `startup-error` event.
#[derive(Debug, Clone, Serialize)]
pub struct StartupError {
    pub message: String,
}

/// Payload for review-ready events.
#[derive(Debug, Clone, Serialize)]
struct ReviewReadyPayload {
    task_id: String,
    parent_id: Option<String>,
}

/// Spawn a background thread that pre-fetches tasks and emits a `startup-data` event.
///
/// Runs concurrently with JS bundle load. Stores result in the startup slot for
/// `workflow_get_startup_data` as a fallback if the event fires before the listener.
pub fn spawn_startup_prefetch(
    registry: &ProjectRegistry,
    window_label: &str,
    window: tauri::WebviewWindow,
) {
    let Ok(api_arc) = registry.with_project(window_label, |s| Ok(s.api_arc())) else {
        return;
    };
    let Ok(config) = registry.with_project(window_label, |s| Ok(s.config().clone())) else {
        return;
    };
    let Ok(slot) = registry.with_project(window_label, |s| Ok(s.startup_tasks())) else {
        return;
    };

    std::thread::spawn(move || {
        let tasks = api_arc
            .lock()
            .ok()
            .and_then(|api| api.list_task_views().ok())
            .unwrap_or_default();

        *slot.lock().unwrap() = Some(tasks.clone());
        let _ = window.emit("startup-data", StartupData { config, tasks });
    });
}

/// Spawn a background thread to initialize a project and emit startup events.
///
/// On success: calls `spawn_startup_prefetch` which emits `startup-data`.
/// On failure: emits `startup-error { message }` to the window.
pub fn spawn_background_startup(app_handle: AppHandle, window_label: &str, path: &str) {
    let window_label = window_label.to_string();
    let path = path.to_string();

    std::thread::spawn(
        move || match startup_register_project(&app_handle, &window_label, &path) {
            Ok(()) => {
                let registry: tauri::State<ProjectRegistry> = app_handle.state();
                if let Some(window) = app_handle.get_webview_window(&window_label) {
                    spawn_startup_prefetch(&registry, &window_label, window);
                }
            }
            Err(e) => {
                if let Some(window) = app_handle.get_webview_window(&window_label) {
                    let _ = window.emit("startup-error", StartupError { message: e.message });
                }
            }
        },
    );
}

/// Retry project startup from the React frontend.
///
/// Removes any partial registration and spawns a new background init thread.
/// Returns immediately — the frontend listens for `startup-data` or `startup-error`.
#[tauri::command]
pub fn workflow_retry_startup(
    app_handle: AppHandle,
    registry: State<'_, ProjectRegistry>,
    window: tauri::Window,
    path: String,
) {
    let window_label = window.label().to_string();

    // Stop orchestrator and remove any partial registration, ignoring not-found.
    if let Ok(Some(state)) = registry.remove(&window_label) {
        state.stop_flag.store(true, Ordering::Relaxed);
    }

    spawn_background_startup(app_handle, &window_label, &path);
}

/// Register a project under the calling window's label without creating a new window.
///
/// Called from the picker UI. After this returns `Ok`, the frontend navigates
/// to `/?project={path}` in the same window, reloading it as a project window.
#[tauri::command]
pub async fn load_project_in_window(
    app_handle: AppHandle,
    registry: State<'_, ProjectRegistry>,
    window: tauri::Window,
    path: String,
) -> Result<(), TauriError> {
    let project_path = PathBuf::from(&path);
    let window_label = window.label().to_string();

    validate_project_path(&project_path).map_err(|e| {
        TauriError::new("INVALID_PROJECT_PATH", format!("Invalid project path: {e}"))
    })?;

    let project_state = initialize_project(&project_path, registry.run_pids()).map_err(|e| {
        TauriError::new(
            "PROJECT_INIT_FAILED",
            format!("Failed to initialize project: {e}"),
        )
    })?;

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

    orkestra_core::workflow::cleanup_stale_target_lock(&project_path);

    registry
        .register(window_label.clone(), project_state)
        .map_err(|e| {
            TauriError::new(
                "PROJECT_REGISTRATION_FAILED",
                format!("Failed to register project: {e}"),
            )
        })?;

    {
        let mut roots = crate::PROJECT_ROOTS.lock().unwrap();
        roots.push(project_path);
    }

    orkestra_debug!(
        "project",
        "Registered project {} under window '{}'",
        path,
        window_label
    );

    start_project_orchestrator(&app_handle, &window_label);
    add_to_recents(&app_handle, &path)?;

    if let Some(webview_window) = app_handle.get_webview_window(&window_label) {
        spawn_startup_prefetch(&registry, &window_label, webview_window);
    }

    Ok(())
}

/// Initialize a project and register it under `window_label` without creating a window.
///
/// Used during startup to pre-register the last project so the picker window
/// opens directly at `/?project={path}`. Called synchronously in setup before
/// the window is created, ensuring commands work immediately after page load.
pub fn startup_register_project(
    app_handle: &AppHandle,
    window_label: &str,
    path: &str,
) -> Result<(), TauriError> {
    let project_path = PathBuf::from(path);

    let run_pids = {
        let registry: tauri::State<'_, ProjectRegistry> = app_handle.state();
        registry.run_pids()
    };

    let project_state = initialize_project(&project_path, run_pids).map_err(|e| {
        TauriError::new(
            "PROJECT_INIT_FAILED",
            format!("Failed to initialize project: {e}"),
        )
    })?;

    if let Ok(api) = project_state.api() {
        match api.cleanup_orphaned_agents() {
            Ok(orphans) if orphans > 0 => {
                orkestra_debug!(
                    "project",
                    "Cleaned up {} orphaned agent(s) on startup",
                    orphans
                );
            }
            Ok(_) => {}
            Err(e) => {
                orkestra_debug!("project", "Failed to clean up orphaned agents: {}", e);
            }
        }
    }

    orkestra_core::workflow::cleanup_stale_target_lock(&project_path);

    let registry: tauri::State<'_, ProjectRegistry> = app_handle.state();
    registry
        .register(window_label.to_string(), project_state)
        .map_err(|e| {
            TauriError::new(
                "PROJECT_REGISTRATION_FAILED",
                format!("Failed to register project: {e}"),
            )
        })?;

    {
        let mut roots = crate::PROJECT_ROOTS.lock().unwrap();
        roots.push(project_path);
    }

    add_to_recents(app_handle, path)?;
    start_project_orchestrator(app_handle, window_label);

    Ok(())
}

/// Open a project folder.
///
/// Creates a new window for the project immediately, then initializes the project
/// in a background thread. The window emits `startup-data` on success or
/// `startup-error` on failure (allowing the React app to show a retry button).
///
/// Only returns an error to the picker if the path doesn't exist or is already open.
#[tauri::command]
pub async fn open_project(
    app_handle: AppHandle,
    registry: State<'_, ProjectRegistry>,
    path: String,
) -> Result<OpenProjectResponse, TauriError> {
    let project_path = PathBuf::from(&path);

    // Validate the path exists — errors here stay in the picker (nothing to retry in a window).
    validate_project_path(&project_path).map_err(|e| {
        TauriError::new("INVALID_PROJECT_PATH", format!("Invalid project path: {e}"))
    })?;

    // Check if this project is already open
    if let Some(existing_label) = registry.is_open(&project_path)? {
        orkestra_debug!(
            "project",
            "Project already open in window '{existing_label}', focusing"
        );

        if let Some(window) = app_handle.get_webview_window(&existing_label) {
            window.set_focus().ok();
        }

        return Ok(OpenProjectResponse {
            window_label: existing_label,
            project_root: path,
        });
    }

    // Generate window label
    let window_label = ProjectRegistry::label_for_path(&project_path);

    // Open the window immediately at /?project=... — React mounts and waits for startup events.
    let url = format!("/?project={}", urlencoding::encode(&path));
    WebviewWindowBuilder::new(
        &app_handle,
        &window_label,
        WebviewUrl::App(url.parse().unwrap()),
    )
    .title("")
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

    // Initialize project in background — emits startup-data or startup-error to the window.
    spawn_background_startup(app_handle, &window_label, &path);

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
        let has_run_script = state
            .project_root()
            .join(crate::run_process::RUN_SCRIPT_RELATIVE_PATH)
            .exists();
        Ok(ProjectInfo {
            project_root: state.project_root().display().to_string(),
            has_git: state.has_git_service(),
            has_gh_cli: state.has_gh_cli(),
            has_run_script,
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
                if task.state.needs_human_action() {
                    let notifier = TaskNotifier::new(app_handle, window_label);
                    notifier.stage_review_needed(task_id, &task.title, stage, output_type);

                    // Emit review-ready event for smart frontend navigation
                    let _ = window.emit(
                        "review-ready",
                        ReviewReadyPayload {
                            task_id: task_id.clone(),
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

            // Best-effort: stop any run script still active for this task.
            let registry: tauri::State<ProjectRegistry> = app_handle.state();
            let task_id_clone = task_id.clone();
            registry
                .with_project(window_label, |state| {
                    state.run_processes().stop(&task_id_clone);
                    Ok(())
                })
                .ok();
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
        OrchestratorEvent::GateSpawned {
            task_id,
            stage,
            command,
            pid,
        } => {
            orkestra_debug!(
                "orchestrator",
                "[{}] Spawned gate for {}/{}: {} (pid: {})",
                window_label,
                task_id,
                stage,
                command,
                pid
            );
            let _ = window.emit("task-updated", task_id);
        }
        OrchestratorEvent::GatePassed { task_id, stage } => {
            orkestra_debug!(
                "orchestrator",
                "[{}] Gate passed for {}/{}",
                window_label,
                task_id,
                stage
            );
            let _ = window.emit("task-updated", task_id);
        }
        OrchestratorEvent::GateFailed {
            task_id,
            stage,
            error,
        } => {
            orkestra_debug!(
                "orchestrator",
                "[{}] Gate failed for {}/{}: {}",
                window_label,
                task_id,
                stage,
                error
            );
            let _ = window.emit("task-updated", task_id);
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
