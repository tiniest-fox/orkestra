//! `orkd` — headless Orkestra daemon with WebSocket remote control.
//!
//! Starts the orchestrator loop without Tauri and accepts WebSocket connections
//! for remote task management. Broadcasts orchestrator events to all connected
//! clients in real time.

use std::net::{IpAddr, SocketAddr};
use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};

use clap::Parser;
use tokio::sync::broadcast;
use tokio_util::sync::CancellationToken;

use orkestra_core::adapters::sqlite::DatabaseConnection;
use orkestra_core::workflow::adapters::{
    ClaudeProcessSpawner, GhPrService, Git2GitService, OpenCodeProcessSpawner, SqliteWorkflowStore,
};
use orkestra_core::workflow::execution::{
    claudecode_aliases, claudecode_capabilities, opencode_aliases, opencode_capabilities,
    ProviderRegistry,
};
use orkestra_core::workflow::ports::ProcessSpawner;
use orkestra_core::workflow::{
    AgentKiller, LogNotification, OrchestratorLoop, StageExecutionService, WorkflowApi,
    WorkflowStore,
};
use orkestra_core::{ensure_orkestra_project, orkestra_debug};
use orkestra_networking::{
    convert_orchestrator_event, generate_pairing_code, CommandContext, Event, HeaderValue,
    RelayClientConfig,
};

// ============================================================================
// CLI
// ============================================================================

/// Orkestra daemon — headless orchestrator with WebSocket remote control.
#[derive(Parser, Debug)]
#[command(version, about)]
struct Args {
    /// Path to the project root to orchestrate.
    #[arg(long, env = "ORKD_PROJECT_ROOT")]
    project_root: PathBuf,

    /// IP address to bind the WebSocket server to.
    #[arg(long, default_value = "127.0.0.1")]
    bind: IpAddr,

    /// Port to listen on.
    #[arg(long, default_value_t = 3847)]
    port: u16,

    /// Static bearer token for development (bypasses device pairing).
    ///
    /// Any WebSocket client presenting this token is authenticated without
    /// going through the pairing flow. Do not use in production.
    #[arg(long, env = "ORKD_TOKEN")]
    token: Option<String>,

    /// Generate and print a pairing code on startup, then exit.
    ///
    /// Clients can use this code with `POST /pair` to obtain a bearer token.
    #[arg(long)]
    generate_pairing_code: bool,

    /// Restrict CORS to a specific origin (e.g., <https://app.orkestra.dev>).
    ///
    /// When unset, any origin is allowed (permissive dev mode). When set, only
    /// the provided origin is permitted. Use `ORKD_ALLOWED_ORIGIN` env var for
    /// the same effect without a CLI flag.
    #[arg(long, env = "ORKD_ALLOWED_ORIGIN")]
    allowed_origin: Option<String>,

    /// Relay server URL (e.g., <wss://relay.orkestra.dev>). Enables relay connection.
    #[arg(long, env = "ORKD_RELAY_URL")]
    relay_url: Option<String>,

    /// API key for relay server authentication.
    #[arg(long, env = "ORKD_RELAY_API_KEY")]
    relay_api_key: Option<String>,
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

    // Fix PATH so the daemon inherits the user's shell PATH (mise shims, cargo,
    // node, etc.). Without this, tools invoked by spawned agents aren't found.
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

    let bind_addr = SocketAddr::new(args.bind, args.port);

    tracing::info!(
        project_root = %args.project_root.display(),
        %bind_addr,
        "Starting orkd"
    );

    let rt = tokio::runtime::Builder::new_multi_thread()
        .enable_all()
        .build()
        .expect("Failed to create tokio runtime");

    if let Err(e) = rt.block_on(run(
        args.project_root,
        bind_addr,
        args.token,
        args.generate_pairing_code,
        args.allowed_origin,
        args.relay_url,
        args.relay_api_key,
    )) {
        // Use eprintln! (not tracing::error!) — eprintln! writes directly and
        // synchronously to fd 2 with no buffering layer. tracing::error! routes
        // through the subscriber's internal buffer, which process::exit(1) tears
        // down before it can flush, causing the message to be silently dropped.
        eprintln!("Daemon error: {e}");
        std::process::exit(1);
    }
}

