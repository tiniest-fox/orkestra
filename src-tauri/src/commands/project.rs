//! Project lifecycle commands for multi-window project management.

use crate::{
    error::TauriError,
    project_init::{initialize_orkestra_dir, validate_project_path},
    project_registry::{ProjectRegistry, RecentProject},
    startup::{initialize_project, start_project_orchestrator},
};
use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};
use tauri::{AppHandle, Manager, State, WebviewUrl, WebviewWindowBuilder};
use tauri_plugin_dialog::DialogExt;
use tauri_plugin_store::StoreExt;

const RECENT_PROJECTS_KEY: &str = "recent_projects";
const MAX_RECENT_PROJECTS: usize = 20;

/// Project information for the current window.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ProjectInfo {
    /// Absolute path to the project directory.
    pub path: String,
    /// Display name derived from folder name.
    pub display_name: String,
}

/// Open a project in a new window.
///
/// If the project is already open, focuses the existing window instead.
/// If the project path doesn't have `.orkestra`, creates it silently.
#[tauri::command]
pub fn open_project(
    app_handle: AppHandle,
    registry: State<ProjectRegistry>,
    path: String,
) -> Result<(), TauriError> {
    let project_path = PathBuf::from(&path);

    // Check if project is already open
    if let Some(existing_label) = registry.is_open(&project_path)? {
        // Focus existing window
        if let Some(window) = app_handle.get_webview_window(&existing_label) {
            window.set_focus().map_err(|e| {
                TauriError::new("WINDOW_ERROR", format!("Failed to focus window: {e}"))
            })?;
            return Ok(());
        }
    }

    // Validate project path
    validate_project_path(&project_path)
        .map_err(|e| TauriError::new("INVALID_PROJECT_PATH", e.to_string()))?;

    // Initialize .orkestra directory if missing
    initialize_orkestra_dir(&project_path)
        .map_err(|e| TauriError::new("INIT_FAILED", e.to_string()))?;

    // Initialize project state
    let project_state = initialize_project(&project_path).map_err(|status| {
        let error_msg = match status {
            crate::startup::StartupStatus::Failed { errors } => errors
                .into_iter()
                .map(|e| e.message)
                .collect::<Vec<_>>()
                .join("; "),
            _ => "Unknown initialization error".to_string(),
        };
        TauriError::new("INIT_FAILED", error_msg)
    })?;

    // Generate window label from path
    let label = ProjectRegistry::label_for_path(&project_path);

    // Register project in registry
    registry.register(label.clone(), project_state)?;

    // Create new window with project query parameter
    let url_encoded_path = urlencoding::encode(&path);
    let url = format!("index.html?project={url_encoded_path}");

    // Extract folder name for window title
    let folder_name = project_path
        .file_name()
        .and_then(|n| n.to_str())
        .unwrap_or("Orkestra");

    WebviewWindowBuilder::new(&app_handle, &label, WebviewUrl::App(url.into()))
        .title(folder_name)
        .build()
        .map_err(|e| TauriError::new("WINDOW_ERROR", format!("Failed to create window: {e}")))?;

    // Start orchestrator for this project
    if let Ok(project) = registry.get(&label) {
        start_project_orchestrator(app_handle.clone(), &project);

        // Add to global project roots list for signal handler cleanup
        {
            let mut roots = crate::PROJECT_ROOTS.lock().unwrap();
            if !roots.contains(&project_path) {
                roots.push(project_path.clone());
            }
        }
    }

    // Update recent projects
    update_recent_projects(&app_handle, &path)?;

    Ok(())
}

