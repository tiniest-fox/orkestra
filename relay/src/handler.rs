//! WebSocket connection handler: registration, message routing, and cleanup.
//!
//! Each accepted connection runs `handle_connection()` in its own task. The
//! handler expects the first message to be a `Register` frame (5-second timeout),
//! then enters a bidirectional `select!` loop for the lifetime of the connection.

use std::sync::Arc;
use std::time::{Duration, Instant};

use axum::extract::ws::{Message, WebSocket};
use tokio::sync::mpsc;
use uuid::Uuid;

use crate::connection::{ClientConn, ConnectionState, DaemonConn, PendingRequest};
use crate::types::{RelayMessage, Role};

// ============================================================================
// Constants
// ============================================================================

/// How long to wait for the initial `Register` message before closing.
const REGISTRATION_TIMEOUT: Duration = Duration::from_secs(5);
/// How often the timeout sweep runs.
const TIMEOUT_SWEEP_INTERVAL: Duration = Duration::from_secs(5);
/// Capacity of the per-connection outbound mpsc channel.
const CHANNEL_CAPACITY: usize = 64;

// ============================================================================
// Public Entry Point
// ============================================================================

/// Drive a single WebSocket connection from upgrade through teardown.
pub(crate) async fn handle_connection(socket: WebSocket, state: Arc<ConnectionState>) {
    if let Err(e) = run_connection(socket, state).await {
        tracing::debug!("Connection closed: {e}");
    }
}

// ============================================================================
// Connection Lifecycle
// ============================================================================

async fn run_connection(mut socket: WebSocket, state: Arc<ConnectionState>) -> Result<(), String> {
    // -- Registration phase --
    let register_msg = wait_for_registration(&mut socket).await?;

    match register_msg {
        RelayMessage::Register {
            role: Role::Daemon,
            device_id,
            ..
        } => run_daemon_connection(socket, state, device_id).await,

        RelayMessage::Register {
            role: Role::Client,
            device_id,
            token,
        } => {
            let client_id = Uuid::new_v4().to_string();
            let Some(token) = token else {
                let error = RelayMessage::error(
                    "missing_token",
                    "Client registration requires a bearer token",
                );
                let json = serde_json::to_string(&error).unwrap_or_default();
                let _ = socket.send(Message::Text(json.into())).await;
                return Err("Client registered without bearer token".into());
            };
            run_client_connection(socket, state, device_id, client_id, token).await
        }

        _ => Err("Expected Register as first message".into()),
    }
}

/// Wait up to `REGISTRATION_TIMEOUT` for a `Register` message.
async fn wait_for_registration(socket: &mut WebSocket) -> Result<RelayMessage, String> {
    let deadline = tokio::time::sleep(REGISTRATION_TIMEOUT);
    tokio::pin!(deadline);

    loop {
        tokio::select! {
            msg = socket.recv() => {
                match msg {
                    Some(Ok(Message::Text(text))) => {
                        return serde_json::from_str::<RelayMessage>(&text)
                            .map_err(|e| format!("Bad JSON: {e}"));
                    }
                    Some(Ok(Message::Close(_)) | Err(_)) | None => {
                        return Err("Connection closed before registration".into());
                    }
                    Some(Ok(_)) => {} // ignore binary/ping/pong
                }
            }
            () = &mut deadline => {
                return Err("Registration timeout".into());
            }
        }
    }
}

// ============================================================================
// Daemon Connection
// ============================================================================

async fn run_daemon_connection(
    mut socket: WebSocket,
    state: Arc<ConnectionState>,
    device_id: String,
) -> Result<(), String> {
    let (tx, mut rx) = mpsc::channel::<String>(CHANNEL_CAPACITY);

    // Replace any existing daemon for this device (new connection wins).
    if let Some(old) = state
        .daemons
        .insert(device_id.clone(), DaemonConn { sender: tx })
    {
        // Signal the old connection to close by dropping its sender.
        drop(old);
    }

    tracing::debug!(device_id, "Daemon registered");

    // -- Message loop --
    let result = loop {
        tokio::select! {
            // Incoming from the daemon's socket
            msg = socket.recv() => {
                match msg {
                    Some(Ok(Message::Text(text))) => {
                        if let Err(e) = handle_daemon_message(&text, &device_id, &state) {
                            tracing::warn!(device_id, "Daemon message error: {e}");
                        }
                    }
                    Some(Ok(Message::Close(_)) | Err(_)) | None => break Ok(()),
                    Some(Ok(_)) => {}
                }
            }

            // Outbound from the relay's routing logic
            Some(msg) = rx.recv() => {
                if socket.send(Message::Text(msg.into())).await.is_err() {
                    break Ok(());
                }
            }
        }
    };

    // -- Cleanup --
    state.daemons.remove(&device_id);
    notify_pending_requests_device_offline(&device_id, &state);
    tracing::debug!(device_id, "Daemon disconnected");

    result
}

