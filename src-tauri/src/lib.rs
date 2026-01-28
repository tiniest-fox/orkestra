// Tauri commands require owned types for serialization
#![allow(clippy::needless_pass_by_value)]

mod commands;
mod error;
mod startup;
mod state;

use orkestra_core::{
    find_project_root, is_process_running, kill_process_tree,
    workflow::{load_workflow_for_project, OrchestratorLoop},
};
use startup::{run_startup, StartupState};
use tauri::{AppHandle, Emitter, Manager};

use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use std::thread;
use std::time::Duration;

/// Wrapper for the orchestrator stop flag, stored in Tauri state.
struct OrchestratorStopFlag(Arc<AtomicBool>);

/// Command for frontend to trigger initialization after splash screen loads.
///
/// This ensures no background work runs until the UI is ready.
#[tauri::command]
fn begin_initialization(
    app_handle: AppHandle,
    stop_flag: tauri::State<OrchestratorStopFlag>,
) {
    println!("[startup] UI ready, beginning initialization...");
    let stop_flag = stop_flag.0.clone();

    thread::spawn(move || {
        let startup_result = run_startup();

        // Update the startup state with the result
        let startup_state: tauri::State<StartupState> = app_handle.state();
        startup_state.set_status(startup_result.status.clone());

        // If startup succeeded, register AppState and start orchestrator
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

        orchestrator.run(move |event| match &event {
            orkestra_core::workflow::OrchestratorEvent::AgentSpawned {
                task_id,
                stage,
                pid,
            } => {
                println!("[orchestrator] Spawned {stage} agent for {task_id} (pid: {pid})");
                let _ = app_handle.emit("task-updated", task_id);
            }
            orkestra_core::workflow::OrchestratorEvent::OutputProcessed {
                task_id,
                stage,
                output_type,
            } => {
                println!(
                    "[orchestrator] Processed {output_type} output from {stage} for {task_id}"
                );
                let _ = app_handle.emit("task-updated", task_id);
            }
            orkestra_core::workflow::OrchestratorEvent::Error { task_id, error } => {
                eprintln!("[orchestrator] Error: {error}");
                if let Some(id) = task_id {
                    let _ = app_handle.emit("task-updated", id);
                }
            }
            orkestra_core::workflow::OrchestratorEvent::IntegrationStarted { task_id, branch } => {
                println!("[orchestrator] Starting integration for {task_id} (branch: {branch})");
                let _ = app_handle.emit("task-updated", task_id);
            }
            orkestra_core::workflow::OrchestratorEvent::IntegrationCompleted { task_id } => {
                println!("[orchestrator] Integration completed for {task_id}");
                let _ = app_handle.emit("task-updated", task_id);
            }
            orkestra_core::workflow::OrchestratorEvent::IntegrationFailed {
                task_id,
                error,
                ..
            } => {
                eprintln!("[orchestrator] Integration failed for {task_id}: {error}");
                let _ = app_handle.emit("task-updated", task_id);
            }
            orkestra_core::workflow::OrchestratorEvent::ScriptSpawned {
                task_id,
                stage,
                command,
                pid,
            } => {
                println!(
                    "[orchestrator] Spawned script for {task_id}/{stage}: {command} (pid: {pid})"
                );
                let _ = app_handle.emit("task-updated", task_id);
            }
            orkestra_core::workflow::OrchestratorEvent::ScriptCompleted { task_id, stage } => {
                println!("[orchestrator] Script completed for {task_id}/{stage}");
                let _ = app_handle.emit("task-updated", task_id);
            }
            orkestra_core::workflow::OrchestratorEvent::ScriptFailed {
                task_id,
                stage,
                error,
                recovery_stage,
            } => {
                let recovery = recovery_stage.as_deref().unwrap_or("none");
                eprintln!(
                    "[orchestrator] Script failed for {task_id}/{stage}: {error} (recovery: {recovery})"
                );
                let _ = app_handle.emit("task-updated", task_id);
            }
        });

        println!("[orchestrator] Stopped");
    });
}

// =============================================================================
// Cleanup and Signal Handling
// =============================================================================