/// Get the list of recently opened projects.
#[tauri::command]
pub fn get_recent_projects(app_handle: AppHandle) -> Result<Vec<RecentProject>, TauriError> {
    let store = app_handle
        .store("store.json")
        .map_err(|e| TauriError::new("STORE_ERROR", format!("Failed to access store: {e}")))?;

    let recents: Vec<RecentProject> = store
        .get(RECENT_PROJECTS_KEY)
        .and_then(|v| serde_json::from_value(v.clone()).ok())
        .unwrap_or_default();

    // Filter out entries whose paths no longer exist
    let valid_recents: Vec<RecentProject> = recents
        .into_iter()
        .filter(|r| Path::new(&r.path).exists())
        .collect();

    // Sort by last_opened descending (most recent first)
    let mut sorted = valid_recents;
    sorted.sort_by(|a, b| b.last_opened.cmp(&a.last_opened));

    Ok(sorted)
}

/// Remove a project from the recent projects list.
#[tauri::command]
pub fn remove_recent_project(app_handle: AppHandle, path: String) -> Result<(), TauriError> {
    let store = app_handle
        .store("store.json")
        .map_err(|e| TauriError::new("STORE_ERROR", format!("Failed to access store: {e}")))?;

    let mut recents: Vec<RecentProject> = store
        .get(RECENT_PROJECTS_KEY)
        .and_then(|v| serde_json::from_value(v.clone()).ok())
        .unwrap_or_default();

    recents.retain(|r| r.path != path);

    store.set(RECENT_PROJECTS_KEY, serde_json::to_value(&recents).unwrap());
    store
        .save()
        .map_err(|e| TauriError::new("STORE_ERROR", format!("Failed to save store: {e}")))?;

    Ok(())
}

/// Open a native folder picker dialog.
///
/// Returns the selected path or None if the user cancelled.
#[tauri::command]
pub fn pick_folder(app_handle: AppHandle) -> Result<Option<String>, TauriError> {
    use std::sync::mpsc;
    use tauri_plugin_dialog::FilePath;

    let (tx, rx) = mpsc::channel();

    app_handle.dialog().file().pick_folder(move |result| {
        let path = result.and_then(|file_path| {
            if let FilePath::Path(p) = file_path {
                Some(p.to_string_lossy().to_string())
            } else {
                None
            }
        });
        let _ = tx.send(path);
    });

    rx.recv()
        .map_err(|e| TauriError::new("DIALOG_ERROR", format!("Dialog channel error: {e}")))
}

/// Get project information for the current window.
#[tauri::command]
pub fn get_project_info(
    registry: State<ProjectRegistry>,
    window: tauri::Window,
) -> Result<ProjectInfo, TauriError> {
    let label = window.label();
    let project = registry.get(label)?;

    let path = project.project_root().to_string_lossy().to_string();
    let display_name = project
        .project_root()
        .file_name()
        .and_then(|n| n.to_str())
        .unwrap_or("Unknown")
        .to_string();

    Ok(ProjectInfo { path, display_name })
}

// =============================================================================
// Helper Functions
// =============================================================================

/// Update the recent projects list with the given path.
fn update_recent_projects(app_handle: &AppHandle, path: &str) -> Result<(), TauriError> {
    let store = app_handle
        .store("store.json")
        .map_err(|e| TauriError::new("STORE_ERROR", format!("Failed to access store: {e}")))?;

    let mut recents: Vec<RecentProject> = store
        .get(RECENT_PROJECTS_KEY)
        .and_then(|v| serde_json::from_value(v.clone()).ok())
        .unwrap_or_default();

    // Remove existing entry for this path
    recents.retain(|r| r.path != path);

    // Extract folder name for display
    let display_name = Path::new(path)
        .file_name()
        .and_then(|n| n.to_str())
        .unwrap_or("Unknown")
        .to_string();

    // Add new entry at the front
    let now = chrono::Utc::now().to_rfc3339();
    recents.insert(
        0,
        RecentProject {
            path: path.to_string(),
            display_name,
            last_opened: now,
        },
    );

    // Cap at MAX_RECENT_PROJECTS
    recents.truncate(MAX_RECENT_PROJECTS);

    // Save to store
    store.set(RECENT_PROJECTS_KEY, serde_json::to_value(&recents).unwrap());
    store
        .save()
        .map_err(|e| TauriError::new("STORE_ERROR", format!("Failed to save store: {e}")))?;

    Ok(())
}