// ============================================================================
// Core Run Logic
// ============================================================================

#[allow(clippy::too_many_lines)]
async fn run(
    project_root: PathBuf,
    bind_addr: SocketAddr,
    static_token: Option<String>,
    generate_pairing_code_flag: bool,
    allowed_origin: Option<String>,
    relay_url: Option<String>,
    relay_api_key: Option<String>,
) -> Result<(), String> {
    // Validate allowed_origin before any side effects so we fail fast with a
    // clear message rather than panicking deep into startup.
    let allowed_origin: Option<HeaderValue> = match allowed_origin {
        None => None,
        Some(ref s) => Some(
            s.parse::<HeaderValue>()
                .map_err(|_| format!("Invalid --allowed-origin value: {s}"))?,
        ),
    };

    // -- Project init --
    let orkestra_dir = project_root.join(".orkestra");
    ensure_orkestra_project(&orkestra_dir).map_err(|e| format!("Failed to init .orkestra: {e}"))?;

    orkestra_core::debug_log::init(&orkestra_dir);

    let workflow = orkestra_core::workflow::load_workflow_for_project(&project_root)
        .map_err(|e| format!("Failed to load workflow: {e}"))?;

    let validation_errors = workflow.validate();
    if !validation_errors.is_empty() {
        return Err(format!(
            "Invalid workflow config: {}",
            validation_errors.join("; ")
        ));
    }

    // -- Database --
    let db_path = orkestra_dir.join(".database/orkestra.db");
    let (conn, recovered) =
        DatabaseConnection::open_validated(&db_path).map_err(|e| e.to_string())?;
    if recovered {
        orkestra_debug!("startup", "Database was corrupted — started fresh");
    }

    // Shared raw connection for auth operations (device_tokens, pairing_codes).
    let raw_conn = conn.shared();

    // -- Generate pairing code on demand --
    if generate_pairing_code_flag {
        match generate_pairing_code::execute(&raw_conn) {
            Ok(code) => {
                println!("Pairing code: {code}");
                println!("Use this code with POST /pair within 5 minutes.");
                return Ok(());
            }
            Err(e) => return Err(format!("Failed to generate pairing code: {e}")),
        }
    }

    let store: Arc<dyn WorkflowStore> = Arc::new(SqliteWorkflowStore::new(conn.shared()));

    // -- Git service (optional) --
    let git_service = match Git2GitService::new(&project_root) {
        Ok(git) => {
            orkestra_debug!("git", "Git service initialized");
            Some(Arc::new(git))
        }
        Err(e) => {
            orkestra_debug!("git", "Git unavailable: {} — running without worktrees", e);
            None
        }
    };

    // -- Provider registry for assistant commands (needed by WorkflowApi for chat) --
    // A standalone registry separate from the one used by StageExecutionService
    // (which creates its own internally). The registry is stateless, so having
    // two instances is fine.
    let provider_registry = {
        let mut registry = ProviderRegistry::new("claudecode");
        registry.register(
            "claudecode",
            Arc::new(ClaudeProcessSpawner::new()) as Arc<dyn ProcessSpawner>,
            claudecode_capabilities(),
            claudecode_aliases(),
        );
        registry.register(
            "opencode",
            Arc::new(OpenCodeProcessSpawner::new()) as Arc<dyn ProcessSpawner>,
            opencode_capabilities(),
            opencode_aliases(),
        );
        Arc::new(registry)
    };

    // -- WorkflowApi --
    let api = if let Some(git) = git_service {
        WorkflowApi::with_git(workflow.clone(), Arc::clone(&store), git)
            .with_pr_service(Arc::new(GhPrService::new()))
            .with_provider_registry(Arc::clone(&provider_registry))
            .with_project_root(project_root.clone())
    } else {
        WorkflowApi::new(workflow.clone(), Arc::clone(&store))
            .with_provider_registry(Arc::clone(&provider_registry))
            .with_project_root(project_root.clone())
    };

    // Cleanup orphaned agents from a previous crash.
    match api.cleanup_orphaned_agents() {
        Ok(n) if n > 0 => orkestra_debug!("startup", "Cleaned up {n} orphaned agent(s)"),
        Ok(_) => {}
        Err(e) => orkestra_debug!("startup", "Orphan cleanup failed: {e}"),
    }

    let api = Arc::new(Mutex::new(api));

    // -- Stage execution service --
    let iteration_service = {
        let api_lock = api.lock().expect("API mutex poisoned during init");
        Arc::clone(api_lock.iteration_service())
    };

    // Log notification channel — forwards log-write events from stage execution and chat
    // to WebSocket clients as `log_entry_appended` events.
    let (log_tx, log_rx) = std::sync::mpsc::channel::<LogNotification>();

    let mut stage_executor_inner = StageExecutionService::new(
        workflow.clone(),
        project_root.clone(),
        Arc::clone(&store),
        iteration_service,
    );
    stage_executor_inner.set_log_notify_tx(log_tx.clone());
    let stage_executor = Arc::new(stage_executor_inner);

    // Inject AgentKiller so that interrupt() can kill the agent process.
    // Also wire the log notification sender for stage chat.
    {
        let mut api_lock = api.lock().expect("API mutex poisoned during init");
        api_lock.set_agent_killer(Arc::clone(&stage_executor) as Arc<dyn AgentKiller>);
        api_lock.set_log_notify_tx(log_tx);
    }

    // -- Event channel --
    let (event_tx, _event_rx) = broadcast::channel::<Event>(256);

    // -- Shared CommandContext (used by both server and relay client) --
    let ctx = Arc::new(CommandContext::new(
        Arc::clone(&api),
        Arc::clone(&raw_conn),
        project_root.clone(),
        provider_registry,
        Arc::clone(&store),
    ));

    // -- Log notification listener thread --
    // Reads LogNotification values from the mpsc channel and broadcasts
    // `log_entry_appended` events to all connected WebSocket clients.
    // The thread exits when all senders (stage_executor + api) are dropped.
    let event_tx_for_log = event_tx.clone();
    std::thread::spawn(move || {
        while let Ok(notification) = log_rx.recv() {
            let _ = event_tx_for_log.send(Event::log_entry_appended(
                notification.task_id,
                notification.session_id,
                notification.last_entry_summary,
            ));
        }
    });

    // -- Orchestrator thread --
    let stop_flag = Arc::new(AtomicBool::new(false));
    let orch_stop_flag = Arc::clone(&stop_flag);
    let api_for_broadcast = Arc::clone(&api);
    let event_tx_for_orch = event_tx.clone();

    let orchestrator = OrchestratorLoop::new(Arc::clone(&api), Arc::clone(&stage_executor))
        .with_project_root(project_root.clone());
    let orch_loop_stop = orchestrator.stop_flag();

    // Forward the shared stop flag to the orchestrator's own stop flag.
    let stop_flag_forwarding = Arc::clone(&stop_flag);
    let orch_loop_stop_clone = Arc::clone(&orch_loop_stop);
    std::thread::spawn(move || {
        while !stop_flag_forwarding.load(Ordering::Acquire) {
            std::thread::sleep(std::time::Duration::from_millis(100));
        }
        orch_loop_stop_clone.store(true, Ordering::Release);
    });

    let orch_handle = std::thread::spawn(move || {
        orchestrator.run(|event| {
            let events = convert_orchestrator_event(&event, &api_for_broadcast);
            for e in events {
                let _ = event_tx_for_orch.send(e);
            }
        });
        orkestra_debug!("orchestrator", "Orchestrator thread exited");
    });

    // -- Signal handling --
    let stop_flag_for_signal = Arc::clone(&stop_flag);
    std::thread::spawn(move || {
        use signal_hook::consts::{SIGINT, SIGTERM};
        use signal_hook::iterator::Signals;
        let mut signals = Signals::new([SIGINT, SIGTERM]).expect("Failed to register signals");
        if signals.forever().next().is_some() {
            tracing::info!("Shutdown signal received");
            stop_flag_for_signal.store(true, Ordering::Release);
        }
    });

    // -- Startup pairing code (no --generate-pairing-code flag, normal run) --
    // If no static token is configured, print a pairing code on startup so that
    // the first client can authenticate.
    if static_token.is_none() {
        match generate_pairing_code::execute(&raw_conn) {
            Ok(code) => {
                tracing::info!("Pairing code: {code} (valid 5 minutes — use POST /pair to claim)");
            }
            Err(e) => {
                tracing::warn!("Failed to generate startup pairing code: {e}");
            }
        }
    }

    // -- Relay client (optional) --
    let relay_stop = CancellationToken::new();
    if let Some(url) = relay_url {
        let api_key = relay_api_key
            .ok_or_else(|| "--relay-api-key is required when --relay-url is set".to_string())?;

        let device_id = {
            let conn = raw_conn
                .lock()
                .map_err(|_| "Failed to acquire DB lock".to_string())?;
            orkestra_store::interactions::daemon_config::load_or_generate_device_id::execute(&conn)
                .map_err(|e| format!("Failed to load device ID: {e}"))?
        };
        tracing::info!("Relay device ID: {device_id}");

        let relay_config = RelayClientConfig {
            relay_url: url,
            api_key,
            device_id,
        };
        let relay_stop_clone = relay_stop.clone();
        let ctx_for_relay = Arc::clone(&ctx);
        let event_tx_for_relay = event_tx.clone();

        tokio::spawn(async move {
            if let Err(e) = orkestra_networking::relay_client::connect(
                relay_config,
                ctx_for_relay,
                event_tx_for_relay,
                relay_stop_clone,
            )
            .await
            {
                tracing::error!("Relay client error: {e}");
            }
        });
    }

    // -- WebSocket server (runs until stop_flag is set externally) --
    let event_tx_for_server = event_tx.clone();

    // The server future needs to be cancellable. We poll it alongside a stop
    // watcher so we can exit when the stop flag is set.
    let listener = tokio::net::TcpListener::bind(bind_addr)
        .await
        .map_err(|e| format!("Failed to bind {bind_addr}: {e}"))?;
    tracing::info!("Daemon listening on {bind_addr}");
    let server_future = orkestra_networking::start(
        ctx,
        event_tx_for_server,
        static_token,
        listener,
        allowed_origin,
    );

    // Watch for stop flag and abort server once set.
    let stop_watcher = {
        let stop_flag = Arc::clone(&stop_flag);
        async move {
            loop {
                if stop_flag.load(Ordering::Acquire) {
                    break;
                }
                tokio::time::sleep(std::time::Duration::from_millis(200)).await;
            }
        }
    };

    // Run server until stop flag is set.
    tokio::select! {
        result = server_future => {
            if let Err(e) = result {
                tracing::error!("Server error: {e}");
            }
        }
        () = stop_watcher => {}
    }

    // Cancel relay client.
    relay_stop.cancel();

    tracing::info!("Shutting down — waiting for orchestrator thread…");

    // Give the orchestrator up to 5 seconds to finish its current tick.
    orch_stop_flag.store(true, Ordering::Release);
    let join_deadline = std::time::Instant::now() + std::time::Duration::from_secs(5);
    while !orch_handle.is_finished() {
        if std::time::Instant::now() >= join_deadline {
            tracing::warn!("Orchestrator did not stop within 5s — continuing shutdown");
            break;
        }
        std::thread::sleep(std::time::Duration::from_millis(100));
    }

    // Kill active agents.
    for task_id in stage_executor.active_task_ids() {
        stage_executor.kill_active_agent(&task_id);
    }

    // WAL checkpoint.
    if let Err(e) = conn.checkpoint() {
        tracing::warn!("WAL checkpoint failed: {e}");
    }

    tracing::info!("orkd shutdown complete");
    Ok(())
}
