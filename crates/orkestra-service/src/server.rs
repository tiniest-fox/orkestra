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
use axum::response::{Html, IntoResponse, Response};
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
// Static Assets
// ============================================================================

const MANAGEMENT_HTML: &str = include_str!("management.html");

async fn management_page() -> Html<&'static str> {
    Html(MANAGEMENT_HTML)
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
        .route("/api/github/repos", get(github_repos_handler))
        .route("/api/github/status", get(github_status_handler))
        .route("/api/pairing-code", post(generate_pairing_code_handler))
        .layer(axum::middleware::from_fn_with_state(
            state.clone(),
            require_bearer_auth,
        ));

    let mut router = Router::new()
        .route("/", get(management_page))
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
    let token = match extract_bearer_token(request.headers()) {
        Some(t) => t,
        None => {
            return (
                StatusCode::UNAUTHORIZED,
                Json(serde_json::json!({"error": "Missing Authorization header"})),
            )
                .into_response();
        }
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
}

impl ProjectResponse {
    fn from_project(
        proj: &crate::types::Project,
        token: Option<String>,
        token_error: Option<String>,
        ws_base: &str,
    ) -> Self {
        Self {
            id: proj.id.clone(),
            name: proj.name.clone(),
            path: proj.path.clone(),
            ws_url: format!("{ws_base}/projects/{}/ws", proj.id),
            token,
            token_error,
            status: proj.status.clone(),
            error_message: proj.error_message.clone(),
        }
    }
}

/// `GET /api/projects` — list all projects, injecting daemon tokens for running ones.
async fn list_projects_handler(
    State(state): State<OrkServiceState>,
    request: Request,
) -> Response<Body> {
    let device = match request.extensions().get::<AuthenticatedDevice>().cloned() {
        Some(d) => d,
        None => {
            return (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(serde_json::json!({"error": "Internal authentication error"})),
            )
                .into_response();
        }
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
    let mut responses: Vec<ProjectResponse> = Vec::with_capacity(projects.len());

    for proj in projects {
        let (token, token_error) = if proj.status == ProjectStatus::Running {
            let lock = state.pairing_lock_for(&proj.id);
            match daemon_token::get_or_create::execute(&state.conn, &device.id, &proj, lock).await {
                Ok(t) => (Some(t), None),
                Err(e) => {
                    tracing::warn!("Failed to get daemon token for {}: {e}", proj.id);
                    (None, Some(e.to_string()))
                }
            }
        } else {
            (None, None)
        };

        responses.push(ProjectResponse::from_project(&proj, token, token_error, &ws_base));
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

    Json(ProjectResponse::from_project(&proj, None, None, &ws_base)).into_response()
}

/// `DELETE /api/projects/{id}` — stop daemon and remove project.
async fn remove_project_handler(
    State(state): State<OrkServiceState>,
    Path(id): Path<String>,
) -> Response<Body> {
    // Fetch project to verify it exists.
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
        Ok(Ok(_)) => {}
    }

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
    ws.on_upgrade(move |socket| proxy_ws(socket, daemon_port, token))
}

/// Bridge a client WebSocket to a daemon WebSocket on `127.0.0.1:{daemon_port}`.
async fn proxy_ws(mut client: WebSocket, daemon_port: u16, token: String) {
    use tokio_tungstenite::tungstenite::Message as TMsg;

    let url = format!("ws://127.0.0.1:{daemon_port}/ws?token={token}");
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
/// Uses `X-Forwarded-Proto` to detect HTTPS (set by Cloudflare and other reverse
/// proxies). Falls back to `ws` for plain local connections.
fn ws_base_from_headers(headers: &HeaderMap) -> String {
    let host = headers
        .get("host")
        .and_then(|v| v.to_str().ok())
        .unwrap_or("localhost:3847");

    let proto = headers
        .get("x-forwarded-proto")
        .and_then(|v| v.to_str().ok())
        .unwrap_or("http");

    let ws_scheme = if proto == "https" { "wss" } else { "ws" };
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
    use super::validate_project_name;

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
