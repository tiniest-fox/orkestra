//! `ork-service` — multi-project Orkestra service.
//!
//! Manages multiple child orkd daemon processes and serves a project management
//! web UI.

mod embedded_spa;
mod service_ui;

use std::net::{IpAddr, SocketAddr};
use std::path::PathBuf;
use std::sync::atomic::Ordering;
use std::sync::Arc;

use clap::Parser;

use orkestra_service::{
    start_containers_and_spawn, DaemonSupervisor, ProjectStatus, ServiceConfig, ServiceDatabase,
};

// ============================================================================
// CLI
// ============================================================================

/// Orkestra service — multi-project manager with web UI.
#[derive(Parser, Debug)]
#[command(version, about)]
struct Args {
    /// Data directory for service database and cloned repos.
    #[arg(long, default_value = "~/.orkestra-service")]
    data_dir: PathBuf,

    /// Port for the service HTTP server.
    #[arg(long, default_value_t = 3847)]
    port: u16,

    /// IP address to bind to.
    #[arg(long, default_value = "127.0.0.1")]
    bind: IpAddr,

    /// Generate a service-level pairing code and exit.
    #[arg(long)]
    new_pairing_code: bool,

    /// Start of port range for child daemons.
    #[arg(long, default_value_t = 3850)]
    port_range_start: u16,

    /// End of port range for child daemons.
    #[arg(long, default_value_t = 3899)]
    port_range_end: u16,
}

// ============================================================================
// Entry Point
// ============================================================================

fn main() {
    let args = Args::parse();

    tracing_subscriber::fmt()
        .with_env_filter(
            tracing_subscriber::EnvFilter::try_from_default_env()
                .unwrap_or_else(|_| tracing_subscriber::EnvFilter::new("info")),
        )
        .init();

    match fix_path_env::fix() {
        Ok(()) => {
            let path = std::env::var("PATH").unwrap_or_else(|_| "(not set)".to_string());
            tracing::info!(path, "fix_path_env succeeded");
        }
        Err(e) => {
            let path = std::env::var("PATH").unwrap_or_else(|_| "(not set)".to_string());
            tracing::warn!(error = %e, path, "fix_path_env failed — tool shims may not be found");
        }
    }

    let rt = tokio::runtime::Builder::new_multi_thread()
        .enable_all()
        .build()
        .expect("Failed to create tokio runtime");

    if let Err(e) = rt.block_on(run(args)) {
        tracing::error!("Service error: {e}");
        std::process::exit(1);
    }
}

// ============================================================================
// Core Run Logic
// ============================================================================

