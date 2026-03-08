//! axum HTTP server for the ork-service binary.
//!
//! Provides REST API routes for project management, GitHub integration, and
//! device pairing. Bearer token auth is required for all `/api/*` routes;
//! `POST /pair` is unauthenticated so clients can obtain their first token.

use std::collections::HashMap;
use std::sync::{Arc, Mutex};

use axum::body::Body;
use axum::extract::ws::{Message as WsMessage, WebSocket, WebSocketUpgrade};
use axum::extract::{Path, Query, Request, State};
use axum::http::{HeaderMap, StatusCode};
use axum::middleware::Next;
use axum::response::{IntoResponse, Response};
use axum::routing::{delete, get, post};
use axum::{Json, Router};
use futures_util::{SinkExt, StreamExt};
use rusqlite::Connection;
use serde::{Deserialize, Serialize};
use tower_http::cors::CorsLayer;

use crate::daemon_supervisor::DaemonSupervisor;
use crate::interactions::{daemon_token, github, port, project};
use crate::types::{ProjectStatus, ServiceConfig, ServiceError};

// ============================================================================
// Server State
// ============================================================================

/// Shared state injected into every axum handler.
#[derive(Clone)]
pub(crate) struct OrkServiceState {
    conn: Arc<Mutex<Connection>>,
    supervisor: Arc<DaemonSupervisor>,
    config: Arc<ServiceConfig>,
    /// Per-daemon mutex to serialise concurrent auto-pairing calls.
    pairing_locks: Arc<Mutex<HashMap<String, Arc<tokio::sync::Mutex<()>>>>>,
}

impl OrkServiceState {
    fn pairing_lock_for(&self, project_id: &str) -> Arc<tokio::sync::Mutex<()>> {
        let mut map = self.pairing_locks.lock().expect("pairing_locks poisoned");
        map.entry(project_id.to_string())
            .or_insert_with(|| Arc::new(tokio::sync::Mutex::new(())))
            .clone()
    }
}

// ============================================================================
// Public Entry Point
// ============================================================================

/// Start the HTTP server using a pre-bound `listener`.
///
/// `extra_routes` allows the calling binary to inject additional routes (e.g.
/// PWA static file serving) that are merged into the router before binding.
pub async fn start(
    conn: Arc<Mutex<Connection>>,
    supervisor: Arc<DaemonSupervisor>,
    config: Arc<ServiceConfig>,
    listener: tokio::net::TcpListener,
    extra_routes: Option<Router>,
) -> Result<(), std::io::Error> {
    let local_addr = listener.local_addr()?;

    let state = OrkServiceState {
        conn,
        supervisor,
        config,
        pairing_locks: Arc::new(Mutex::new(HashMap::new())),
    };

    let auth_routes = Router::new()
        .route(
            "/api/projects",
            get(list_projects_handler).post(add_project_handler),
        )
        .route("/api/projects/{id}", delete(remove_project_handler))
        .route("/api/projects/{id}/start", post(start_project_handler))
        .route("/api/projects/{id}/stop", post(stop_project_handler))
        .route("/api/projects/{id}/rebuild", post(rebuild_project_handler))
        .route("/api/github/repos", get(github_repos_handler))
        .route("/api/github/status", get(github_status_handler))
        .route("/api/pairing-code", post(generate_pairing_code_handler))
        .layer(axum::middleware::from_fn_with_state(
            state.clone(),
            require_bearer_auth,
        ));

    let mut router = Router::new()
        .route("/pair", post(pair_handler))
        .route("/projects/{id}/ws", get(ws_proxy_handler))
        .merge(auth_routes)
        .layer(CorsLayer::permissive())
        .with_state(state);

    if let Some(extra) = extra_routes {
        router = router.merge(extra);
    }

    tracing::info!("Service HTTP server listening on {local_addr}");

    axum::serve(listener, router).await
}

// ============================================================================
// Auth Middleware
// ============================================================================

/// Verified device info stored in request extensions by `require_bearer_auth`.
#[derive(Clone)]
pub(crate) struct AuthenticatedDevice {
    pub id: String,
}

