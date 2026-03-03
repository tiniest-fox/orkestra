//! Integration tests for the relay server.
//!
//! Each test spins up a relay server on port 0 (OS-assigned), connects
//! tokio-tungstenite WebSocket clients, and verifies routing behaviour.

use std::time::Duration;

use futures_util::{SinkExt, StreamExt};
use serde_json::{json, Value};
use tokio_tungstenite::{connect_async, tungstenite::Message};

use orkestra_relay::server;
use orkestra_relay::types::RelayConfig;

// ============================================================================
// Helpers
// ============================================================================

const API_KEY: &str = "test-api-key";

async fn start_relay() -> orkestra_relay::types::RelayHandle {
    let config = RelayConfig {
        bind: "127.0.0.1".parse().unwrap(),
        port: 0,
        api_key: API_KEY.to_string(),
        rate_limit: 1000, // high limit to avoid interference in tests
        forward_timeout_secs: 30,
    };
    server::start(config).await.expect("Failed to start relay")
}

type WsStream =
    tokio_tungstenite::WebSocketStream<tokio_tungstenite::MaybeTlsStream<tokio::net::TcpStream>>;

/// Connect a WebSocket client with the given API key.
async fn connect(addr: std::net::SocketAddr, api_key: &str) -> WsStream {
    let url = format!("ws://{addr}/ws?api_key={api_key}");
    let (ws, _) = connect_async(&url).await.expect("WebSocket connect failed");
    ws
}

/// Send a JSON value as a text message.
async fn send(ws: &mut WsStream, msg: Value) {
    ws.send(Message::Text(msg.to_string().into()))
        .await
        .expect("Send failed");
}

/// Receive the next text message and parse it as JSON.
async fn recv(ws: &mut WsStream) -> Value {
    tokio::time::timeout(Duration::from_secs(5), ws.next())
        .await
        .expect("Receive timed out")
        .expect("Stream ended")
        .expect("WebSocket error")
        .into_text()
        .map(|t| serde_json::from_str(&t).expect("Invalid JSON"))
        .expect("Not a text message")
}

// ============================================================================
// Test: Registration
// ============================================================================

#[tokio::test]
async fn test_daemon_and_client_register() {
    let handle = start_relay().await;
    let addr = handle.addr();

    let mut daemon = connect(addr, API_KEY).await;
    let mut client = connect(addr, API_KEY).await;

    send(
        &mut daemon,
        json!({"type": "register", "device_id": "dev1", "role": "daemon"}),
    )
    .await;

    send(
        &mut client,
        json!({"type": "register", "device_id": "dev1", "role": "client", "token": "tok"}),
    )
    .await;

    // Client sends a forward — should reach daemon with client_id, request_id, and token.
    send(
        &mut client,
        json!({"type": "forward", "payload": {"cmd": "ping"}}),
    )
    .await;

    let daemon_msg = recv(&mut daemon).await;
    assert_eq!(daemon_msg["type"], "forward");
    assert_eq!(daemon_msg["payload"]["cmd"], "ping");
    assert!(daemon_msg["client_id"].is_string(), "client_id must be set");
    assert!(
        daemon_msg["request_id"].is_string(),
        "request_id must be set"
    );
    assert_eq!(daemon_msg["token"], "tok");

    handle.shutdown();
}

// ============================================================================
// Test: Happy Path Forwarding
// ============================================================================

#[tokio::test]
async fn test_happy_path_forward_response() {
    let handle = start_relay().await;
    let addr = handle.addr();

    let mut daemon = connect(addr, API_KEY).await;
    let mut client = connect(addr, API_KEY).await;

    send(
        &mut daemon,
        json!({"type": "register", "device_id": "dev2", "role": "daemon"}),
    )
    .await;
    send(
        &mut client,
        json!({"type": "register", "device_id": "dev2", "role": "client", "token": "t"}),
    )
    .await;

    // Client sends request
    send(
        &mut client,
        json!({"type": "forward", "payload": {"req": 1}}),
    )
    .await;

    // Daemon receives it with client_id and request_id
    let daemon_msg = recv(&mut daemon).await;
    let request_id = daemon_msg["request_id"].as_str().unwrap().to_string();

    // Daemon responds using request_id
    send(
        &mut daemon,
        json!({"type": "forward", "request_id": request_id, "payload": {"resp": 42}}),
    )
    .await;

    // Client receives the response (routing metadata stripped)
    let client_msg = recv(&mut client).await;
    assert_eq!(client_msg["type"], "forward");
    assert_eq!(client_msg["payload"]["resp"], 42);
    assert!(
        client_msg["request_id"].is_null(),
        "request_id should be stripped from client response"
    );

    handle.shutdown();
}

// ============================================================================
// Test: Device Offline
// ============================================================================

