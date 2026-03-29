//! axum-based WebSocket server.
//!
//! Each connection gets a dedicated task that multiplexes incoming client
//! requests with outgoing broadcast events. A lagged broadcast receiver
//! triggers a `state_reset` event with the full task list.
//!
//! Authentication is required for WebSocket connections. Clients must provide
//! a bearer token via the `Authorization` header or `?token=` query param.
//! A separate `POST /pair` endpoint is available without authentication to
//! exchange a pairing code for a bearer token.

use std::collections::HashMap;
use std::sync::Arc;
use std::time::Duration;

use axum::body::Body;
use axum::extract::ws::{Message, WebSocket, WebSocketUpgrade};
use axum::extract::{Query, State};
use axum::http::{HeaderMap, HeaderValue, StatusCode};
use axum::middleware::Next;
use axum::response::{Html, IntoResponse, Response};
use axum::routing::{get, post};
use axum::{Json, Router};
use base64::engine::general_purpose::STANDARD as BASE64_STANDARD;
use base64::Engine as _;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use subtle::ConstantTimeEq;
use tokio::sync::broadcast;
use tokio::time::{interval_at, Instant};
use tower_http::cors::CorsLayer;

use crate::interactions::auth::{generate_pairing_code, pair_device, verify_token};
use crate::interactions::command::dispatch::{self, CommandContext};
use crate::types::{AuthError, ErrorResponse, Event, Request, Response as WsResponse};

// ============================================================================
// Server State
// ============================================================================

/// Shared server state injected into each axum handler.
#[derive(Clone)]
struct ServerState {
    ctx: Arc<CommandContext>,
    event_tx: broadcast::Sender<Event>,
    /// Static development token. If set, connections using this token bypass DB auth.
    static_token: Option<String>,
}

// ============================================================================
// Public API
// ============================================================================

/// Start the WebSocket server using a pre-bound `listener`.
///
/// Requires a bearer token on the WebSocket upgrade path. The `static_token`
/// parameter enables a fixed development token that bypasses device pairing.
/// Pass `None` in production to require the full pairing flow.
///
/// `allowed_origin` controls CORS: `None` allows any origin (dev mode);
/// `Some(origin)` restricts to exactly that origin (e.g. `https://app.orkestra.dev`).
/// The caller is responsible for validating the origin value before passing it here.
///
/// The caller is responsible for binding the listener — this eliminates the
/// TOCTOU race that occurs when binding an ephemeral port and passing the
/// address separately.
///
/// This is an async future — `await` it to run the server until it stops.
pub async fn start(
    ctx: Arc<CommandContext>,
    event_tx: broadcast::Sender<Event>,
    static_token: Option<String>,
    listener: tokio::net::TcpListener,
    allowed_origin: Option<HeaderValue>,
) -> Result<(), std::io::Error> {
    let local_addr = listener.local_addr()?;

    let state = ServerState {
        ctx,
        event_tx,
        static_token,
    };

    let cors = match allowed_origin {
        None => CorsLayer::permissive(),
        Some(origin) => CorsLayer::new()
            .allow_origin(origin)
            .allow_methods(tower_http::cors::Any)
            .allow_headers(tower_http::cors::Any)
            .expose_headers(tower_http::cors::Any),
    };

    let bootstrap_routes = Router::new()
        .route("/", get(bootstrap_page))
        .route("/pairing-code", post(generate_code))
        .layer(axum::middleware::from_fn_with_state(
            state.clone(),
            require_basic_auth,
        ));

    let router = Router::new()
        .route("/ws", get(ws_handler))
        .route("/pair", post(pair_handler))
        .merge(bootstrap_routes)
        .layer(cors)
        .with_state(state);

    tracing::info!("WebSocket server listening on {local_addr}");

    axum::serve(listener, router).await
}

// ============================================================================
// WebSocket Upgrade
// ============================================================================