/// Extract `Authorization: Bearer <token>`, verify it against the service DB,
/// and store `AuthenticatedDevice` in request extensions. Returns 401 on
/// failure.
async fn require_bearer_auth(
    State(state): State<OrkServiceState>,
    mut request: Request,
    next: Next,
) -> Response {
    let Some(token) = extract_bearer_token(request.headers()) else {
        return (
            StatusCode::UNAUTHORIZED,
            Json(serde_json::json!({"error": "Missing Authorization header"})),
        )
            .into_response();
    };

    let conn = Arc::clone(&state.conn);
    let result = tokio::task::spawn_blocking(move || {
        orkestra_networking::verify_token::execute(&conn, &token)
    })
    .await;

    match result {
        Ok(Ok(device)) => {
            request
                .extensions_mut()
                .insert(AuthenticatedDevice { id: device.id });
            next.run(request).await
        }
        Ok(Err(_)) | Err(_) => (
            StatusCode::UNAUTHORIZED,
            Json(serde_json::json!({"error": "Invalid or expired token"})),
        )
            .into_response(),
    }
}

// ============================================================================
// Route Handlers
// ============================================================================

// -- Pairing (unauthenticated) --

#[derive(Debug, Deserialize)]
struct PairRequest {
    code: String,
    device_name: String,
}

#[derive(Debug, Serialize)]
struct PairResponse {
    token: String,
}

/// `POST /pair` — exchange a pairing code for a service-level bearer token.
async fn pair_handler(
    State(state): State<OrkServiceState>,
    Json(body): Json<PairRequest>,
) -> Response<Body> {
    let conn = Arc::clone(&state.conn);
    let code = body.code;
    let device_name = body.device_name;

    let result = tokio::task::spawn_blocking(move || {
        orkestra_networking::pair_device::execute(&conn, &code, &device_name)
    })
    .await;

    match result {
        Ok(Ok(token)) => Json(PairResponse { token }).into_response(),
        Ok(Err(orkestra_networking::AuthError::InvalidCode)) => (
            StatusCode::BAD_REQUEST,
            Json(serde_json::json!({"error": "Invalid, expired, or already claimed pairing code"})),
        )
            .into_response(),
        Ok(Err(e)) => (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(serde_json::json!({"error": e.to_string()})),
        )
            .into_response(),
        Err(e) => (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(serde_json::json!({"error": e.to_string()})),
        )
            .into_response(),
    }
}

// -- Pairing code generation (authenticated) --

#[derive(Debug, Serialize)]
struct PairingCodeResponse {
    code: String,
}

/// `POST /api/pairing-code` — generate a pairing code for new device onboarding.
async fn generate_pairing_code_handler(State(state): State<OrkServiceState>) -> Response<Body> {
    let conn = Arc::clone(&state.conn);
    let result = tokio::task::spawn_blocking(move || {
        orkestra_networking::generate_pairing_code::execute(&conn)
    })
    .await;

    match result {
        Ok(Ok(code)) => Json(PairingCodeResponse { code }).into_response(),
        Ok(Err(e)) => (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(serde_json::json!({"error": e.to_string()})),
        )
            .into_response(),
        Err(e) => (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(serde_json::json!({"error": e.to_string()})),
        )
            .into_response(),
    }
}

// -- Projects --

/// Project response shape for `/api/projects` endpoints.
#[derive(Debug, Serialize)]
struct ProjectResponse {
    id: String,
    name: String,
    path: String,
    ws_url: String,
    token: Option<String>,
    /// Set when daemon token acquisition fails; `None` on success.
    token_error: Option<String>,
    status: ProjectStatus,
    error_message: Option<String>,
    /// Whether the project repo has a `.devcontainer/devcontainer.json`.
    has_devcontainer: bool,
}

impl ProjectResponse {
    fn from_project(
        proj: &crate::types::Project,
        token: Option<String>,
        token_error: Option<String>,
        ws_base: &str,
        has_devcontainer: bool,
    ) -> Self {
        Self {
            id: proj.id.clone(),
            name: proj.name.clone(),
            path: proj.path.clone(),
            ws_url: format!("{ws_base}/projects/{}/ws", proj.id),
            token,
            token_error,
            status: proj.status,
            error_message: proj.error_message.clone(),
            has_devcontainer,
        }
    }
}

