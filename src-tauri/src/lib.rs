// Tauri commands require owned types for serialization
#![allow(clippy::needless_pass_by_value)]

mod commands;
mod error;
mod highlight;
mod project_init;
mod project_registry;

use orkestra_core::orkestra_debug;
use project_registry::ProjectRegistry;
use tauri::{AppHandle, Manager};
use tauri_plugin_notification::NotificationExt;

use std::sync::Arc;

// =============================================================================
// Desktop Notifications
// =============================================================================

/// Request notification permission from the OS on startup.
fn request_notification_permission(app_handle: &AppHandle) {
    let notification = app_handle.notification();

    match notification.permission_state() {
        Ok(tauri::plugin::PermissionState::Granted) => {
            orkestra_debug!("notification", "Notification permission: granted");
        }
        Ok(state) => {
            orkestra_debug!(
                "notification",
                "Notification permission state: {state:?}, requesting permission"
            );
            match notification.request_permission() {
                Ok(tauri::plugin::PermissionState::Granted) => {
                    orkestra_debug!("notification", "Notification permission granted");
                }
                Ok(state) => {
                    orkestra_debug!(
                        "notification",
                        "Notification permission not granted: {state:?}. \
                         Enable notifications in System Settings to receive task alerts."
                    );
                }
                Err(e) => {
                    orkestra_debug!(
                        "notification",
                        "Failed to request notification permission: {e}"
                    );
                }
            }
        }
        Err(e) => {
            orkestra_debug!(
                "notification",
                "Failed to check notification permission: {e}"
            );
        }
    }

    if tauri::is_dev() {
        orkestra_debug!(
            "notification",
            "Dev mode: notifications appear under Terminal in System Settings. \
             Ensure Terminal notifications are enabled in System Settings > Notifications."
        );
    }
}

// =============================================================================
// Cleanup and Signal Handling
// =============================================================================

/// Cleanup function to kill all tracked agents for all open projects.
fn cleanup_all_agents(app_handle: &AppHandle) {
    orkestra_debug!("cleanup", "Killing agents for all open projects...");

    let registry: tauri::State<ProjectRegistry> = app_handle.state();
    let Ok(project_roots) = registry.all_project_roots() else {
        orkestra_debug!("cleanup", "Failed to get project roots");
        return;
    };

    for project_root in project_roots {
        let db_path = project_root.join(".orkestra/orkestra.db");
        if !db_path.exists() {
            continue;
        }

        let Ok(conn) = orkestra_core::adapters::sqlite::DatabaseConnection::open(&db_path) else {
            continue;
        };

        let workflow_config =
            orkestra_core::workflow::load_workflow_for_project(&project_root).unwrap_or_default();
        let store = orkestra_core::workflow::SqliteWorkflowStore::new(conn.shared());
        let api = orkestra_core::workflow::WorkflowApi::new(workflow_config, Arc::new(store));

        match api.kill_running_agents() {
            Ok(killed) if killed > 0 => {
                orkestra_debug!(
                    "cleanup",
                    "Killed {} agent(s) for {}",
                    killed,
                    project_root.display()
                );
            }
            Ok(_) => {}
            Err(e) => {
                orkestra_debug!(
                    "cleanup",
                    "Failed to kill agents for {}: {}",
                    project_root.display(),
                    e
                );
            }
        }

        // Checkpoint database
        if let Err(e) = conn.checkpoint() {
            orkestra_debug!(
                "cleanup",
                "WAL checkpoint failed for {}: {}",
                project_root.display(),
                e
            );
        }
    }
}

/// Set up signal handlers to clean up agents on termination signals (Unix only).
#[cfg(unix)]
fn setup_signal_handlers() {
    use signal_hook::consts::{SIGHUP, SIGINT, SIGTERM};
    use signal_hook::iterator::Signals;

    std::thread::spawn(move || {
        let mut signals = match Signals::new([SIGTERM, SIGINT, SIGHUP]) {
            Ok(s) => s,
            Err(e) => {
                eprintln!("[signal] Failed to register signal handlers: {e}");
                return;
            }
        };

        if let Some(sig) = signals.forever().next() {
            eprintln!("[signal] Received signal {sig}, exiting...");
            std::process::exit(128 + sig);
        }
    });
}