/// HTTP handler that upgrades the connection to WebSocket after checking auth.
async fn ws_handler(
    upgrade: WebSocketUpgrade,
    headers: HeaderMap,
    Query(query): Query<HashMap<String, String>>,
    State(state): State<ServerState>,
) -> Response {
    let token = extract_bearer_token(&headers).or_else(|| query.get("token").cloned());

    match token {
        Some(t) if is_authenticated(&state, &t).await => upgrade
            .on_upgrade(move |socket| handle_connection(socket, state))
            .into_response(),
        _ => StatusCode::UNAUTHORIZED.into_response(),
    }
}

// ============================================================================
// Pairing Endpoint
// ============================================================================

/// Request body for `POST /pair`.
#[derive(Debug, Deserialize)]
struct PairRequest {
    code: String,
    device_name: String,
}

/// Response body for `POST /pair`.
#[derive(Debug, Serialize)]
struct PairResponse {
    token: String,
}

/// `POST /pair` — exchange a pairing code for a bearer token.
///
/// This endpoint is intentionally unauthenticated: it's how clients obtain
/// their first token. The pairing code is generated by the daemon and must
/// be entered within 5 minutes.
async fn pair_handler(
    State(state): State<ServerState>,
    Json(body): Json<PairRequest>,
) -> Response<Body> {
    let conn = Arc::clone(&state.ctx.conn);
    let code = body.code;
    let device_name = body.device_name;

    let result =
        tokio::task::spawn_blocking(move || pair_device::execute(&conn, &code, &device_name)).await;

    match result {
        Ok(Ok(token)) => Json(PairResponse { token }).into_response(),
        Ok(Err(AuthError::InvalidCode)) => {
            let body =
                serde_json::json!({"error": "Invalid, expired, or already claimed pairing code"});
            (StatusCode::BAD_REQUEST, Json(body)).into_response()
        }
        Ok(Err(e)) => {
            let body = serde_json::json!({"error": e.to_string()});
            (StatusCode::INTERNAL_SERVER_ERROR, Json(body)).into_response()
        }
        Err(e) => {
            let body = serde_json::json!({"error": e.to_string()});
            (StatusCode::INTERNAL_SERVER_ERROR, Json(body)).into_response()
        }
    }
}

// ============================================================================
// Bootstrap Page
// ============================================================================

/// HTTP Basic Auth middleware — validates password against `ORKD_TOKEN`.
///
/// Returns 503 if no static token is configured, 401 with `WWW-Authenticate`
/// header if credentials are missing or wrong, or passes the request through.
async fn require_basic_auth(
    State(state): State<ServerState>,
    request: axum::extract::Request,
    next: Next,
) -> Response {
    let Some(expected) = &state.static_token else {
        return StatusCode::SERVICE_UNAVAILABLE.into_response();
    };

    let password = extract_basic_auth_password(request.headers());
    let authorized = password.as_deref().is_some_and(|p| {
        let input_hash = Sha256::digest(p.as_bytes());
        let expected_hash = Sha256::digest(expected.as_bytes());
        input_hash.ct_eq(&expected_hash).into()
    });

    if !authorized {
        return (
            StatusCode::UNAUTHORIZED,
            [(
                axum::http::header::WWW_AUTHENTICATE,
                r#"Basic realm="orkd""#,
            )],
        )
            .into_response();
    }

    next.run(request).await
}

/// `GET /` — serve the bootstrap HTML page.
///
/// Reads the `Host` header and `X-Forwarded-Proto` to construct the WebSocket
/// URL displayed on the page. Defaults to `ws://` (plain, as the daemon serves),
/// but upgrades to `wss://` when a reverse proxy signals HTTPS via the forwarded
/// proto header.
async fn bootstrap_page(headers: HeaderMap) -> Html<String> {
    let host = headers
        .get("Host")
        .and_then(|v| v.to_str().ok())
        .unwrap_or("localhost");
    let scheme = headers
        .get("X-Forwarded-Proto")
        .and_then(|v| v.to_str().ok())
        .map_or("ws", |p| if p == "https" { "wss" } else { "ws" });
    let ws_url = format!("{scheme}://{host}/ws");

    let html = include_str!("bootstrap.html").replace("{ws_url}", &ws_url);
    Html(html)
}