/// `GET /api/projects` — list all projects, injecting daemon tokens for running ones.
async fn list_projects_handler(
    State(state): State<OrkServiceState>,
    request: Request,
) -> Response<Body> {
    let Some(device) = request.extensions().get::<AuthenticatedDevice>().cloned() else {
        return (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(serde_json::json!({"error": "Internal authentication error"})),
        )
            .into_response();
    };

    let projects = match run_blocking({
        let conn = Arc::clone(&state.conn);
        move || project::list::execute(&conn)
    })
    .await
    {
        Ok(p) => p,
        Err(r) => return r,
    };

    let ws_base = ws_base_from_headers(request.headers());

    // Compute devcontainer flags in a blocking context — Path::exists() is a
    // synchronous syscall that must not run on the async worker thread.
    let has_devcontainer_flags: Vec<bool> = {
        let paths: Vec<String> = projects.iter().map(|p| p.path.clone()).collect();
        tokio::task::spawn_blocking(move || {
            paths
                .iter()
                .map(|path| {
                    std::path::Path::new(path)
                        .join(".devcontainer")
                        .join("devcontainer.json")
                        .exists()
                })
                .collect::<Vec<_>>()
        })
        .await
        .unwrap_or_else(|_| vec![false; projects.len()])
    };

    let mut responses: Vec<ProjectResponse> = Vec::with_capacity(projects.len());

    for (proj, has_devcontainer) in projects.iter().zip(has_devcontainer_flags) {
        let (token, token_error) = if proj.status == ProjectStatus::Running {
            let lock = state.pairing_lock_for(&proj.id);
            match daemon_token::get_or_create::execute(&state.conn, &device.id, proj, lock).await {
                Ok(t) => (Some(t), None),
                Err(e) => {
                    tracing::warn!("Failed to get daemon token for {}: {e}", proj.id);
                    (None, Some(e.to_string()))
                }
            }
        } else {
            (None, None)
        };

        responses.push(ProjectResponse::from_project(
            proj,
            token,
            token_error,
            &ws_base,
            has_devcontainer,
        ));
    }

    Json(responses).into_response()
}

#[derive(Debug, Deserialize)]
struct AddProjectRequest {
    repo_url: String,
    name: String,
}

/// `POST /api/projects` — clone a repo, initialise `.orkestra`, and spawn a daemon.
///
/// Returns immediately with the project record (status: "cloning"). The clone
/// and daemon spawn happen in a background task.
async fn add_project_handler(
    State(state): State<OrkServiceState>,
    headers: HeaderMap,
    Json(body): Json<AddProjectRequest>,
) -> Response<Body> {
    let ws_base = ws_base_from_headers(&headers);
    if let Err(e) = validate_project_name(&body.name) {
        return (
            StatusCode::BAD_REQUEST,
            Json(serde_json::json!({"error": e})),
        )
            .into_response();
    }

    let conn = Arc::clone(&state.conn);
    let config = Arc::clone(&state.config);

    // Allocate a port.
    let (start, end) = config.port_range;
    let port = match run_blocking({
        let conn2 = Arc::clone(&conn);
        move || port::find_available::execute(&conn2, start, end)
    })
    .await
    {
        Ok(p) => p,
        Err(r) => return r,
    };

    // Generate a shared secret (32 random bytes as hex).
    let shared_secret = generate_shared_secret();

    // Insert the project with status "cloning".
    let proj = {
        let conn2 = Arc::clone(&conn);
        let name = body.name.clone();
        let target_path = config
            .data_dir
            .join("repos")
            .join(&name)
            .to_string_lossy()
            .to_string();
        let secret = shared_secret.clone();
        match tokio::task::spawn_blocking(move || {
            project::add::execute(&conn2, &name, &target_path, port, &secret)
        })
        .await
        {
            Ok(Ok(p)) => p,
            Ok(Err(ServiceError::DuplicatePath(p))) => {
                return (
                    StatusCode::CONFLICT,
                    Json(serde_json::json!({"error": format!("Project path already exists: {p}")})),
                )
                    .into_response();
            }
            Ok(Err(e)) => {
                return (
                    StatusCode::INTERNAL_SERVER_ERROR,
                    Json(serde_json::json!({"error": e.to_string()})),
                )
                    .into_response();
            }
            Err(e) => {
                return (
                    StatusCode::INTERNAL_SERVER_ERROR,
                    Json(serde_json::json!({"error": e.to_string()})),
                )
                    .into_response();
            }
        }
    };

    // Spawn the clone+init+daemon sequence in the background.
    let repo_url = body.repo_url.clone();
    let supervisor = Arc::clone(&state.supervisor);
    let proj_for_bg = proj.clone();
    tokio::spawn(project::provision::execute(
        conn,
        supervisor,
        proj_for_bg,
        repo_url,
    ));

    // Repository is still being cloned — devcontainer.json cannot exist yet.
    Json(ProjectResponse::from_project(
        &proj, None, None, &ws_base, false,
    ))
    .into_response()
}