#[cfg(not(unix))]
fn setup_signal_handlers() {
    // Signal handlers not supported on non-Unix platforms
}

// =============================================================================
// Window Close Handling
// =============================================================================

/// Handle window close events.
fn handle_window_close(app_handle: &AppHandle, window_label: &str) {
    orkestra_debug!("window", "Closing window '{}'", window_label);

    let registry: tauri::State<ProjectRegistry> = app_handle.state();

    // Get the project state to kill agents and checkpoint database
    if let Ok(Some(state)) = registry.remove(window_label) {
        // Stop orchestrator
        state
            .stop_flag
            .store(true, std::sync::atomic::Ordering::Relaxed);

        // Kill running agents
        if let Ok(api) = state.api() {
            match api.kill_running_agents() {
                Ok(killed) if killed > 0 => {
                    orkestra_debug!(
                        "cleanup",
                        "Killed {} agent(s) for '{}'",
                        killed,
                        window_label
                    );
                }
                Ok(_) => {}
                Err(e) => {
                    orkestra_debug!("cleanup", "Failed to kill agents: {}", e);
                }
            }
        }

        // Checkpoint database
        state.checkpoint_database();
    }

    // Check if this was the last window
    let remaining_count = app_handle.webview_windows().len();
    if remaining_count <= 1 {
        // This is the last window, quit the app
        orkestra_debug!("window", "Last window closed, quitting application");
        app_handle.exit(0);
    }
}

// =============================================================================
// Application Entry Point
// =============================================================================

/// Run the Tauri application.
///
/// # Panics
///
/// Panics if the Tauri application fails to build (e.g., missing resources).
#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    // Set up signal handlers
    setup_signal_handlers();

    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_store::Builder::new().build())
        .setup(|app| {
            // Create and register the project registry
            app.manage(ProjectRegistry::new());

            // Initialize syntax highlighter (Send + Sync, shared across commands)
            app.manage(highlight::SyntaxHighlighter::new());

            // Request notification permission
            request_notification_permission(app.handle());

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            // Project commands
            commands::open_project,
            commands::get_project_info,
            commands::get_recent_projects,
            commands::remove_recent_project,
            commands::pick_folder,
            // Workflow commands
            commands::workflow_get_tasks,
            commands::workflow_create_task,
            commands::workflow_create_subtask,
            commands::workflow_get_task,
            commands::workflow_delete_task,
            commands::workflow_list_subtasks,
            commands::workflow_get_archived_tasks,
            commands::workflow_approve,
            commands::workflow_reject,
            commands::workflow_answer_questions,
            commands::workflow_integrate_task,
            commands::workflow_retry,
            commands::workflow_set_auto_mode,
            commands::workflow_get_config,
            commands::workflow_get_auto_task_templates,
            commands::workflow_get_iterations,
            commands::workflow_get_artifact,
            commands::workflow_get_pending_questions,
            commands::workflow_get_current_stage,
            commands::workflow_get_rejection_feedback,
            commands::workflow_list_branches,
            commands::workflow_get_stages_with_logs,
            commands::workflow_get_logs,
            commands::workflow_get_task_diff,
            commands::workflow_get_file_content,
            commands::workflow_get_syntax_css,
            commands::open_in_terminal,
            commands::open_in_editor,
            commands::detect_external_tools,
        ])
        .build(tauri::generate_context!())
        .expect("error while building tauri application")
        .run(|app_handle, event| match event {
            tauri::RunEvent::Exit => {
                cleanup_all_agents(app_handle);
            }
            tauri::RunEvent::WindowEvent {
                label,
                event: tauri::WindowEvent::CloseRequested { .. },
                ..
            } => {
                handle_window_close(app_handle, &label);
            }
            _ => {}
        });
}