/// Response body for `POST /pairing-code`.
#[derive(Debug, Serialize)]
struct PairingCodeResponse {
    code: String,
}

/// `POST /pairing-code` — generate a pairing code and return it as JSON.
///
/// Protected by `require_basic_auth` middleware.
async fn generate_code(State(state): State<ServerState>) -> Response<Body> {
    let conn = Arc::clone(&state.ctx.conn);
    let result = tokio::task::spawn_blocking(move || generate_pairing_code::execute(&conn)).await;

    match result {
        Ok(Ok(code)) => Json(PairingCodeResponse { code }).into_response(),
        Ok(Err(e)) => {
            let body = serde_json::json!({"error": e.to_string()});
            (StatusCode::INTERNAL_SERVER_ERROR, Json(body)).into_response()
        }
        Err(e) => {
            let body = serde_json::json!({"error": e.to_string()});
            (StatusCode::INTERNAL_SERVER_ERROR, Json(body)).into_response()
        }
    }
}

// ============================================================================
// Connection Handler
// ============================================================================

/// Drive a single WebSocket connection.
///
/// Runs a `select!` loop that handles:
/// - Client messages → dispatch → send response
/// - Broadcast events → serialize → send to client
/// - Lagged broadcast → send `state_reset` with full task snapshot
async fn handle_connection(mut socket: WebSocket, state: ServerState) {
    let mut event_rx = state.event_tx.subscribe();

    // Send initial state snapshot so the client has coherent state immediately,
    // even if it missed events while disconnected.
    if let Some(reset_event) =
        crate::interactions::event::build_state_reset::execute(&state.ctx).await
    {
        let serialized = serde_json::to_string(&reset_event)
            .unwrap_or_else(|_| r#"{"event":"state_reset","data":{}}"#.into());
        if socket.send(Message::Text(serialized.into())).await.is_err() {
            return;
        }
    }

    let mut ping_interval = interval_at(
        Instant::now() + Duration::from_secs(30),
        Duration::from_secs(30),
    );

    loop {
        tokio::select! {
            // Incoming client message
            msg = socket.recv() => {
                match msg {
                    Some(Ok(Message::Text(text))) => {
                        let response = handle_text_message(
                            &text,
                            Arc::clone(&state.ctx),
                            state.event_tx.clone(),
                        )
                        .await;
                        let serialized = serde_json::to_string(&response)
                            .unwrap_or_else(|_| r#"{"error":"serialization failed"}"#.into());
                        if socket.send(Message::Text(serialized.into())).await.is_err() {
                            break;
                        }
                    }
                    Some(Ok(Message::Close(_)) | Err(_)) | None => break,
                    Some(Ok(_)) => {} // ignore binary / ping / pong
                }
            }

            // Outgoing broadcast event
            broadcast_result = event_rx.recv() => {
                match broadcast_result {
                    Ok(event) => {
                        let serialized = serde_json::to_string(&event)
                            .unwrap_or_else(|_| r#"{"event":"error","data":{}}"#.into());
                        if socket.send(Message::Text(serialized.into())).await.is_err() {
                            break;
                        }
                    }
                    Err(broadcast::error::RecvError::Lagged(_)) => {
                        // Client missed messages — send a full state reset.
                        if let Some(reset_event) = crate::interactions::event::build_state_reset::execute(&state.ctx).await {
                            let serialized = serde_json::to_string(&reset_event)
                                .unwrap_or_else(|_| r#"{"event":"state_reset","data":{}}"#.into());
                            if socket.send(Message::Text(serialized.into())).await.is_err() {
                                break;
                            }
                        }
                    }
                    Err(broadcast::error::RecvError::Closed) => break,
                }
            }

            // Keepalive ping
            _ = ping_interval.tick() => {
                if socket.send(Message::Ping(vec![].into())).await.is_err() {
                    break;
                }
            }
        }
    }
}

// ============================================================================
// Helpers
// ============================================================================

/// Check whether a token is valid for this server.
///
/// Accepts either the static development token (constant-time comparison) or
/// a token verified against the `device_tokens` table via `spawn_blocking`.
async fn is_authenticated(state: &ServerState, token: &str) -> bool {
    // Constant-time comparison for static token to prevent timing attacks.
    // Hash both sides so the comparison always operates on equal-length slices,
    // eliminating the length leak in subtle's slice ct_eq.
    if let Some(static_token) = &state.static_token {
        let input_hash = Sha256::digest(token.as_bytes());
        let expected_hash = Sha256::digest(static_token.as_bytes());
        if input_hash.ct_eq(&expected_hash).into() {
            return true;
        }
    }

    let conn = Arc::clone(&state.ctx.conn);
    let token = token.to_string();
    match tokio::task::spawn_blocking(move || verify_token::execute(&conn, &token)).await {
        Ok(Ok(_)) => true,
        Ok(Err(e)) => {
            tracing::warn!("Token verification failed: {e}");
            false
        }
        Err(e) => {
            tracing::error!("Token verification panicked: {e}");
            false
        }
    }
}

/// Extract the bearer token from an `Authorization: Bearer <token>` header.
fn extract_bearer_token(headers: &HeaderMap) -> Option<String> {
    let auth = headers.get("Authorization")?.to_str().ok()?;
    auth.strip_prefix("Bearer ").map(|t| t.trim().to_string())
}

/// Extract the password from an `Authorization: Basic <base64>` header.
///
/// Accepts any username — only the password is validated against `ORKD_TOKEN`.
fn extract_basic_auth_password(headers: &HeaderMap) -> Option<String> {
    let auth = headers.get("Authorization")?.to_str().ok()?;
    let encoded = auth.strip_prefix("Basic ")?;
    let decoded = BASE64_STANDARD.decode(encoded).ok()?;
    let s = String::from_utf8(decoded).ok()?;
    // Split at the first `:` — the password may itself contain colons.
    let (_, password) = s.split_once(':')?;
    Some(password.to_string())
}

/// Parse a text message and dispatch it to the appropriate handler.
///
/// Returns a JSON-serializable envelope (either a `WsResponse` or `ErrorResponse`).
async fn handle_text_message(
    text: &str,
    ctx: Arc<CommandContext>,
    event_tx: broadcast::Sender<Event>,
) -> serde_json::Value {
    let request: Request = match serde_json::from_str(text) {
        Ok(r) => r,
        Err(e) => {
            return serde_json::to_value(ErrorResponse {
                id: String::new(),
                error: crate::types::ErrorPayload::invalid_params(e.to_string()),
            })
            .unwrap_or(serde_json::Value::Null);
        }
    };

    let id = request.id.clone();

    match dispatch::execute(&request.method, ctx, event_tx, request.params).await {
        Ok(result) => {
            serde_json::to_value(WsResponse { id, result }).unwrap_or(serde_json::Value::Null)
        }
        Err(error) => {
            serde_json::to_value(ErrorResponse { id, error }).unwrap_or(serde_json::Value::Null)
        }
    }
}

// ============================================================================
// Tests
// ============================================================================

#[cfg(test)]
mod tests {
    use super::*;

    /// `extract_basic_auth_password` splits on the first colon, so a password
    /// that itself contains colons is returned intact.
    #[test]
    fn extract_basic_auth_password_preserves_colons_in_password() {
        let mut headers = HeaderMap::new();
        let encoded = BASE64_STANDARD.encode(b"user:tok:en");
        headers.insert(
            axum::http::header::AUTHORIZATION,
            format!("Basic {encoded}").parse().unwrap(),
        );
        let password = extract_basic_auth_password(&headers);
        assert_eq!(password.as_deref(), Some("tok:en"));
    }
}