/// `DELETE /api/projects/{id}` — stop daemon and remove project.
async fn remove_project_handler(
    State(state): State<OrkServiceState>,
    Path(id): Path<String>,
) -> Response<Body> {
    // Fetch project to verify it exists and capture its path for cleanup.
    let project_path = {
        let fetch_result = tokio::task::spawn_blocking({
            let conn = Arc::clone(&state.conn);
            let id = id.clone();
            move || project::get::execute(&conn, &id)
        })
        .await;

        match fetch_result {
            Ok(Err(ServiceError::ProjectNotFound(_))) => {
                return StatusCode::NOT_FOUND.into_response();
            }
            Ok(Err(e)) => {
                return (
                    StatusCode::INTERNAL_SERVER_ERROR,
                    Json(serde_json::json!({"error": e.to_string()})),
                )
                    .into_response();
            }
            Err(e) => {
                return (
                    StatusCode::INTERNAL_SERVER_ERROR,
                    Json(serde_json::json!({"error": e.to_string()})),
                )
                    .into_response();
            }
            Ok(Ok(project)) => project.path,
        }
    };

    // Stop daemon (best-effort — project may already be stopped).
    // stop_daemon acquires a std::sync::Mutex and may block for up to 5 s,
    // so it must not run on the tokio worker thread.
    {
        let supervisor = Arc::clone(&state.supervisor);
        let stop_id = id.clone();
        match tokio::task::spawn_blocking(move || supervisor.stop_daemon(&stop_id)).await {
            Ok(Err(e)) => tracing::warn!("Error stopping daemon for {id}: {e}"),
            Err(e) => tracing::warn!("stop_daemon task panicked for {id}: {e}"),
            Ok(Ok(())) => {}
        }
    }

    // Remove from DB.
    if let Err(r) = run_blocking({
        let conn = Arc::clone(&state.conn);
        move || project::remove::execute(&conn, &id)
    })
    .await
    {
        return r;
    }

    // Best-effort: delete the cloned directory from disk so that re-adding the
    // same repo doesn't fail with "destination path already exists".
    let path = std::path::PathBuf::from(&project_path);
    if let Err(e) = std::fs::remove_dir_all(&path) {
        if e.kind() != std::io::ErrorKind::NotFound {
            tracing::warn!("Failed to delete project directory {}: {e}", path.display());
        }
    }

    StatusCode::OK.into_response()
}

/// `POST /api/projects/{id}/start` — create a container and spawn a daemon for a stopped project.
async fn start_project_handler(
    State(state): State<OrkServiceState>,
    Path(id): Path<String>,
) -> Response<Body> {
    let proj = match run_blocking({
        let conn = Arc::clone(&state.conn);
        move || project::get::execute(&conn, &id)
    })
    .await
    {
        Ok(p) => p,
        Err(r) => return r,
    };

    // Container setup is async (docker pull/run may take time); run in background.
    tokio::spawn(project::provision::start_containers_and_spawn(
        Arc::clone(&state.conn),
        Arc::clone(&state.supervisor),
        proj,
        false, // run_setup: false for restarts (repo is already set up)
    ));

    StatusCode::ACCEPTED.into_response()
}