#[tokio::test]
async fn test_device_offline_no_daemon() {
    let handle = start_relay().await;
    let addr = handle.addr();

    let mut client = connect(addr, API_KEY).await;

    send(
        &mut client,
        json!({"type": "register", "device_id": "nodev", "role": "client", "token": "t"}),
    )
    .await;

    send(
        &mut client,
        json!({"type": "forward", "payload": {"cmd": "anything"}}),
    )
    .await;

    let msg = recv(&mut client).await;
    assert_eq!(msg["type"], "error");
    assert_eq!(msg["code"], "device_offline");

    handle.shutdown();
}

// ============================================================================
// Test: API Key Rejection
// ============================================================================

#[tokio::test]
async fn test_invalid_api_key_rejected() {
    let handle = start_relay().await;
    let addr = handle.addr();

    let url = format!("ws://{addr}/ws?api_key=wrong-key");
    let result = connect_async(&url).await;

    // The server should close the connection with a 401 HTTP status.
    assert!(
        result.is_err(),
        "Connection with wrong API key should be rejected"
    );

    handle.shutdown();
}

// ============================================================================
// Test: Rate Limiting
// ============================================================================

#[tokio::test]
async fn test_rate_limiting() {
    let config = RelayConfig {
        bind: "127.0.0.1".parse().unwrap(),
        port: 0,
        api_key: API_KEY.to_string(),
        rate_limit: 2, // very low limit
        forward_timeout_secs: 30,
    };
    let handle = server::start(config).await.expect("start relay");
    let addr = handle.addr();

    // Connect up to the limit.
    let _ws1 = connect(addr, API_KEY).await;
    let _ws2 = connect(addr, API_KEY).await;

    // The next connection should be rate-limited.
    let url = format!("ws://{addr}/ws?api_key={API_KEY}");
    let result = connect_async(&url).await;
    assert!(
        result.is_err(),
        "Third connection should be rate-limited (429)"
    );

    handle.shutdown();
}

// ============================================================================
// Test: Daemon Disconnect Cleanup
// ============================================================================

#[tokio::test]
async fn test_daemon_disconnect_sends_device_offline_to_pending_clients() {
    let handle = start_relay().await;
    let addr = handle.addr();

    let mut daemon = connect(addr, API_KEY).await;
    let mut client = connect(addr, API_KEY).await;

    send(
        &mut daemon,
        json!({"type": "register", "device_id": "dev3", "role": "daemon"}),
    )
    .await;
    send(
        &mut client,
        json!({"type": "register", "device_id": "dev3", "role": "client", "token": "t"}),
    )
    .await;

    // Client sends a forward — daemon receives but doesn't respond.
    send(&mut client, json!({"type": "forward", "payload": {}})).await;
    let _daemon_msg = recv(&mut daemon).await; // consume it

    // Daemon disconnects without responding.
    daemon.close(None).await.expect("close daemon");
    drop(daemon);

    // Client should receive a device_offline error.
    let msg = recv(&mut client).await;
    assert_eq!(msg["type"], "error");
    assert_eq!(msg["code"], "device_offline");

    handle.shutdown();
}

// ============================================================================
// Test: Multi-Client Events
// ============================================================================

#[tokio::test]
async fn test_multi_client_event_broadcast() {
    let handle = start_relay().await;
    let addr = handle.addr();

    let mut daemon = connect(addr, API_KEY).await;
    let mut client_a = connect(addr, API_KEY).await;
    let mut client_b = connect(addr, API_KEY).await;

    send(
        &mut daemon,
        json!({"type": "register", "device_id": "dev4", "role": "daemon"}),
    )
    .await;
    send(
        &mut client_a,
        json!({"type": "register", "device_id": "dev4", "role": "client", "token": "ta"}),
    )
    .await;
    send(
        &mut client_b,
        json!({"type": "register", "device_id": "dev4", "role": "client", "token": "tb"}),
    )
    .await;

    // Small delay to ensure registrations are processed.
    tokio::time::sleep(Duration::from_millis(50)).await;

    // Daemon broadcasts an event.
    send(
        &mut daemon,
        json!({"type": "event", "payload": {"update": true}}),
    )
    .await;

    // Both clients should receive it.
    let msg_a = recv(&mut client_a).await;
    let msg_b = recv(&mut client_b).await;

    assert_eq!(msg_a["type"], "event");
    assert_eq!(msg_a["payload"]["update"], true);
    assert_eq!(msg_b["type"], "event");
    assert_eq!(msg_b["payload"]["update"], true);

    // Each client's response goes only to the requesting client.
    send(
        &mut client_a,
        json!({"type": "forward", "payload": {"from": "a"}}),
    )
    .await;
    let daemon_msg = recv(&mut daemon).await;
    let request_id_a = daemon_msg["request_id"].as_str().unwrap().to_string();

    send(
        &mut daemon,
        json!({"type": "forward", "request_id": request_id_a, "payload": {"ans": "for_a"}}),
    )
    .await;

    let resp_a = recv(&mut client_a).await;
    assert_eq!(resp_a["payload"]["ans"], "for_a");

    handle.shutdown();
}

