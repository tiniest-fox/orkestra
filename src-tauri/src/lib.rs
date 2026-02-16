// Tauri commands require owned types for serialization
#![allow(clippy::needless_pass_by_value)]

mod commands;
mod error;
mod highlight;
mod notifications;
mod project_init;
mod project_registry;

use orkestra_core::orkestra_debug;
use orkestra_core::workflow::ports::WorkflowStore;
use project_registry::{ProjectRegistry, RecentProject};
use std::path::PathBuf;
use std::sync::atomic::Ordering;
use std::sync::Arc;
use std::thread;
use tauri::{
    menu::{MenuBuilder, MenuItemBuilder, SubmenuBuilder},
    AppHandle, Manager, WebviewUrl, WebviewWindowBuilder, WindowEvent,
};
use tauri_plugin_store::StoreExt;

// =============================================================================
// Cleanup and Signal Handling
// =============================================================================

/// Global list of project roots for signal handler cleanup.
/// Updated when projects open/close.
pub static PROJECT_ROOTS: std::sync::LazyLock<std::sync::Mutex<Vec<PathBuf>>> =
    std::sync::LazyLock::new(|| std::sync::Mutex::new(Vec::new()));

/// Cleanup function to kill all tracked agents for all open projects.
fn cleanup_all_agents(app_handle: &AppHandle) {
    orkestra_debug!("cleanup", "Killing agents for all open projects...");

    let registry: tauri::State<ProjectRegistry> = app_handle.state();
    let Ok(project_roots) = registry.all_project_roots() else {
        orkestra_debug!("cleanup", "Failed to get project roots");
        return;
    };

    for project_root in project_roots {
        let db_path = project_root.join(".orkestra/.database/orkestra.db");
        if !db_path.exists() {
            continue;
        }

        let Ok(conn) = orkestra_core::adapters::sqlite::DatabaseConnection::open(&db_path) else {
            continue;
        };

        let Ok(workflow_config) = orkestra_core::workflow::load_workflow_for_project(&project_root)
        else {
            continue;
        };
        let store: Arc<dyn WorkflowStore> = Arc::new(
            orkestra_core::workflow::SqliteWorkflowStore::new(conn.shared()),
        );
        let api = orkestra_core::workflow::WorkflowApi::new(workflow_config, Arc::clone(&store));

        // Kill task agents
        match api.kill_running_agents() {
            Ok(killed) if killed > 0 => {
                orkestra_debug!(
                    "cleanup",
                    "Killed {} task agent(s) for {}",
                    killed,
                    project_root.display()
                );
            }
            Ok(_) => {}
            Err(e) => {
                orkestra_debug!(
                    "cleanup",
                    "Failed to kill task agents for {}: {}",
                    project_root.display(),
                    e
                );
            }
        }

        // Kill assistant agents
        if let Ok(sessions) = store.list_assistant_sessions() {
            let mut killed_assistants = 0;
            for session in sessions {
                if let Some(pid) = session.agent_pid {
                    if orkestra_core::process::is_process_running(pid) {
                        let _ = orkestra_core::process::kill_process_tree(pid);
                        killed_assistants += 1;
                    }
                }
            }
            if killed_assistants > 0 {
                orkestra_debug!(
                    "cleanup",
                    "Killed {} assistant agent(s) for {}",
                    killed_assistants,
                    project_root.display()
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

/// Standalone cleanup that can work without `app_state` (for signal handlers).
///
/// Opens its own database connection to find and kill tracked agents.
fn cleanup_agents_standalone() {
    println!("[cleanup] Killing all tracked agents (standalone)...");

    let roots = PROJECT_ROOTS.lock().unwrap().clone();

    for project_root in roots {
        let db_path = project_root.join(".orkestra/.database/orkestra.db");
        if !db_path.exists() {
            continue;
        }

        let Ok(conn) = orkestra_core::adapters::sqlite::DatabaseConnection::open(&db_path) else {
            eprintln!(
                "[cleanup] Could not open database for {}",
                project_root.display()
            );
            continue;
        };

        let Ok(workflow_config) = orkestra_core::workflow::load_workflow_for_project(&project_root)
        else {
            continue;
        };
        let store: Arc<dyn WorkflowStore> = Arc::new(
            orkestra_core::workflow::SqliteWorkflowStore::new(conn.shared()),
        );
        let api = orkestra_core::workflow::WorkflowApi::new(workflow_config, Arc::clone(&store));

        // Kill task agents
        let _ = api.kill_running_agents();

        // Kill assistant agents
        if let Ok(sessions) = store.list_assistant_sessions() {
            for session in sessions {
                if let Some(pid) = session.agent_pid {
                    if orkestra_core::process::is_process_running(pid) {
                        let _ = orkestra_core::process::kill_process_tree(pid);
                    }
                }
            }
        }
    }
}

/// Best-effort PATH fix for macOS .app bundles.
///
/// GUI apps get a minimal PATH that excludes user-installed tools. This appends
/// Homebrew — the most universal macOS tool location. Everything else (cargo, mise,
/// asdf, nvm, etc.) should be set up in script stages by the project.
fn fix_path_env() {
    #[cfg(unix)]
    {
        let current = std::env::var("PATH").unwrap_or_default();

        let extra_paths = [
            "/opt/homebrew/bin".to_string(),
            "/opt/homebrew/sbin".to_string(),
        ];

        let mut path = current;
        for p in extra_paths {
            if std::path::Path::new(&p).exists() && !path.contains(&p) {
                path = format!("{path}:{p}");
            }
        }

        std::env::set_var("PATH", &path);
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
            eprintln!("[signal] Received signal {sig}, cleaning up...");
            cleanup_agents_standalone();
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

/// Handle window close events for project windows.
fn handle_window_close(app_handle: &AppHandle, window_label: &str) {
    orkestra_debug!("window", "Closing window '{}'", window_label);

    let registry: tauri::State<ProjectRegistry> = app_handle.state();

    // Get project root before removing from registry (for PROJECT_ROOTS cleanup)
    let project_root = registry
        .with_project(window_label, |state| Ok(state.project_root().to_path_buf()))
        .ok();

    // Get the project state to kill agents and checkpoint database
    if let Ok(Some(state)) = registry.remove(window_label) {
        // Stop orchestrator
        state.stop_flag.store(true, Ordering::Relaxed);

        // Kill running task agents
        if let Ok(api) = state.api() {
            match api.kill_running_agents() {
                Ok(killed) if killed > 0 => {
                    orkestra_debug!(
                        "cleanup",
                        "Killed {} task agent(s) for '{}'",
                        killed,
                        window_label
                    );
                }
                Ok(_) => {}
                Err(e) => {
                    orkestra_debug!("cleanup", "Failed to kill task agents: {}", e);
                }
            }
        }

        // Kill running assistant processes
        let store = state.create_store();
        if let Ok(sessions) = store.list_assistant_sessions() {
            let mut killed_assistants = 0;
            for session in sessions {
                if let Some(pid) = session.agent_pid {
                    if orkestra_core::process::is_process_running(pid) {
                        orkestra_debug!("cleanup", "Killing assistant agent (pid={})", pid);
                        let _ = orkestra_core::process::kill_process_tree(pid);
                        killed_assistants += 1;
                    }
                }
            }
            if killed_assistants > 0 {
                orkestra_debug!(
                    "cleanup",
                    "Killed {} assistant agent(s) for '{}'",
                    killed_assistants,
                    window_label
                );
            }
        }

        // Checkpoint database
        state.checkpoint_database();
    }

    // Remove from global project roots list
    if let Some(root) = project_root {
        let mut roots = PROJECT_ROOTS.lock().unwrap();
        roots.retain(|r| r != &root);
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
/// The app supports multiple project windows. On first launch (or when no valid
/// recent project exists), a picker window appears. On subsequent launches, the
/// last-used project is auto-opened if its folder still exists.
///
/// # Panics
///
/// Panics if the Tauri application fails to build (e.g., missing resources).
#[cfg_attr(mobile, tauri::mobile_entry_point)]
#[allow(clippy::too_many_lines)]
pub fn run() {
    // Fix PATH for macOS .app bundles. GUI apps don't inherit the user's shell
    // PATH, so tools like cargo, node, mise shims etc. aren't found. This runs
    // the user's login shell to resolve their real PATH and sets it on this process.
    fix_path_env();

    // Set up signal handlers to ensure cleanup on external termination
    setup_signal_handlers();

    // Load .env files. More specific files are loaded first so their values
    // take precedence. Neither call uses _override, so process environment
    // always wins over file values.
    // Precedence: process env > .env.development > .env
    if cfg!(debug_assertions) {
        dotenvy::from_filename(".env.development").ok();
    }
    dotenvy::dotenv().ok();

    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_store::Builder::new().build())
        .manage(ProjectRegistry::new())
        .setup(move |app| {
            // Initialize syntax highlighter (Send + Sync, shared across commands)
            app.manage(highlight::SyntaxHighlighter::new());

            // Request notification permission
            notifications::request_permission(app.handle());

            // Create menu bar
            let new_window = MenuItemBuilder::with_id("new_window", "New Window")
                .accelerator("CmdOrCtrl+Shift+N")
                .build(app)?;

            let open_project = MenuItemBuilder::with_id("open_project", "Open Project...")
                .accelerator("CmdOrCtrl+O")
                .build(app)?;

            // Create File submenu with project and window management
            let file_menu = SubmenuBuilder::new(app, "File")
                .item(&new_window)
                .item(&open_project)
                .separator()
                .close_window()
                .build()?;

            // Create Edit submenu with standard clipboard shortcuts
            let edit_menu = SubmenuBuilder::new(app, "Edit")
                .undo()
                .redo()
                .separator()
                .cut()
                .copy()
                .paste()
                .separator()
                .select_all()
                .build()?;

            let menu = MenuBuilder::new(app)
                .item(&file_menu)
                .item(&edit_menu)
                .build()?;

            app.set_menu(menu)?;

            // Handle menu events
            let app_handle = app.handle().clone();
            app.on_menu_event(move |_app, event| {
                match event.id().as_ref() {
                    "new_window" | "open_project" => {
                        // Create or focus picker window
                        if let Some(picker) = app_handle.get_webview_window("picker") {
                            let _ = picker.set_focus();
                        } else {
                            let _ = WebviewWindowBuilder::new(
                                &app_handle,
                                "picker",
                                WebviewUrl::App("index.html".into()),
                            )
                            .title("Open Project")
                            .build();
                        }
                    }
                    _ => {}
                }
            });

            // Launch phase: check for recent projects and auto-open or show picker
            let store = app
                .store("recents.json")
                .expect("Failed to initialize store");

            let recents: Vec<RecentProject> = store
                .get("recent_projects")
                .and_then(|v| serde_json::from_value(v.clone()).ok())
                .unwrap_or_default();

            // Try to auto-open the last project
            if let Some(last_project) = recents.first() {
                let path = PathBuf::from(&last_project.path);
                if path.exists() {
                    // Auto-open last project
                    let app_handle = app.handle().clone();
                    let path_str = last_project.path.clone();
                    thread::spawn(move || {
                        let registry = app_handle.state::<ProjectRegistry>();
                        let _ = tauri::async_runtime::block_on(commands::open_project(
                            app_handle.clone(),
                            registry,
                            path_str,
                        ));
                    });
                } else {
                    // Path invalid, show picker with error
                    let error_msg = format!("Folder not found: {}", last_project.path);
                    let url = format!("index.html?error={}", urlencoding::encode(&error_msg));
                    WebviewWindowBuilder::new(app, "picker", WebviewUrl::App(url.into()))
                        .title("Open Project")
                        .build()?;
                }
            } else {
                // No recents, show picker
                WebviewWindowBuilder::new(app, "picker", WebviewUrl::App("index.html".into()))
                    .title("Open Project")
                    .build()?;
            }

            Ok(())
        })
        .on_window_event(|window, event| {
            if let WindowEvent::CloseRequested { .. } = event {
                let label = window.label();
                // Don't clean up picker window
                if label != "picker" {
                    handle_window_close(window.app_handle(), label);
                }
            }
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
            commands::workflow_merge_task,
            commands::workflow_open_pr,
            commands::workflow_retry_pr,
            commands::workflow_archive,
            commands::workflow_address_pr_comments,
            commands::workflow_address_pr_conflicts,
            commands::workflow_retry,
            commands::workflow_set_auto_mode,
            commands::workflow_interrupt,
            commands::workflow_resume,
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
            commands::workflow_get_pr_status,
            commands::workflow_get_task_diff,
            commands::workflow_get_file_content,
            commands::workflow_get_syntax_css,
            commands::workflow_get_commit_log,
            commands::workflow_get_batch_file_counts,
            commands::workflow_get_commit_diff,
            commands::open_in_terminal,
            commands::open_in_editor,
            commands::detect_external_tools,
            // Assistant commands
            commands::assistant_send_message,
            commands::assistant_stop,
            commands::assistant_list_sessions,
            commands::assistant_get_logs,
        ])
        .build(tauri::generate_context!())
        .expect("error while building tauri application")
        .run(move |app_handle, event| {
            if let tauri::RunEvent::Exit = event {
                // Kill all tracked agents to prevent orphaned processes
                cleanup_all_agents(app_handle);

                // Checkpoint all project databases
                let registry: tauri::State<ProjectRegistry> = app_handle.state();
                if let Ok(project_roots) = registry.all_project_roots() {
                    for project_root in project_roots {
                        let label = ProjectRegistry::label_for_path(&project_root);
                        let _ = registry.with_project(&label, |state| {
                            state.checkpoint_database();
                            Ok(())
                        });
                    }
                }
            }
        });
}