/// Route a text message received from a daemon.
fn handle_daemon_message(
    text: &str,
    device_id: &str,
    state: &Arc<ConnectionState>,
) -> Result<(), String> {
    let msg: RelayMessage = serde_json::from_str(text).map_err(|e| format!("Bad JSON: {e}"))?;

    match msg {
        RelayMessage::Forward {
            request_id: Some(rid),
            payload,
            ..
        } => {
            // Daemon responding to a client request — match by request_id and route back.
            if let Some((_, pending)) = state.pending_requests.remove(&rid) {
                let response = RelayMessage::Forward {
                    client_id: None,
                    request_id: None,
                    token: None,
                    payload,
                };
                let json = serialize(&response);
                let _ = pending.client_sender.try_send(json);
            }
            // If request_id not found, client already disconnected — silently drop.
        }

        RelayMessage::Event { payload } => {
            // Daemon broadcasting to all clients for this device.
            broadcast_event_to_clients(device_id, payload, state);
        }

        RelayMessage::Forward {
            request_id: None, ..
        } => {
            tracing::warn!(
                device_id,
                "Daemon sent Forward without request_id — ignoring"
            );
        }

        _ => {
            tracing::warn!(device_id, "Unexpected message type from daemon");
        }
    }

    Ok(())
}

// ============================================================================
// Client Connection
// ============================================================================

async fn run_client_connection(
    mut socket: WebSocket,
    state: Arc<ConnectionState>,
    device_id: String,
    client_id: String,
    token: String,
) -> Result<(), String> {
    let (tx, mut rx) = mpsc::channel::<String>(CHANNEL_CAPACITY);

    // Register client for this device.
    state
        .clients
        .entry(device_id.clone())
        .or_default()
        .push(ClientConn {
            client_id: client_id.clone(),
            sender: tx.clone(),
        });

    tracing::debug!(device_id, client_id, "Client registered");

    // -- Message loop --
    let result = loop {
        tokio::select! {
            msg = socket.recv() => {
                match msg {
                    Some(Ok(Message::Text(text))) => {
                        if let Err(e) = handle_client_message(
                            &text, &device_id, &client_id, &token, &tx, &state,
                        ) {
                            tracing::warn!(device_id, client_id, "Client message error: {e}");
                        }
                    }
                    Some(Ok(Message::Close(_)) | Err(_)) | None => break Ok(()),
                    Some(Ok(_)) => {}
                }
            }

            Some(msg) = rx.recv() => {
                if socket.send(Message::Text(msg.into())).await.is_err() {
                    break Ok(());
                }
            }
        }
    };

    // -- Cleanup --
    remove_client(&device_id, &client_id, &state);
    cleanup_pending_requests_for_client(&client_id, &state);
    tracing::debug!(device_id, client_id, "Client disconnected");

    result
}