/// `POST /api/projects/{id}/rebuild` — stop the current container, rebuild it,
/// and restart the daemon. Runs setup commands again (postCreateCommand / mise install).
async fn rebuild_project_handler(
    State(state): State<OrkServiceState>,
    Path(id): Path<String>,
) -> Response<Body> {
    let proj = match run_blocking({
        let conn = Arc::clone(&state.conn);
        let id = id.clone();
        move || project::get::execute(&conn, &id)
    })
    .await
    {
        Ok(p) => p,
        Err(r) => return r,
    };

    // Stop daemon + container synchronously so we don't start a rebuild race.
    match tokio::task::spawn_blocking({
        let supervisor = Arc::clone(&state.supervisor);
        let stop_id = id.clone();
        move || supervisor.stop_daemon(&stop_id)
    })
    .await
    {
        Ok(Err(e)) => tracing::warn!("Error stopping daemon for rebuild {id}: {e}"),
        Err(e) => tracing::warn!("stop_daemon panicked for {id}: {e}"),
        Ok(Ok(())) => {}
    }

    // Rebuild: create new container with setup, then spawn daemon.
    tokio::spawn(project::provision::start_containers_and_spawn(
        Arc::clone(&state.conn),
        Arc::clone(&state.supervisor),
        proj,
        true, // run_setup: true for rebuild
    ));

    StatusCode::ACCEPTED.into_response()
}

/// `POST /api/projects/{id}/stop` — stop a running daemon and mark the project stopped.
async fn stop_project_handler(
    State(state): State<OrkServiceState>,
    Path(id): Path<String>,
) -> Response<Body> {
    match tokio::task::spawn_blocking({
        let supervisor = Arc::clone(&state.supervisor);
        let stop_id = id.clone();
        move || supervisor.stop_daemon(&stop_id)
    })
    .await
    {
        Ok(Err(e)) => tracing::warn!("Error stopping daemon for {id}: {e}"),
        Err(e) => tracing::warn!("stop_daemon task panicked for {id}: {e}"),
        Ok(Ok(())) => {}
    }

    if let Err(r) = run_blocking({
        let conn = Arc::clone(&state.conn);
        move || project::update_status::execute(&conn, &id, ProjectStatus::Stopped, None, None)
    })
    .await
    {
        return r;
    }

    StatusCode::OK.into_response()
}

// -- GitHub --

/// `GET /api/github/repos` — list repos via the `gh` CLI.
async fn github_repos_handler(
    axum::extract::Query(params): axum::extract::Query<HashMap<String, String>>,
) -> Response<Body> {
    let search = params.get("search").cloned();
    match run_blocking(move || github::list_repos::execute(search.as_deref())).await {
        Ok(repos) => Json(repos).into_response(),
        Err(r) => r,
    }
}

#[derive(Debug, Serialize)]
struct GithubStatusResponse {
    available: bool,
    error: Option<String>,
}

/// `GET /api/github/status` — report whether `gh` is authenticated.
async fn github_status_handler() -> Response<Body> {
    let result = tokio::task::spawn_blocking(github::check_auth::execute).await;

    match result {
        Ok(Ok(available)) => Json(GithubStatusResponse {
            available,
            error: None,
        })
        .into_response(),
        Ok(Err(e)) => Json(GithubStatusResponse {
            available: false,
            error: Some(e.to_string()),
        })
        .into_response(),
        Err(e) => (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(serde_json::json!({"error": e.to_string()})),
        )
            .into_response(),
    }
}

// ============================================================================
// Helpers
// ============================================================================

/// `GET /projects/{id}/ws` — proxy a WebSocket connection to the project's local daemon.
///
/// The browser connects here with its daemon token in `?token=<token>`. We look up
/// the project's daemon port and forward all WebSocket traffic to it, letting the
/// daemon validate the token itself.
async fn ws_proxy_handler(
    ws: WebSocketUpgrade,
    Path(project_id): Path<String>,
    Query(params): Query<HashMap<String, String>>,
    State(state): State<OrkServiceState>,
) -> Response {
    let token = params.get("token").cloned().unwrap_or_default();

    let conn = Arc::clone(&state.conn);
    let proj = match tokio::task::spawn_blocking(move || project::get::execute(&conn, &project_id))
        .await
    {
        Ok(Ok(p)) => p,
        Ok(Err(crate::types::ServiceError::ProjectNotFound(_))) => {
            return StatusCode::NOT_FOUND.into_response();
        }
        Ok(Err(e)) => {
            return (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(serde_json::json!({"error": e.to_string()})),
            )
                .into_response();
        }
        Err(e) => {
            return (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(serde_json::json!({"error": e.to_string()})),
            )
                .into_response();
        }
    };

    let daemon_port = proj.daemon_port;
    let project_id = proj.id.clone();
    ws.on_upgrade(move |socket| proxy_ws(socket, project_id, daemon_port, token))
}

