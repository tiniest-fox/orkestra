// Tauri commands require owned types for serialization
#![allow(clippy::needless_pass_by_value)]

mod commands;
mod diff_cache;
mod error;
mod highlight;
mod notifications;
mod project_init;
mod project_registry;
mod run_process;

use orkestra_core::orkestra_debug;
use orkestra_core::workflow::ports::WorkflowStore;
use project_registry::{ProjectRegistry, RecentProject};
use std::path::PathBuf;
use std::sync::atomic::Ordering;
use std::sync::{Arc, OnceLock};
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

/// Result of the early `fix_path_env::fix()` call. Stored here because
/// `orkestra_debug!` isn't initialized until the first project opens — this
/// lets `project_init` replay the message into `debug.log` after init.
///
/// `Ok(path)` — fix succeeded; `path` is the resulting PATH value.
/// `Err(msg)` — fix failed; `msg` includes the error and current PATH.
pub static PATH_FIX_RESULT: OnceLock<Result<String, String>> = OnceLock::new();

/// Bundled `ork` CLI binary path, detected at app startup.
///
/// `Some(path)` when a real (non-empty) binary was found in the app's resource directory.
/// `None` in development builds where `build.rs` creates an empty placeholder so
/// Tauri's resource validation passes.
pub struct OrkBinPath(pub Option<PathBuf>);

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

/// Set up signal handlers to clean up agents on termination signals (Unix only).
#[cfg(unix)]
fn setup_signal_handlers(run_pids: std::sync::Arc<std::sync::Mutex<Vec<u32>>>) {
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
            crate::run_process::kill_all_pids(&run_pids);
            std::process::exit(128 + sig);
        }
    });
}