/// Route a text message received from a client.
fn handle_client_message(
    text: &str,
    device_id: &str,
    client_id: &str,
    token: &str,
    client_tx: &mpsc::Sender<String>,
    state: &Arc<ConnectionState>,
) -> Result<(), String> {
    let msg: RelayMessage = serde_json::from_str(text).map_err(|e| format!("Bad JSON: {e}"))?;

    match msg {
        RelayMessage::Forward { payload, .. } => {
            // Client forwarding a request to the daemon.
            let daemon_entry = state.daemons.get(device_id);
            match daemon_entry {
                Some(daemon) => {
                    let request_id = Uuid::new_v4().to_string();
                    // Insert BEFORE try_send to avoid the race where the daemon
                    // responds before we've recorded the pending request.
                    state.pending_requests.insert(
                        request_id.clone(),
                        PendingRequest {
                            device_id: device_id.to_string(),
                            client_id: client_id.to_string(),
                            created_at: Instant::now(),
                            client_sender: client_tx.clone(),
                        },
                    );
                    let outbound = RelayMessage::Forward {
                        client_id: Some(client_id.to_string()),
                        request_id: Some(request_id.clone()),
                        token: Some(token.to_string()),
                        payload,
                    };
                    let json = serialize(&outbound);
                    if daemon.sender.try_send(json).is_err() {
                        // Daemon channel closed — clean up pending entry and remove stale daemon.
                        state.pending_requests.remove(&request_id);
                        drop(daemon);
                        state.daemons.remove(device_id);
                        send_error(client_tx, "device_offline", "Daemon disconnected");
                    }
                }
                None => {
                    send_error(
                        client_tx,
                        "device_offline",
                        "No daemon registered for device",
                    );
                }
            }
        }

        _ => {
            tracing::warn!(device_id, client_id, "Unexpected message type from client");
        }
    }

    Ok(())
}

// ============================================================================
// Timeout Sweeper
// ============================================================================

/// Periodically scan `pending_requests` and expire those older than `timeout`.
///
/// Runs as a background task for the lifetime of the server.
pub(crate) async fn run_timeout_sweeper(state: Arc<ConnectionState>, timeout: Duration) {
    loop {
        tokio::time::sleep(TIMEOUT_SWEEP_INTERVAL).await;
        expire_timed_out_requests(&state, timeout);
    }
}

fn expire_timed_out_requests(state: &Arc<ConnectionState>, timeout: Duration) {
    let now = Instant::now();
    let expired_ids: Vec<String> = state
        .pending_requests
        .iter()
        .filter(|entry| now.duration_since(entry.value().created_at) >= timeout)
        .map(|entry| entry.key().clone())
        .collect();

    for request_id in expired_ids {
        if let Some((_, pending)) = state.pending_requests.remove(&request_id) {
            tracing::debug!(request_id, "Forward request timed out");
            send_error(
                &pending.client_sender,
                "request_timeout",
                "Daemon did not respond in time",
            );
        }
    }
}

// ============================================================================
// Helpers
// ============================================================================

fn serialize(msg: &RelayMessage) -> String {
    serde_json::to_string(msg).unwrap_or_else(|_| {
        r#"{"type":"error","code":"internal","message":"serialization failed"}"#.into()
    })
}

fn send_error(tx: &mpsc::Sender<String>, code: &str, message: &str) {
    let msg = RelayMessage::error(code, message);
    let json = serialize(&msg);
    let _ = tx.try_send(json);
}

/// Notify all pending requests for a device that the daemon went offline.
fn notify_pending_requests_device_offline(device_id: &str, state: &Arc<ConnectionState>) {
    let affected: Vec<String> = state
        .pending_requests
        .iter()
        .filter(|e| e.value().device_id == device_id)
        .map(|e| e.key().clone())
        .collect();

    for request_id in affected {
        if let Some((_, pending)) = state.pending_requests.remove(&request_id) {
            send_error(
                &pending.client_sender,
                "device_offline",
                "Daemon disconnected",
            );
        }
    }
}

/// Remove a client from the `clients` `DashMap` for its device.
fn remove_client(device_id: &str, client_id: &str, state: &Arc<ConnectionState>) {
    if let Some(mut entry) = state.clients.get_mut(device_id) {
        entry.retain(|c| c.client_id != client_id);
    }
}

/// Clean up any pending requests originated by a disconnecting client.
fn cleanup_pending_requests_for_client(client_id: &str, state: &Arc<ConnectionState>) {
    state
        .pending_requests
        .retain(|_, req| req.client_id != client_id);
}

/// Broadcast an event payload to all registered clients for a device.
fn broadcast_event_to_clients(
    device_id: &str,
    payload: serde_json::Value,
    state: &Arc<ConnectionState>,
) {
    let event = RelayMessage::Event { payload };
    let json = serialize(&event);

    if let Some(mut entry) = state.clients.get_mut(device_id) {
        entry.retain(|client| client.sender.try_send(json.clone()).is_ok());
    }
}
