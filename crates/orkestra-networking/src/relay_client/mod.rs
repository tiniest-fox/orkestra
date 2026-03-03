//! Outbound relay client that connects to a relay server and forwards traffic.
//!
//! The relay client maintains a persistent WebSocket connection to an external
//! relay server, registers as a daemon, dispatches incoming requests through
//! the existing command routing, and forwards orchestrator events outward.
//! Reconnects automatically with exponential backoff after disconnects.

use std::sync::Arc;
use std::time::Duration;

use futures_util::SinkExt;
use tokio::net::TcpStream;
use tokio::sync::broadcast;
use tokio_tungstenite::tungstenite::Message;
use tokio_tungstenite::{MaybeTlsStream, WebSocketStream};
use tokio_util::sync::CancellationToken;

use crate::interactions::command::dispatch::CommandContext;
use crate::types::Event;

mod forwarder;

use orkestra_relay_protocol::{RelayMessage, Role};

// ============================================================================
// Public API
// ============================================================================

/// Configuration for the relay client.
pub struct RelayClientConfig {
    /// Base URL of the relay server (e.g. `wss://relay.example.com`).
    pub relay_url: String,
    /// API key for relay server authentication.
    pub api_key: String,
    /// Persistent device identifier for this daemon.
    pub device_id: String,
}

/// Error returned by `connect` when the relay client cannot start.
#[derive(Debug)]
pub enum RelayClientError {
    /// An unexpected internal error occurred.
    Internal(String),
}

impl std::fmt::Display for RelayClientError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            RelayClientError::Internal(msg) => write!(f, "relay client error: {msg}"),
        }
    }
}

/// Connect to the relay server and forward traffic until `stop` is cancelled.
///
/// Runs a reconnection loop: on any disconnect (excluding intentional shutdown)
/// the client waits with exponential backoff (1s → 2s → 4s → … → 30s cap)
/// before retrying. A successful connection resets the backoff to 1s.
pub async fn connect(
    config: RelayClientConfig,
    ctx: Arc<CommandContext>,
    event_tx: broadcast::Sender<Event>,
    stop: CancellationToken,
) -> Result<(), RelayClientError> {
    let mut backoff_secs = 1u64;

    loop {
        if stop.is_cancelled() {
            return Ok(());
        }

        let ws_url = format!("{}/ws?api_key={}", config.relay_url, config.api_key);
        tracing::info!("Relay: connecting to {}", config.relay_url);

        match tokio_tungstenite::connect_async(&ws_url).await {
            Ok((ws_stream, _)) => {
                tracing::info!(
                    "Relay: connected, registering as daemon ({})",
                    config.device_id
                );

                // On successful connection, reset backoff.
                backoff_secs = 1;

                match register_and_run(
                    ws_stream,
                    &config.device_id,
                    Arc::clone(&ctx),
                    event_tx.clone(),
                    stop.clone(),
                )
                .await
                {
                    RunOutcome::StopRequested => return Ok(()),
                    RunOutcome::Disconnected => {
                        tracing::info!("Relay: disconnected — will reconnect");
                    }
                }
            }
            Err(e) => {
                tracing::warn!("Relay: connection failed: {e}");
            }
        }

        if stop.is_cancelled() {
            return Ok(());
        }

        tracing::info!("Relay: retrying in {backoff_secs}s");
        tokio::select! {
            () = tokio::time::sleep(Duration::from_secs(backoff_secs)) => {}
            () = stop.cancelled() => return Ok(()),
        }

        backoff_secs = (backoff_secs * 2).min(30);
    }
}

// ============================================================================
// Internal
// ============================================================================

/// Result of one relay session.
enum RunOutcome {
    /// Stop token was cancelled — caller should exit cleanly.
    StopRequested,
    /// Connection closed for any other reason — caller should reconnect.
    Disconnected,
}

/// Send the Register message and then drive the forwarding loop.
async fn register_and_run(
    mut ws: WebSocketStream<MaybeTlsStream<TcpStream>>,
    device_id: &str,
    ctx: Arc<CommandContext>,
    event_tx: broadcast::Sender<Event>,
    stop: CancellationToken,
) -> RunOutcome {
    let register_msg = RelayMessage::Register {
        device_id: device_id.to_string(),
        role: Role::Daemon,
        token: None,
    };

    let text = match serde_json::to_string(&register_msg) {
        Ok(t) => t,
        Err(e) => {
            tracing::error!("Relay: failed to serialize Register: {e}");
            return RunOutcome::Disconnected;
        }
    };

    if ws.send(Message::Text(text.into())).await.is_err() {
        return RunOutcome::Disconnected;
    }

    forwarder::run(ws, ctx, event_tx, stop.clone()).await;

    if stop.is_cancelled() {
        RunOutcome::StopRequested
    } else {
        RunOutcome::Disconnected
    }
}
