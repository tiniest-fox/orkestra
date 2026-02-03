// Tauri commands require owned types for serialization
#![allow(clippy::needless_pass_by_value)]

mod commands;
mod error;
mod highlight;
mod startup;
mod state;

use orkestra_core::{
    find_project_root, orkestra_debug,
    workflow::{load_workflow_for_project, OrchestratorLoop, Phase},
};
use startup::{run_startup, StartupState};
use tauri::{AppHandle, Emitter, Manager};
use tauri_plugin_notification::NotificationExt;

use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use std::thread;
use std::time::Duration;

/// Wrapper for the orchestrator stop flag, stored in Tauri state.
struct OrchestratorStopFlag(Arc<AtomicBool>);

/// Guard to prevent multiple initialization calls (e.g., from React `StrictMode` double-mount).
static INITIALIZATION_STARTED: AtomicBool = AtomicBool::new(false);

/// Command for frontend to trigger initialization after splash screen loads.
///
/// This ensures no background work runs until the UI is ready.
#[tauri::command]
fn begin_initialization(app_handle: AppHandle, stop_flag: tauri::State<OrchestratorStopFlag>) {
    // Prevent multiple initialization calls (e.g., from React StrictMode double-mount)
    if INITIALIZATION_STARTED.swap(true, Ordering::SeqCst) {
        orkestra_debug!(
            "startup",
            "Initialization already started, ignoring duplicate call"
        );
        return;
    }

    orkestra_debug!("startup", "UI ready, beginning initialization...");
    let stop_flag = stop_flag.0.clone();

    thread::spawn(move || {
        let startup_result = run_startup();

        // Register debug log hook to emit events to the frontend
        let debug_handle = app_handle.clone();
        orkestra_core::debug_log::set_hook(move |component, message| {
            let _ = debug_handle.emit("debug-log", format!("[{component}] {message}"));
        });

        // Request notification permission (triggers OS dialog if not yet determined)
        request_notification_permission(&app_handle);

        // If startup succeeded, register AppState and start orchestrator.
        // AppState MUST be registered before setting status to Ready,
        // because the frontend calls commands requiring State<AppState>
        // as soon as it sees the Ready status.
        if let Some(app_state) = startup_result.app_state {
            // Clean up orphaned agents from previous crash
            cleanup_orphaned_agents(&app_state);

            // Register AppState so commands can use it
            app_handle.manage(app_state);

            // Start the workflow orchestrator
            if let Some(app_state) = app_handle.try_state::<state::AppState>() {
                start_workflow_orchestrator(app_handle.clone(), &app_state, stop_flag);
            }
        }

        // Update the startup state with the result — this unblocks the frontend.
        // Must happen AFTER AppState is registered so commands are ready to serve.
        let startup_state: tauri::State<StartupState> = app_handle.state();
        startup_state.set_status(startup_result.status.clone());
    });
}

// =============================================================================
// Workflow Orchestrator
// =============================================================================

/// Start the workflow orchestrator loop (stage-agnostic).
///
/// This spawns a background thread that continuously checks for tasks
/// needing agents and spawns them as needed.
fn start_workflow_orchestrator(
    app_handle: AppHandle,
    app_state: &state::AppState,
    stop_flag: Arc<AtomicBool>,
) {
    let api = app_state.api_arc();
    let workflow = app_state.config().clone();
    let project_root = app_state.project_root().to_path_buf();
    let store = app_state.create_store();

    thread::spawn(move || {
        let orchestrator = OrchestratorLoop::for_project(api, workflow, project_root, store);

        // Share the stop flag with the orchestrator
        let orch_stop = orchestrator.stop_flag();

        // Forward stop signal from app to orchestrator
        let stop_flag_clone = stop_flag.clone();
        thread::spawn(move || {
            while !stop_flag_clone.load(Ordering::Relaxed) {
                thread::sleep(Duration::from_millis(100));
            }
            orch_stop.store(true, Ordering::Relaxed);
        });

        orchestrator.run(move |event| handle_orchestrator_event(&app_handle, &event));

        orkestra_debug!("orchestrator", "Stopped");
    });
}