#[allow(clippy::too_many_lines)]
async fn run(args: Args) -> Result<(), String> {
    if args.port_range_start > args.port_range_end {
        return Err(format!(
            "Invalid port range: start ({}) must be <= end ({})",
            args.port_range_start, args.port_range_end
        ));
    }
    let data_dir = expand_tilde(args.data_dir);

    let db = ServiceDatabase::open(&data_dir)
        .map_err(|e| format!("Failed to open service database: {e}"))?;
    let conn = db.shared();

    // Early exit: generate a pairing code and print it.
    if args.new_pairing_code {
        match orkestra_networking::generate_pairing_code::execute(&conn) {
            Ok(code) => {
                println!("Pairing code: {code}");
                println!("Use this code with POST /pair within 5 minutes.");
                return Ok(());
            }
            Err(e) => return Err(format!("Failed to generate pairing code: {e}")),
        }
    }

    let orkd_path = find_orkd_path()?;
    tracing::info!("Using orkd binary: {}", orkd_path.display());

    let config = Arc::new(ServiceConfig {
        data_dir: data_dir.clone(),
        port: args.port,
        port_range: (args.port_range_start, args.port_range_end),
    });

    let supervisor = Arc::new(DaemonSupervisor::new(
        conn.clone(),
        orkd_path,
        data_dir.clone(),
        (args.port_range_start, args.port_range_end),
    ));

    // Capture which projects were running/starting before cleanup resets them.
    let previously_running: Vec<String> = {
        let projects = orkestra_service::list_projects(&conn)
            .map_err(|e| format!("Failed to list projects: {e}"))?;
        projects
            .iter()
            .filter(|p| p.status == ProjectStatus::Running || p.status == ProjectStatus::Starting)
            .map(|p| p.id.clone())
            .collect()
    };

    // Kill orphaned daemons left by a previous service crash.
    match supervisor.startup_cleanup() {
        Ok(n) if n > 0 => tracing::info!("Cleaned up {n} orphaned daemon(s)"),
        Ok(_) => {}
        Err(e) => tracing::warn!("Startup cleanup failed: {e}"),
    }

    // Re-create containers and spawn daemons for previously-running projects.
    // Container IDs were cleared by startup_cleanup, so we must create fresh containers.
    let all_projects = orkestra_service::list_projects(&conn)
        .map_err(|e| format!("Failed to list projects: {e}"))?;
    for proj in all_projects {
        if previously_running.contains(&proj.id) {
            tokio::spawn(start_containers_and_spawn(
                conn.clone(),
                Arc::clone(&supervisor),
                proj,
                false, // run_setup: false — repo is already set up
            ));
        }
    }

    // Start monitor loop in a background thread.
    {
        let sv = Arc::clone(&supervisor);
        std::thread::spawn(move || sv.run_monitor_loop());
    }

    // Print startup pairing code so the first client can authenticate.
    match orkestra_networking::generate_pairing_code::execute(&conn) {
        Ok(code) => {
            tracing::info!("Pairing code: {code} (valid 5 minutes — use POST /pair to claim)");
        }
        Err(e) => {
            tracing::warn!("Failed to generate startup pairing code: {e}");
        }
    }

    // Use the supervisor's stop flag so both the signal handler and the monitor
    // loop react to the same flag.
    let stop_flag = supervisor.stop_flag();
    {
        let stop_flag = stop_flag.clone();
        std::thread::spawn(move || {
            use signal_hook::consts::{SIGINT, SIGTERM};
            use signal_hook::iterator::Signals;
            let mut signals = Signals::new([SIGINT, SIGTERM]).expect("Failed to register signals");
            if signals.forever().next().is_some() {
                tracing::info!("Shutdown signal received");
                stop_flag.store(true, Ordering::Release);
            }
        });
    }

    // Bind the TCP listener before announcing readiness.
    let bind_addr = SocketAddr::new(args.bind, args.port);
    let listener = tokio::net::TcpListener::bind(bind_addr)
        .await
        .map_err(|e| format!("Failed to bind {bind_addr}: {e}"))?;
    tracing::info!("Service listening on {bind_addr}");

    // Build service UI router.
    let extra_routes = service_ui::router();

    // Start HTTP server — runs until the stop flag is set externally.
    let server_future = orkestra_service::start(
        conn,
        Arc::clone(&supervisor),
        config,
        listener,
        Some(extra_routes),
    );

    // Poll the stop flag and resolve when a signal arrives.
    let stop_watcher = {
        let stop_flag = stop_flag.clone();
        async move {
            loop {
                if stop_flag.load(Ordering::Acquire) {
                    break;
                }
                tokio::time::sleep(std::time::Duration::from_millis(200)).await;
            }
        }
    };

    tokio::select! {
        result = server_future => {
            if let Err(e) = result {
                tracing::error!("Server error: {e}");
            }
        }
        () = stop_watcher => {}
    }

    tracing::info!("Shutting down — stopping all child daemons…");

    #[cfg(unix)]
    supervisor.shutdown_all();

    tracing::info!("ork-service shutdown complete");
    Ok(())
}

// ============================================================================
// Helpers
// ============================================================================

/// Expand a leading `~` to the user's home directory.
fn expand_tilde(path: PathBuf) -> PathBuf {
    let s = path.to_string_lossy();
    if s == "~" {
        return std::env::var("HOME").map(PathBuf::from).unwrap_or(path);
    }
    if s.starts_with("~/") {
        if let Ok(home) = std::env::var("HOME") {
            return PathBuf::from(format!("{}{}", home, &s[1..]));
        }
    }
    path
}

/// Locate the `orkd` binary: first adjacent to this binary, then via PATH.
fn find_orkd_path() -> Result<PathBuf, String> {
    // 1. Same directory as the running ork-service binary.
    if let Ok(exe) = std::env::current_exe() {
        if let Some(dir) = exe.parent() {
            let candidate = dir.join("orkd");
            if candidate.exists() {
                return Ok(candidate);
            }
        }
    }

    // 2. PATH lookup via `which`.
    let output = std::process::Command::new("which")
        .arg("orkd")
        .output()
        .map_err(|e| format!("Failed to run which: {e}"))?;

    if output.status.success() {
        let path_str = String::from_utf8_lossy(&output.stdout).trim().to_string();
        if !path_str.is_empty() {
            return Ok(PathBuf::from(path_str));
        }
    }

    Err("Could not find orkd binary. Place it next to ork-service or add it to PATH.".to_string())
}