// ============================================================================
// Test: Request Timeout
// ============================================================================

#[tokio::test]
async fn test_request_timeout() {
    // Use a 1-second forward timeout so the test doesn't take 30 seconds.
    let config = RelayConfig {
        bind: "127.0.0.1".parse().unwrap(),
        port: 0,
        api_key: API_KEY.to_string(),
        rate_limit: 1000,
        forward_timeout_secs: 1,
    };
    let handle = server::start(config).await.expect("start relay");
    let addr = handle.addr();

    let mut daemon = connect(addr, API_KEY).await;
    let mut client = connect(addr, API_KEY).await;

    send(
        &mut daemon,
        json!({"type": "register", "device_id": "dev5", "role": "daemon"}),
    )
    .await;
    send(
        &mut client,
        json!({"type": "register", "device_id": "dev5", "role": "client", "token": "t"}),
    )
    .await;

    // Client sends a forward — daemon acknowledges but never responds.
    send(&mut client, json!({"type": "forward", "payload": {}})).await;
    let _daemon_msg = recv(&mut daemon).await; // consume the forwarded message

    // Wait for the sweeper to fire (sweeps every 5 s, times out after 1 s).
    // We need to wait at least 1s (timeout) + up to 5s (sweep interval).
    let msg = tokio::time::timeout(Duration::from_secs(10), recv(&mut client))
        .await
        .expect("Client should receive request_timeout within 10s");

    assert_eq!(msg["type"], "error");
    assert_eq!(msg["code"], "request_timeout");

    handle.shutdown();
}

// ============================================================================
// Test: Concurrent Requests from Same Client
// ============================================================================

#[tokio::test]
async fn test_concurrent_requests_same_client() {
    let handle = start_relay().await;
    let addr = handle.addr();

    let mut daemon = connect(addr, API_KEY).await;
    let mut client = connect(addr, API_KEY).await;

    send(
        &mut daemon,
        json!({"type": "register", "device_id": "dev6", "role": "daemon"}),
    )
    .await;
    send(
        &mut client,
        json!({"type": "register", "device_id": "dev6", "role": "client", "token": "t"}),
    )
    .await;

    // Send two forward requests before daemon responds to either.
    send(
        &mut client,
        json!({"type": "forward", "payload": {"seq": 1}}),
    )
    .await;
    send(
        &mut client,
        json!({"type": "forward", "payload": {"seq": 2}}),
    )
    .await;

    // Daemon receives both, each with a distinct request_id.
    let dmsg1 = recv(&mut daemon).await;
    let dmsg2 = recv(&mut daemon).await;

    let rid1 = dmsg1["request_id"]
        .as_str()
        .expect("request_id 1 missing")
        .to_string();
    let rid2 = dmsg2["request_id"]
        .as_str()
        .expect("request_id 2 missing")
        .to_string();
    assert_ne!(rid1, rid2, "each request must have a distinct request_id");

    // Daemon responds to the second request first.
    send(
        &mut daemon,
        json!({"type": "forward", "request_id": rid2, "payload": {"ans": 2}}),
    )
    .await;
    // Then the first.
    send(
        &mut daemon,
        json!({"type": "forward", "request_id": rid1, "payload": {"ans": 1}}),
    )
    .await;

    // Client receives both responses; order matches the daemon's reply order.
    let resp2 = recv(&mut client).await;
    let resp1 = recv(&mut client).await;

    assert_eq!(resp2["payload"]["ans"], 2);
    assert_eq!(resp1["payload"]["ans"], 1);

    handle.shutdown();
}

// ============================================================================
// Test: Missing Token on Client Registration
// ============================================================================

#[tokio::test]
async fn test_client_missing_token_rejected() {
    let handle = start_relay().await;
    let addr = handle.addr();

    let mut client = connect(addr, API_KEY).await;

    // Register as client without a token.
    send(
        &mut client,
        json!({"type": "register", "device_id": "dev7", "role": "client"}),
    )
    .await;

    // Relay should send an error with code "missing_token".
    let msg = recv(&mut client).await;
    assert_eq!(msg["type"], "error");
    assert_eq!(msg["code"], "missing_token");

    // The connection should close after the error.
    let next = tokio::time::timeout(Duration::from_secs(2), client.next()).await;
    match next {
        Ok(Some(Ok(tokio_tungstenite::tungstenite::Message::Close(_))) | None) => {}
        Ok(Some(Ok(tokio_tungstenite::tungstenite::Message::Text(t)))) => {
            // Allow extra messages but they shouldn't be non-error frames.
            let v: Value = serde_json::from_str(&t).unwrap_or(Value::Null);
            assert_ne!(
                v["type"], "forward",
                "should not receive forward after missing_token error"
            );
        }
        Err(_) => {} // timeout is fine — connection may already be closed
        _ => {}
    }

    handle.shutdown();
}