/// Bridge a client WebSocket to a daemon WebSocket on the project container.
///
/// In `DooD` setups the daemon port is bound on the host's loopback and is not
/// reachable from the service container. We connect by container name instead,
/// which is resolvable on the shared Docker network set up by `connect_network`.
async fn proxy_ws(mut client: WebSocket, project_id: String, daemon_port: u16, token: String) {
    use tokio_tungstenite::tungstenite::Message as TMsg;

    let host = if std::path::Path::new("/.dockerenv").exists() {
        format!("orkestra-{project_id}")
    } else {
        "127.0.0.1".to_string()
    };
    let url = format!("ws://{host}:{daemon_port}/ws?token={token}");
    let (mut daemon_ws, _) = match tokio_tungstenite::connect_async(&url).await {
        Ok(c) => c,
        Err(e) => {
            tracing::warn!("Daemon WS connect failed on port {daemon_port}: {e}");
            return;
        }
    };

    loop {
        tokio::select! {
            client_msg = client.recv() => {
                let Some(Ok(msg)) = client_msg else { break };
                let daemon_msg = match msg {
                    WsMessage::Text(t) => TMsg::Text(t.as_str().into()),
                    WsMessage::Binary(b) => TMsg::Binary(b),
                    WsMessage::Ping(p) => TMsg::Ping(p),
                    WsMessage::Pong(p) => TMsg::Pong(p),
                    WsMessage::Close(_) => break,
                };
                if daemon_ws.send(daemon_msg).await.is_err() {
                    break;
                }
            }
            daemon_msg = daemon_ws.next() => {
                let Some(Ok(msg)) = daemon_msg else { break };
                let client_msg = match msg {
                    TMsg::Text(t) => WsMessage::Text(t.to_string().into()),
                    TMsg::Binary(b) => WsMessage::Binary(b),
                    TMsg::Ping(p) => WsMessage::Ping(p),
                    TMsg::Pong(p) => WsMessage::Pong(p),
                    TMsg::Close(_) => break,
                    TMsg::Frame(_) => continue,
                };
                if client.send(client_msg).await.is_err() {
                    break;
                }
            }
        }
    }
}

/// Build a WebSocket base URL (`ws://host` or `wss://host`) from request headers.
///
/// Checks two signals in priority order:
/// 1. `X-Forwarded-Proto` — set by most reverse proxies (Nginx, Traefik, etc.)
/// 2. `CF-Visitor` — Cloudflare always sets `{"scheme":"https"}` for HTTPS
///    traffic, even when Traefik overwrites `X-Forwarded-Proto` with `http`
///    on the Cloudflare→origin leg.
fn ws_base_from_headers(headers: &HeaderMap) -> String {
    let host = headers
        .get("host")
        .and_then(|v| v.to_str().ok())
        .unwrap_or("localhost:3847");

    // X-Forwarded-Proto may be a comma-separated list when multiple proxies
    // are in the chain (e.g. "https,http"). The first value is the outermost
    // scheme seen by the client.
    let forwarded_proto = headers
        .get("x-forwarded-proto")
        .and_then(|v| v.to_str().ok())
        .unwrap_or("");

    let cf_visitor = headers
        .get("cf-visitor")
        .and_then(|v| v.to_str().ok())
        .unwrap_or("");

    let is_https = forwarded_proto
        .split(',')
        .next()
        .unwrap_or("")
        .trim()
        .eq_ignore_ascii_case("https")
        || cf_visitor.contains("\"https\"");

    let ws_scheme = if is_https { "wss" } else { "ws" };
    format!("{ws_scheme}://{host}")
}

/// Reject project names that could enable path traversal.
///
/// Names must be non-empty and must not contain `/`, `\`, `..`, or null bytes.
fn validate_project_name(name: &str) -> Result<(), &'static str> {
    if name.is_empty() {
        return Err("Project name cannot be empty");
    }
    if name.contains('/') || name.contains('\\') || name.contains("..") || name.contains('\0') {
        return Err("Project name contains invalid characters");
    }
    Ok(())
}