/// Cleanup function to kill all tracked agents on shutdown.
fn cleanup_agents(app_handle: &AppHandle) {
    println!("[cleanup] Killing all tracked agents...");

    let Some(app_state) = app_handle.try_state::<state::AppState>() else {
        eprintln!("[cleanup] No app state available");
        return;
    };

    let running_agents = match app_state.api() {
        Ok(api) => match api.get_running_agent_pids() {
            Ok(agents) => agents,
            Err(e) => {
                eprintln!("[cleanup] Failed to get running agents: {e}");
                return;
            }
        },
        Err(e) => {
            eprintln!("[cleanup] Failed to get API: {e}");
            return;
        }
    };

    let mut killed = 0;
    for (task_id, stage, pid) in running_agents {
        if is_process_running(pid) {
            println!("[cleanup] Killing agent for task {task_id}/{stage} (pid: {pid})");
            let _ = kill_process_tree(pid);
            killed += 1;
        }
    }

    if killed > 0 {
        println!("[cleanup] Killed {killed} agent(s)");
    } else {
        println!("[cleanup] No active agents to kill");
    }
}

/// Clean up any orphaned agent processes from a previous crash.
///
/// Called on startup to ensure stale PIDs don't prevent new agents from spawning.
/// Uses the workflow API to check for sessions with stale agent PIDs.
fn cleanup_orphaned_agents(app_state: &state::AppState) {
    println!("[startup] Checking for orphaned agents...");

    let running_agents = match app_state.api() {
        Ok(api) => match api.get_running_agent_pids() {
            Ok(agents) => agents,
            Err(e) => {
                eprintln!("[startup] Failed to get running agents: {e}");
                return;
            }
        },
        Err(e) => {
            eprintln!("[startup] Failed to get API: {e}");
            return;
        }
    };

    let mut orphans_found = 0;
    for (task_id, stage, pid) in running_agents {
        if is_process_running(pid) {
            eprintln!(
                "[startup] Found orphaned agent for task {task_id}/{stage} (pid: {pid}), killing..."
            );
            let _ = kill_process_tree(pid);
            orphans_found += 1;
        }
        // Clear the stale PID from the session
        if let Ok(api) = app_state.api() {
            let _ = api.clear_session_agent_pid(&task_id, &stage);
        }
    }

    if orphans_found > 0 {
        println!("[startup] Cleaned up {orphans_found} orphaned agent(s)");
    } else {
        println!("[startup] No orphaned agents found");
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

    let db_path = project_root.join(".orkestra/workflow.db");
    if !db_path.exists() {
        return;
    }

    // Open database and query for sessions with PIDs
    let Ok(conn) = orkestra_core::adapters::sqlite::DatabaseConnection::open(&db_path) else {
        eprintln!("[cleanup] Could not open database");
        return;
    };

    let workflow_config = load_workflow_for_project(&project_root).unwrap_or_default();
    let store = orkestra_core::workflow::SqliteWorkflowStore::new(conn.shared());
    let api = orkestra_core::workflow::WorkflowApi::new(workflow_config, Arc::new(store));

    let Ok(running_agents) = api.get_running_agent_pids() else {
        return;
    };

    for (task_id, stage, pid) in running_agents {
        if is_process_running(pid) {
            println!("[cleanup] Killing agent for {task_id}/{stage} (pid: {pid})");
            let _ = kill_process_tree(pid);
        }
    }
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
        .plugin(tauri_plugin_shell::init())
        .manage(startup_state)
        .setup(move |app| {
            // Store the stop flag in Tauri state so the init command can access it
            app.manage(OrchestratorStopFlag(stop_flag.clone()));
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
            commands::workflow_get_config,
            commands::workflow_get_iterations,
            commands::workflow_get_artifact,
            commands::workflow_get_pending_questions,
            commands::workflow_get_current_stage,
            commands::workflow_get_rejection_feedback,
            commands::workflow_list_branches,
            commands::workflow_get_stages_with_logs,
            commands::workflow_get_logs,
        ])
        .build(tauri::generate_context!())
        .expect("error while building tauri application")
        .run(move |app_handle, event| {
            if let tauri::RunEvent::Exit = event {
                // Signal orchestrator to stop
                stop_flag_for_exit.store(true, Ordering::Relaxed);
                // Kill all tracked agents to prevent orphaned processes
                cleanup_agents(app_handle);
            }
        });
}
