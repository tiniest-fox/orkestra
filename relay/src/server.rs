//! axum WebSocket server: authentication, rate limiting, and connection dispatch.
//!
//! Single route: `GET /ws?api_key=<key>`. Valid requests are upgraded to
//! WebSocket and handed off to `handler::handle_connection`. Invalid API keys
//! return 401; rate-limited IPs return 429.

use std::net::SocketAddr;
use std::sync::Arc;
use std::time::{Duration, Instant};

use axum::extract::ws::WebSocketUpgrade;
use axum::extract::{ConnectInfo, Query, State};
use axum::http::StatusCode;
use axum::response::IntoResponse;
use axum::routing::get;
use axum::Router;
use governor::clock::DefaultClock;
use governor::state::{InMemoryState, NotKeyed};
use governor::{Quota, RateLimiter};
use subtle::ConstantTimeEq;
use tokio::net::TcpListener;
use tokio::sync::oneshot;

use crate::connection::ConnectionState;
use crate::handler;
use crate::types::{RelayConfig, RelayHandle};

// ============================================================================
// Server State
// ============================================================================

type IpRateLimiter = RateLimiter<NotKeyed, InMemoryState, DefaultClock>;

/// Axum shared state, injected into every handler.
#[derive(Clone)]
struct ServerState {
    api_key: Arc<String>,
    connections: Arc<ConnectionState>,
    /// Per-IP rate limiter with last-used timestamp for eviction.
    rate_limiter: Arc<dashmap::DashMap<String, (Arc<IpRateLimiter>, Instant)>>,
    rate_limit: u32,
}

// ============================================================================
// Query Parameters
// ============================================================================

#[derive(serde::Deserialize)]
struct WsQuery {
    api_key: Option<String>,
}

// ============================================================================
// Public API
// ============================================================================

/// Start the relay server and return a `RelayHandle` for address inspection and shutdown.
///
/// Binds the server, spawns the background timeout sweeper and rate limiter eviction
/// task, and runs the axum serve loop in a separate task. Use the returned handle's
/// `.shutdown()` to stop gracefully.
pub async fn start(config: RelayConfig) -> Result<RelayHandle, std::io::Error> {
    let connections = Arc::new(ConnectionState::new());
    let connections_for_sweeper = Arc::clone(&connections);
    let forward_timeout = Duration::from_secs(config.forward_timeout_secs);

    // Spawn background task that evicts timed-out pending requests.
    tokio::spawn(async move {
        handler::run_timeout_sweeper(connections_for_sweeper, forward_timeout).await;
    });

    let bind_addr = config.bind_addr();
    let rate_limit = config.rate_limit;

    let rate_limiter: Arc<dashmap::DashMap<String, (Arc<IpRateLimiter>, Instant)>> =
        Arc::new(dashmap::DashMap::new());

    // Spawn background task that evicts stale rate limiter entries.
    let rate_limiter_for_eviction = Arc::clone(&rate_limiter);
    tokio::spawn(async move {
        loop {
            tokio::time::sleep(Duration::from_secs(60)).await;
            rate_limiter_for_eviction
                .retain(|_, (_, last_used)| last_used.elapsed() < Duration::from_secs(300));
        }
    });

    let state = ServerState {
        api_key: Arc::new(config.api_key),
        connections,
        rate_limiter,
        rate_limit,
    };

    let router = Router::new()
        .route("/ws", get(ws_handler))
        .with_state(state)
        .into_make_service_with_connect_info::<SocketAddr>();

    let listener = TcpListener::bind(bind_addr).await?;
    let addr = listener.local_addr()?;

    tracing::info!("Relay server listening on {addr}");

    let (shutdown_tx, shutdown_rx) = oneshot::channel::<()>();

    tokio::spawn(async move {
        let server = axum::serve(listener, router).with_graceful_shutdown(async move {
            let _ = shutdown_rx.await;
        });
        if let Err(e) = server.await {
            tracing::error!("Relay server error: {e}");
        }
    });

    Ok(RelayHandle { addr, shutdown_tx })
}

// ============================================================================
// WebSocket Upgrade Handler
// ============================================================================

async fn ws_handler(
    upgrade: WebSocketUpgrade,
    Query(query): Query<WsQuery>,
    ConnectInfo(peer): ConnectInfo<SocketAddr>,
    State(state): State<ServerState>,
) -> impl IntoResponse {
    // -- API key check (constant-time) --
    let Some(provided) = query.api_key else {
        return StatusCode::UNAUTHORIZED.into_response();
    };

    let keys_match: bool = provided.as_bytes().ct_eq(state.api_key.as_bytes()).into();
    if !keys_match {
        return StatusCode::UNAUTHORIZED.into_response();
    }

    // -- Rate limit per connecting IP --
    let ip_key = peer.ip().to_string();
    let mut entry = state.rate_limiter.entry(ip_key).or_insert_with(|| {
        let quota = Quota::per_minute(
            std::num::NonZeroU32::new(state.rate_limit)
                .unwrap_or(std::num::NonZeroU32::new(30).expect("30 is nonzero")),
        );
        (Arc::new(RateLimiter::direct(quota)), Instant::now())
    });
    entry.1 = Instant::now(); // update last-used time for eviction tracking
    let limiter = entry.0.clone();
    drop(entry);

    if limiter.check().is_err() {
        return StatusCode::TOO_MANY_REQUESTS.into_response();
    }

    // -- Upgrade --
    let connections = Arc::clone(&state.connections);
    upgrade
        .on_upgrade(move |socket| handler::handle_connection(socket, connections))
        .into_response()
}