#[cfg(not(unix))]
fn setup_signal_handlers(_run_pids: std::sync::Arc<std::sync::Mutex<Vec<u32>>>) {
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

        // Stop all run script processes for this project.
        state.run_processes().stop_all();

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

/// Returns `true` if `path` refers to a non-empty file (i.e. a real compiled binary).
///
/// In development, `build.rs` creates an empty placeholder at the resource path so
/// Tauri's build-time resource validation passes before `ork` has been compiled.
/// The size check distinguishes this placeholder (0 bytes) from a real binary.
fn is_real_ork_binary(path: &std::path::Path) -> bool {
    path.metadata().map(|m| m.len() > 0).unwrap_or(false)
}

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
    // orkestra_debug! isn't initialized until the first project opens, so we store
    // the result in PATH_FIX_RESULT and project_init replays it into debug.log.
    {
        let path = std::env::var("PATH").unwrap_or_else(|_| "(not set)".to_string());
        match fix_path_env::fix() {
            Ok(()) => {
                let new_path = std::env::var("PATH").unwrap_or_else(|_| "(not set)".to_string());
                let _ = PATH_FIX_RESULT.set(Ok(new_path));
            }
            Err(e) => {
                let _ = PATH_FIX_RESULT.set(Err(format!("{e} (PATH before fix: {path})")));
            }
        }
    }

    // Create the project registry early so run_pids can be shared with the signal handler.
    let registry = ProjectRegistry::new();
    // Capture run_pids for the signal handler, which is set up inside .setup() below
    // so the handler thread starts only after the environment is fully configured.
    let run_pids = registry.run_pids();

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
        .manage(registry)
        .manage(diff_cache::DiffCacheState::new())
        .setup(move |app| {
            // Detect the bundled ork binary. `build.rs` creates an empty placeholder
            // at the resource path so Tauri's build-time validation passes in dev
            // builds — the size guard (`is_real_ork_binary`) distinguishes the
            // placeholder (0 bytes) from a real compiled binary.
            let bundled_ork: Option<PathBuf> = app.path().resource_dir().ok().and_then(|dir| {
                let p = dir.join("ork");
                is_real_ork_binary(&p).then_some(p)
            });
            if let Some(ref ork_path) = bundled_ork {
                // Register the bundled binary path via OnceLock so the agent spawner
                // can find it without process-environment mutation (set_var is UB
                // when other threads exist, and Tauri's Builder spawns threads before
                // the setup closure runs).
                orkestra_agent::set_bundled_ork_path(ork_path.clone());
            }
            app.manage(OrkBinPath(bundled_ork));

            // Start signal handlers now that the environment is fully configured.
            setup_signal_handlers(run_pids);

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
                .separator()
                .quit()
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

            let install_ork =
                MenuItemBuilder::with_id("install_ork", "Install 'ork' CLI Tool...").build(app)?;
            let help_menu = SubmenuBuilder::new(app, "Help")
                .item(&install_ork)
                .build()?;

            let menu = MenuBuilder::new(app)
                .item(&file_menu)
                .item(&edit_menu)
                .item(&help_menu)
                .build()?;

            app.set_menu(menu)?;

            // Handle menu events
            let app_handle = app.handle().clone();
            app.on_menu_event(move |_app, event| {
                match event.id().as_ref() {
                    "install_ork" => {
                        use tauri_plugin_notification::NotificationExt;
                        let ork_bin = app_handle.state::<OrkBinPath>().0.clone();
                        let (title, body) = match ork_bin {
                            None => (
                                "ork CLI — Install failed",
                                "ork binary not found in app bundle. Run Orkestra from the installed .app.".to_string(),
                            ),
                            Some(ref ork_bin) => {
                                let target = std::path::Path::new("/usr/local/bin/ork");
                                match commands::setup::install_ork_to_path(ork_bin, target) {
                                    Ok(msg) => ("ork CLI — Installed", msg),
                                    Err(e) => ("ork CLI — Install failed", e.message),
                                }
                            }
                        };
                        let _ = app_handle
                            .notification()
                            .builder()
                            .title(title)
                            .body(body)
                            .show();
                    }
                    "new_window" | "open_project" => {
                        // Find a window that is still showing the picker UI (no
                        // "?project=" in its URL). Once load_project_in_window runs,
                        // the original "picker" window navigates to /?project=... and
                        // keeps the "picker" label — it must not be re-focused here.
                        let existing_picker =
                            app_handle
                                .webview_windows()
                                .into_iter()
                                .find_map(|(_label, win)| {
                                    let url = win.url().ok()?;
                                    let is_picker = !url.query_pairs().any(|(k, _)| k == "project");
                                    if is_picker {
                                        Some(win)
                                    } else {
                                        None
                                    }
                                });

                        if let Some(win) = existing_picker {
                            let _ = win.set_focus();
                        } else {
                            // Use a timestamped label so it never collides with the
                            // "picker" label now used by a project window.
                            let label = format!(
                                "picker-{}",
                                std::time::SystemTime::now()
                                    .duration_since(std::time::UNIX_EPOCH)
                                    .unwrap_or_default()
                                    .as_millis()
                            );
                            let _ = WebviewWindowBuilder::new(
                                &app_handle,
                                &label,
                                WebviewUrl::App("index.html".into()),
                            )
                            .title("")
                            .inner_size(1200.0, 800.0)
                            .build();
                        }
                    }
                    _ => {}
                }
            });

            // Launch phase: check for recent projects and auto-open or show picker.
            // Always creates a single 1200x800 "picker" window. When a valid last
            // project exists, it is pre-registered so the window opens directly at
            // /?project={path} without showing the picker UI.
            let store = app
                .store("recents.json")
                .expect("Failed to initialize store");

            let recents: Vec<RecentProject> = store
                .get("recent_projects")
                .and_then(|v| serde_json::from_value(v.clone()).ok())
                .unwrap_or_default();

            if let Some(last_project) = recents.first() {
                let path = PathBuf::from(&last_project.path);
                if path.exists() {
                    let path_str = last_project.path.clone();
                    let app_handle = app.handle().clone();

                    // Open the window immediately — init happens in a background thread.
                    // On success the thread emits `startup-data`; on failure `startup-error`.
                    let url = format!("/?project={}", urlencoding::encode(&path_str));
                    WebviewWindowBuilder::new(app, "picker", WebviewUrl::App(url.parse().unwrap()))
                        .title("")
                        .inner_size(1200.0, 800.0)
                        .build()?;
                    commands::spawn_background_startup(app_handle, "picker", &path_str);
                } else {
                    // Path no longer exists — show picker with error (nothing to open).
                    let error_msg = format!("Folder not found: {}", last_project.path);
                    let url = format!("/?error={}", urlencoding::encode(&error_msg));
                    WebviewWindowBuilder::new(app, "picker", WebviewUrl::App(url.parse().unwrap()))
                        .title("")
                        .inner_size(1200.0, 800.0)
                        .build()?;
                }
            } else {
                // No recents — show the project picker
                WebviewWindowBuilder::new(app, "picker", WebviewUrl::App("index.html".into()))
                    .title("")
                    .inner_size(1200.0, 800.0)
                    .build()?;
            }

            Ok(())
        })
        .on_window_event(|window, event| {
            if let WindowEvent::CloseRequested { .. } = event {
                handle_window_close(window.app_handle(), window.label());
            }
        })
        .invoke_handler(tauri::generate_handler![
            // Project commands
            commands::load_project_in_window,
            commands::open_project,
            commands::get_project_info,
            commands::get_recent_projects,
            commands::remove_recent_project,
            commands::pick_folder,
            commands::workflow_retry_startup,
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
            commands::workflow_push_pr_changes,
            commands::workflow_pull_pr_changes,
            commands::workflow_force_push_pr_changes,
            commands::workflow_archive,
            commands::workflow_reject_with_comments,
            commands::workflow_address_pr_feedback,
            commands::workflow_address_pr_conflicts,
            commands::workflow_request_update,
            commands::workflow_retry,
            commands::workflow_set_auto_mode,
            commands::workflow_interrupt,
            commands::workflow_resume,
            commands::workflow_skip_stage,
            commands::workflow_send_to_stage,
            commands::workflow_restart_stage,
            commands::workflow_get_config,
            commands::workflow_get_startup_data,
            commands::workflow_get_auto_task_templates,
            commands::workflow_get_iterations,
            commands::workflow_get_artifact,
            commands::workflow_get_pending_questions,
            commands::workflow_get_current_stage,
            commands::workflow_get_rejection_feedback,
            commands::workflow_list_branches,
            commands::workflow_list_project_files,
            commands::workflow_get_logs,
            commands::workflow_get_latest_log,
            commands::workflow_get_pr_status,
            commands::workflow_get_task_diff,
            commands::workflow_get_file_content,
            commands::workflow_get_project_file_content,
            commands::workflow_get_syntax_css,
            commands::workflow_get_branch_commits,
            commands::workflow_get_uncommitted_diff,
            commands::workflow_get_commit_log,
            commands::workflow_get_batch_file_counts,
            commands::workflow_get_commit_diff,
            // Git sync commands
            commands::workflow_git_sync_status,
            commands::workflow_git_push,
            commands::workflow_git_pull,
            commands::workflow_git_fetch,
            commands::workflow_task_sync_status,
            commands::open_in_terminal,
            commands::open_in_editor,
            commands::detect_external_tools,
            commands::install_cli_tools,
            // Assistant commands
            commands::assistant_send_message,
            commands::assistant_stop,
            commands::assistant_list_sessions,
            commands::assistant_get_logs,
            commands::assistant_send_task_message,
            commands::assistant_list_project_sessions,
            // Interactive mode commands
            commands::interactive_enter,
            commands::interactive_send_message,
            commands::interactive_exit,
            // Stage chat commands
            commands::stage_chat_send,
            commands::stage_chat_stop,
            commands::workflow_return_to_work,
            // Run script commands
            commands::start_run_script,
            commands::stop_run_script,
            commands::get_run_status,
            commands::get_run_logs,
        ])
        .build(tauri::generate_context!())
        .expect("error while building tauri application")
        .run(move |app_handle, event| {
            if let tauri::RunEvent::Exit = event {
                // Kill all tracked agents to prevent orphaned processes
                cleanup_all_agents(app_handle);

                // Stop any remaining run script processes
                let registry: tauri::State<ProjectRegistry> = app_handle.state();
                registry.stop_all_run_processes();

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