/// Log an orchestrator event and emit a task-updated signal to the frontend.
fn handle_orchestrator_event(
    app_handle: &AppHandle,
    event: &orkestra_core::workflow::OrchestratorEvent,
) {
    match event {
        orkestra_core::workflow::OrchestratorEvent::AgentSpawned {
            task_id,
            stage,
            pid,
        } => {
            orkestra_debug!(
                "orchestrator",
                "Spawned {stage} agent for {task_id} (pid: {pid})"
            );
            let _ = app_handle.emit("task-updated", task_id);
        }
        orkestra_core::workflow::OrchestratorEvent::OutputProcessed {
            task_id,
            stage,
            output_type,
        } => {
            orkestra_debug!(
                "orchestrator",
                "Processed {output_type} output from {stage} for {task_id}"
            );
            let _ = app_handle.emit("task-updated", task_id);
            notify_if_review_needed(app_handle, task_id, stage, output_type);
        }
        orkestra_core::workflow::OrchestratorEvent::Error { task_id, error } => {
            orkestra_debug!("orchestrator", "Error: {error}");
            if let Some(id) = task_id {
                let _ = app_handle.emit("task-updated", id);
            }
        }
        orkestra_core::workflow::OrchestratorEvent::IntegrationStarted { task_id, branch } => {
            orkestra_debug!(
                "orchestrator",
                "Starting integration for {task_id} (branch: {branch})"
            );
            let _ = app_handle.emit("task-updated", task_id);
        }
        orkestra_core::workflow::OrchestratorEvent::IntegrationCompleted { task_id } => {
            orkestra_debug!("orchestrator", "Integration completed for {task_id}");
            let _ = app_handle.emit("task-updated", task_id);
        }
        orkestra_core::workflow::OrchestratorEvent::IntegrationFailed {
            task_id, error, ..
        } => {
            orkestra_debug!("orchestrator", "Integration failed for {task_id}: {error}");
            let _ = app_handle.emit("task-updated", task_id);
        }
        orkestra_core::workflow::OrchestratorEvent::ScriptSpawned {
            task_id,
            stage,
            command,
            pid,
        } => {
            orkestra_debug!(
                "orchestrator",
                "Spawned script for {task_id}/{stage}: {command} (pid: {pid})"
            );
            let _ = app_handle.emit("task-updated", task_id);
        }
        orkestra_core::workflow::OrchestratorEvent::ScriptCompleted { task_id, stage } => {
            orkestra_debug!("orchestrator", "Script completed for {task_id}/{stage}");
            let _ = app_handle.emit("task-updated", task_id);
        }
        orkestra_core::workflow::OrchestratorEvent::ScriptFailed {
            task_id,
            stage,
            error,
            recovery_stage,
        } => {
            let recovery = recovery_stage.as_deref().unwrap_or("none");
            orkestra_debug!(
                "orchestrator",
                "Script failed for {task_id}/{stage}: {error} (recovery: {recovery})"
            );
            let _ = app_handle.emit("task-updated", task_id);
        }
        orkestra_core::workflow::OrchestratorEvent::ParentAdvanced {
            task_id,
            subtask_count,
        } => {
            orkestra_debug!(
                "orchestrator",
                "Parent {task_id} advanced: all {subtask_count} subtasks done"
            );
            let _ = app_handle.emit("task-updated", task_id);
        }
    }
}

// =============================================================================
// Desktop Notifications
// =============================================================================

/// Request notification permission from the OS on startup.
///
/// On macOS, this triggers the system dialog asking the user to allow notifications.
/// On desktop platforms using the current `tauri-plugin-notification` v2, the Rust
/// permission API is a no-op (always returns `Granted`), but calling it is the
/// correct pattern and will start working when the plugin adds real desktop support.
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

/// Send a desktop notification when a task needs human attention.
///
/// Fires for `OutputProcessed` events where the task has entered `AwaitingReview`.
/// This naturally excludes auto-mode tasks (they skip `AwaitingReview`) and
/// terminal outputs (failed/blocked don't enter `AwaitingReview`).
fn notify_if_review_needed(app_handle: &AppHandle, task_id: &str, stage: &str, output_type: &str) {
    // Only notify for output types that require human action
    let needs_notification = matches!(output_type, "questions" | "artifact" | "subtasks");
    if !needs_notification {
        return;
    }

    // Look up the task to check phase and get the title.
    // Best-effort: skip notification if state is unavailable or lock is poisoned.
    let Some(app_state) = app_handle.try_state::<state::AppState>() else {
        return;
    };
    let Ok(api) = app_state.api() else {
        return;
    };
    let Ok(task) = api.get_task(task_id) else {
        return;
    };
    // Release the lock before sending the notification
    drop(api);

    if task.phase != Phase::AwaitingReview {
        return;
    }

    let body = if output_type == "questions" {
        "Has questions that need to be answered".to_string()
    } else {
        format!("Has a {stage} ready for review")
    };

    // Check permission state before attempting to send
    match app_handle.notification().permission_state() {
        Ok(tauri::plugin::PermissionState::Granted) => {}
        Ok(perm) => {
            orkestra_debug!(
                "notification",
                "Skipping notification (permission: {perm:?}). \
                 Enable in System Settings > Notifications."
            );
            return;
        }
        Err(e) => {
            orkestra_debug!(
                "notification",
                "Could not check permission state: {e}, attempting send anyway"
            );
        }
    }

    let result = app_handle
        .notification()
        .builder()
        .title(&task.title)
        .body(&body)
        .show();

    match result {
        Ok(()) => {
            orkestra_debug!(
                "notification",
                "Sent notification for task {task_id}: {body}"
            );
        }
        Err(e) => {
            orkestra_debug!("notification", "Failed to send notification: {e}");
        }
    }
}

// =============================================================================
// Cleanup and Signal Handling
// =============================================================================