/// Extract the bearer token from an `Authorization: Bearer <token>` header.
fn extract_bearer_token(headers: &HeaderMap) -> Option<String> {
    let auth = headers.get("Authorization")?.to_str().ok()?;
    auth.strip_prefix("Bearer ").map(|t| t.trim().to_string())
}

/// Generate a 32-byte random value as a 64-char hex string.
fn generate_shared_secret() -> String {
    use rand::RngCore;
    let mut bytes = [0u8; 32];
    rand::thread_rng().fill_bytes(&mut bytes);
    bytes.iter().fold(String::new(), |mut s, b| {
        use std::fmt::Write;
        write!(s, "{b:02x}").expect("write to String is infallible");
        s
    })
}

/// Run a blocking DB operation on a thread pool, returning an HTTP error response on failure.
async fn run_blocking<T, F>(f: F) -> Result<T, Response<Body>>
where
    F: FnOnce() -> Result<T, ServiceError> + Send + 'static,
    T: Send + 'static,
{
    match tokio::task::spawn_blocking(f).await {
        Ok(Ok(v)) => Ok(v),
        Ok(Err(e)) => Err((
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(serde_json::json!({"error": e.to_string()})),
        )
            .into_response()),
        Err(e) => Err((
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(serde_json::json!({"error": e.to_string()})),
        )
            .into_response()),
    }
}

// ============================================================================
// Tests
// ============================================================================

#[cfg(test)]
mod tests {
    use axum::http::HeaderMap;

    use super::{validate_project_name, ws_base_from_headers};

    // -- ws_base_from_headers --

    fn headers_from_pairs(pairs: &[(&str, &str)]) -> HeaderMap {
        let mut map = HeaderMap::new();
        for (k, v) in pairs {
            map.insert(
                axum::http::HeaderName::from_bytes(k.as_bytes()).unwrap(),
                axum::http::HeaderValue::from_str(v).unwrap(),
            );
        }
        map
    }

    #[test]
    fn uses_wss_when_x_forwarded_proto_is_https() {
        let headers =
            headers_from_pairs(&[("host", "example.com"), ("x-forwarded-proto", "https")]);
        assert_eq!(ws_base_from_headers(&headers), "wss://example.com");
    }

    #[test]
    fn uses_wss_when_cf_visitor_is_https_and_proto_is_http() {
        // Exact headers observed behind Cloudflare + Traefik (Dokploy).
        // Traefik overwrites x-forwarded-proto to "http" but Cloudflare's
        // CF-Visitor still carries the original scheme.
        let headers = headers_from_pairs(&[
            ("host", "orkestra.tiniestfox.com"),
            ("x-forwarded-proto", "http"),
            ("x-forwarded-port", "80"),
            ("cf-visitor", "{\"scheme\":\"https\"}"),
        ]);
        assert_eq!(
            ws_base_from_headers(&headers),
            "wss://orkestra.tiniestfox.com"
        );
    }

    #[test]
    fn uses_ws_when_both_signals_absent() {
        let headers = headers_from_pairs(&[("host", "localhost:3847")]);
        assert_eq!(ws_base_from_headers(&headers), "ws://localhost:3847");
    }

    #[test]
    fn uses_ws_when_proto_http_and_no_cf_visitor() {
        let headers =
            headers_from_pairs(&[("host", "localhost:3847"), ("x-forwarded-proto", "http")]);
        assert_eq!(ws_base_from_headers(&headers), "ws://localhost:3847");
    }

    #[test]
    fn accepts_valid_names() {
        assert!(validate_project_name("my-project").is_ok());
        assert!(validate_project_name("MyApp_v2").is_ok());
        assert!(validate_project_name("hello world").is_ok());
    }

    #[test]
    fn rejects_empty_name() {
        assert!(validate_project_name("").is_err());
    }

    #[test]
    fn rejects_path_traversal() {
        assert!(validate_project_name("../../etc").is_err());
        assert!(validate_project_name("../secret").is_err());
        assert!(validate_project_name("foo/bar").is_err());
        assert!(validate_project_name("foo\\bar").is_err());
        assert!(validate_project_name("null\0byte").is_err());
    }
}