/// Cleanup function to kill all tracked agents on shutdown.
fn cleanup_agents(app_handle: &AppHandle) {
    orkestra_debug!("cleanup", "Killing all tracked agents...");

    let Some(app_state) = app_handle.try_state::<state::AppState>() else {
        orkestra_debug!("cleanup", "No app state available");
        return;
    };

    let Ok(api) = app_state.api() else {
        orkestra_debug!("cleanup", "Failed to get API lock");
        return;
    };

    match api.kill_running_agents() {
        Ok(killed) if killed > 0 => {
            orkestra_debug!("cleanup", "Killed {} agent(s)", killed);
        }
        Ok(_) => {
            orkestra_debug!("cleanup", "No active agents to kill");
        }
        Err(e) => {
            orkestra_debug!("cleanup", "Failed to kill agents: {}", e);
        }
    }
}

/// Clean up any orphaned agent processes from a previous crash.
///
/// Called on startup to ensure stale PIDs don't prevent new agents from spawning.
/// Delegates to core's `cleanup_orphaned_agents()` which kills processes and
/// clears stale PIDs from sessions.
fn cleanup_orphaned_agents(app_state: &state::AppState) {
    orkestra_debug!("startup", "Checking for orphaned agents...");

    let Ok(api) = app_state.api() else {
        orkestra_debug!("startup", "Failed to get API lock");
        return;
    };

    match api.cleanup_orphaned_agents() {
        Ok(orphans) if orphans > 0 => {
            orkestra_debug!("startup", "Cleaned up {} orphaned agent(s)", orphans);
        }
        Ok(_) => {
            orkestra_debug!("startup", "No orphaned agents found");
        }
        Err(e) => {
            orkestra_debug!("startup", "Failed to clean up orphaned agents: {}", e);
        }
    }
}

/// Standalone cleanup that can work without `app_state` (for signal handlers).
///
/// Opens its own database connection to find and kill tracked agents.
fn cleanup_agents_standalone() {
    println!("[cleanup] Killing all tracked agents (standalone)...");

    let Ok(project_root) = find_project_root() else {
        eprintln!("[cleanup] Could not find project root");
        return;
    };

    let db_path = project_root.join(".orkestra/orkestra.db");
    if !db_path.exists() {
        return;
    }

    let Ok(conn) = orkestra_core::adapters::sqlite::DatabaseConnection::open(&db_path) else {
        eprintln!("[cleanup] Could not open database");
        return;
    };

    let workflow_config = load_workflow_for_project(&project_root).unwrap_or_default();
    let store = orkestra_core::workflow::SqliteWorkflowStore::new(conn.shared());
    let api = orkestra_core::workflow::WorkflowApi::new(workflow_config, Arc::new(store));

    let _ = api.kill_running_agents();
}

/// Set up signal handlers to clean up agents on termination signals (Unix only).
#[cfg(unix)]
fn setup_signal_handlers(stop_flag: Arc<AtomicBool>) {
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
            eprintln!("[signal] Received signal {sig}, cleaning up...");
            stop_flag.store(true, Ordering::Relaxed);
            cleanup_agents_standalone();
            std::process::exit(128 + sig);
        }
    });
}

#[cfg(not(unix))]
fn setup_signal_handlers(_stop_flag: Arc<AtomicBool>) {
    // Signal handlers not supported on non-Unix platforms
}

// =============================================================================
// Application Entry Point
// =============================================================================

/// Run the Tauri application.
///
/// The app always starts (Tauri window opens) immediately with a splash screen,
/// while initialization runs in the background. If startup fails, the frontend
/// displays an error screen instead of the normal UI.
///
/// # Panics
///
/// Panics if the Tauri application fails to build (e.g., missing resources).
#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let stop_flag = Arc::new(AtomicBool::new(false));
    let stop_flag_for_exit = stop_flag.clone();

    // Set up signal handlers to ensure cleanup on external termination
    setup_signal_handlers(stop_flag.clone());

    // Create startup state in initializing state - window opens immediately
    let startup_state = StartupState::initializing();

    tauri::Builder::default()
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_shell::init())
        .manage(startup_state)
        .setup(move |app| {
            // Store the stop flag in Tauri state so the init command can access it
            app.manage(OrchestratorStopFlag(stop_flag.clone()));

            // Register SyntaxHighlighter (pure presentation utility, no dependencies)
            app.manage(highlight::SyntaxHighlighter::new());

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            // Startup commands (always available)
            begin_initialization,
            commands::get_startup_status,
            // Workflow commands (may fail gracefully if startup failed)
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
        .run(move |app_handle, event| {
            if let tauri::RunEvent::Exit = event {
                // Signal orchestrator to stop
                stop_flag_for_exit.store(true, Ordering::Relaxed);
                // Kill all tracked agents to prevent orphaned processes
                cleanup_agents(app_handle);
                // Flush WAL to leave database in a clean state
                if let Some(app_state) = app_handle.try_state::<state::AppState>() {
                    app_state.checkpoint_database();
                }
            }
        });
}
