//! End-to-end relay integration tests.
//!
//! Tests the full message path: external WebSocket client → relay server →
//! daemon relay client → command dispatch → response back through the same path.
//!
//! Each test uses `RelayTestEnv`, which starts a real relay server, a real
//! daemon relay client, and an in-memory `WorkflowApi`. External clients connect
//! via `tokio-tungstenite` and speak the relay wire protocol directly.

use std::net::SocketAddr;
use std::path::PathBuf;
use std::sync::{Arc, Mutex};
use std::time::Duration;

use futures_util::{SinkExt, StreamExt};
use serde_json::{json, Value};
use tokio::net::TcpStream;
use tokio::sync::broadcast;
use tokio_tungstenite::tungstenite::Message;
use tokio_tungstenite::{connect_async, MaybeTlsStream, WebSocketStream};
use tokio_util::sync::CancellationToken;

use orkestra_core::adapters::sqlite::DatabaseConnection;
use orkestra_core::workflow::{
    config::{StageConfig, WorkflowConfig},
    SqliteWorkflowStore, WorkflowApi, WorkflowStore,
};
use orkestra_networking::{
    interactions::auth::{generate_pairing_code, pair_device},
    relay_client::{self, RelayClientConfig},
    CommandContext, Event,
};
use orkestra_relay::{
    server,
    types::{RelayConfig, RelayHandle},
};

// ============================================================================
// Types
// ============================================================================

type WsStream = WebSocketStream<MaybeTlsStream<TcpStream>>;

// ============================================================================
// Test Environment
// ============================================================================

/// Full test environment: relay server + daemon relay client + in-memory `WorkflowApi`.
struct RelayTestEnv {
    relay_addr: SocketAddr,
    api_key: String,
    device_id: String,
    /// Pre-generated valid bearer token for external clients.
    valid_token: String,
    event_tx: broadcast::Sender<Event>,
    relay_handle: RelayHandle,
    /// Cancel to stop the daemon relay client.
    stop: CancellationToken,
}

impl RelayTestEnv {
    /// Start a fully wired test environment and wait for the daemon to register.
    async fn new() -> Self {
        let api_key = "e2e-relay-test-key".to_string();
        let device_id = "e2e-test-device".to_string();

        // 1. Start relay server on an OS-assigned port.
        let config = RelayConfig {
            bind: "127.0.0.1".parse().unwrap(),
            port: 0,
            api_key: api_key.clone(),
            rate_limit: 1000,
            forward_timeout_secs: 5,
        };
        let relay_handle = server::start(config).await.expect("relay server start");
        let relay_addr = relay_handle.addr();

        // 2. In-memory WorkflowApi + shared SQLite connection for auth.
        let db_conn = DatabaseConnection::in_memory().expect("in-memory DB");
        let raw_conn = db_conn.shared();
        let store: Arc<dyn WorkflowStore> = Arc::new(SqliteWorkflowStore::new(db_conn.shared()));
        let api = WorkflowApi::new(minimal_workflow(), store);
        let ctx = Arc::new(CommandContext::new(
            Arc::new(Mutex::new(api)),
            Arc::clone(&raw_conn),
            PathBuf::new(),
        ));

        // 3. Pre-generate a valid bearer token for test clients.
        let code = generate_pairing_code::execute(&raw_conn).expect("generate pairing code");
        let valid_token =
            pair_device::execute(&raw_conn, &code, "e2e-test-client").expect("pair device");

        // 4. Event broadcast channel (daemon relay client subscribes to this).
        let (event_tx, _) = broadcast::channel::<Event>(64);

        // 5. Spawn the daemon relay client (background task).
        let stop = CancellationToken::new();
        let relay_client_config = RelayClientConfig {
            relay_url: format!("ws://{relay_addr}"),
            api_key: api_key.clone(),
            device_id: device_id.clone(),
        };
        tokio::spawn(relay_client::connect(
            relay_client_config,
            Arc::clone(&ctx),
            event_tx.clone(),
            stop.clone(),
        ));

        // 6. Wait until the daemon relay client has registered with the relay server.
        wait_for_daemon_registered(relay_addr, &api_key, &device_id).await;

        Self {
            relay_addr,
            api_key,
            device_id,
            valid_token,
            event_tx,
            relay_handle,
            stop,
        }
    }

    /// Connect an external WebSocket client and register it for this device.
    async fn connect_client(&self, token: &str) -> WsStream {
        let url = format!("ws://{}/ws?api_key={}", self.relay_addr, self.api_key);
        let (mut ws, _) = connect_async(&url).await.expect("client connect");
        send_json(
            &mut ws,
            json!({
                "type": "register",
                "device_id": self.device_id,
                "role": "client",
                "token": token,
            }),
        )
        .await;
        ws
    }

    /// Stop the daemon relay client and shut down the relay server.
    fn shutdown(self) {
        self.stop.cancel();
        self.relay_handle.shutdown();
    }
}

// ============================================================================
// Helpers
// ============================================================================

fn minimal_workflow() -> WorkflowConfig {
    WorkflowConfig::new(vec![
        StageConfig::new("planning", "plan"),
        StageConfig::new("work", "summary"),
    ])
}

/// Send a JSON value as a WebSocket text message.
async fn send_json(ws: &mut WsStream, msg: Value) {
    ws.send(Message::Text(msg.to_string().into()))
        .await
        .expect("send");
}

/// Receive the next text message and parse it as JSON, skipping non-text frames.
async fn recv_text(ws: &mut WsStream) -> Value {
    loop {
        match ws.next().await.expect("stream ended").expect("ws error") {
            Message::Text(t) => return serde_json::from_str(&t).expect("invalid JSON"),
            Message::Ping(data) => {
                let _ = ws.send(Message::Pong(data)).await;
            }
            _ => continue,
        }
    }
}

/// Receive the next text message with a 5-second timeout.
async fn recv_text_timeout(ws: &mut WsStream) -> Value {
    tokio::time::timeout(Duration::from_secs(5), recv_text(ws))
        .await
        .expect("recv timed out after 5s")
}

/// Poll the relay until the daemon for `device_id` is registered.
///
/// Connects as a probe client and sends a forward request. If the relay
/// returns `device_offline`, the daemon is not yet registered — retry.
/// Any other response (even UNAUTHORIZED from the daemon) means it is.
async fn wait_for_daemon_registered(relay_addr: SocketAddr, api_key: &str, device_id: &str) {
    let url = format!("ws://{relay_addr}/ws?api_key={api_key}");

    // 120 × 50ms = 6 seconds. The daemon relay client has a 1-second backoff
    // after the first disconnect, plus axum's graceful shutdown takes some time
    // to close the existing connection. 6 seconds is ample headroom.
    for _ in 0..120 {
        tokio::time::sleep(Duration::from_millis(50)).await;

        let Ok((mut ws, _)) = connect_async(&url).await else {
            continue;
        };

        let register = json!({
            "type": "register",
            "device_id": device_id,
            "role": "client",
            "token": "probe",
        });
        if ws
            .send(Message::Text(register.to_string().into()))
            .await
            .is_err()
        {
            continue;
        }

        let request = json!({
            "type": "forward",
            "payload": {"id": "probe", "method": "list_tasks", "params": {}},
        });
        if ws
            .send(Message::Text(request.to_string().into()))
            .await
            .is_err()
        {
            continue;
        }

        match tokio::time::timeout(Duration::from_millis(300), ws.next()).await {
            Ok(Some(Ok(Message::Text(text)))) => {
                let msg: Value = serde_json::from_str(&text).unwrap_or(Value::Null);
                // device_offline → daemon not registered; anything else → registered.
                let is_offline = msg["type"] == "error" && msg["code"] == "device_offline";
                let _ = ws.close(None).await;
                if !is_offline {
                    return;
                }
            }
            _ => {
                let _ = ws.close(None).await;
            }
        }
    }

    panic!("Daemon relay client did not register within 6 seconds");
}

// ============================================================================
// Test 1: Happy Path — JSON-RPC Request/Response
// ============================================================================

/// A valid client can send list_tasks through the relay and receive a response.
#[tokio::test]
async fn test_happy_path_request_response() {
    let env = RelayTestEnv::new().await;
    let token = env.valid_token.clone();
    let mut client = env.connect_client(&token).await;

    // list_tasks should return an empty array for a fresh WorkflowApi.
    send_json(
        &mut client,
        json!({
            "type": "forward",
            "payload": {"id": "req-1", "method": "list_tasks", "params": {}},
        }),
    )
    .await;

    let response = recv_text_timeout(&mut client).await;

    assert_eq!(response["type"], "forward", "response must be a forward");
    assert_eq!(response["payload"]["id"], "req-1", "id must echo");
    assert!(
        response["payload"]["result"].is_array(),
        "list_tasks result must be an array, got: {response}"
    );

    env.shutdown();
}

// ============================================================================
// Test 2: Event Forwarding
// ============================================================================

/// Events injected into the broadcast channel propagate to connected clients.
#[tokio::test]
async fn test_event_forwarding() {
    let env = RelayTestEnv::new().await;
    let token = env.valid_token.clone();
    let mut client = env.connect_client(&token).await;
    let event_tx = env.event_tx.clone();

    // Inject an event — the daemon relay client forwards it to the relay server,
    // which broadcasts it to all registered clients.
    event_tx
        .send(Event::task_updated("task-relay-e2e-123"))
        .expect("send event");

    let msg = recv_text_timeout(&mut client).await;

    assert_eq!(msg["type"], "event");
    assert_eq!(msg["payload"]["event"], "task_updated");
    assert_eq!(msg["payload"]["data"]["task_id"], "task-relay-e2e-123");

    env.shutdown();
}

// ============================================================================
// Test 3: Multiple Clients
// ============================================================================

/// Two clients for the same device: responses are unicast; events are broadcast.
#[tokio::test]
async fn test_multiple_clients() {
    let env = RelayTestEnv::new().await;
    let token = env.valid_token.clone();
    let event_tx = env.event_tx.clone();

    let mut client_a = env.connect_client(&token).await;
    let mut client_b = env.connect_client(&token).await;

    // Give the relay a moment to register both clients.
    tokio::time::sleep(Duration::from_millis(50)).await;

    // -- Unicast: response from A's request goes only to A --
    send_json(
        &mut client_a,
        json!({
            "type": "forward",
            "payload": {"id": "req-a", "method": "list_tasks", "params": {}},
        }),
    )
    .await;

    let resp_a = recv_text_timeout(&mut client_a).await;
    assert_eq!(
        resp_a["payload"]["id"], "req-a",
        "client A should get its own response"
    );

    // -- Broadcast: event reaches both clients --
    event_tx
        .send(Event::task_updated("task-broadcast"))
        .expect("send broadcast event");

    let evt_a = recv_text_timeout(&mut client_a).await;
    let evt_b = recv_text_timeout(&mut client_b).await;

    assert_eq!(evt_a["type"], "event");
    assert_eq!(evt_b["type"], "event");
    assert_eq!(evt_a["payload"]["data"]["task_id"], "task-broadcast");
    assert_eq!(evt_b["payload"]["data"]["task_id"], "task-broadcast");

    env.shutdown();
}

// ============================================================================
// Test 4: Device Offline
// ============================================================================

/// A client forwarding to a device with no daemon receives device_offline immediately.
#[tokio::test]
async fn test_device_offline_no_daemon() {
    // Start relay only — no daemon relay client for this device.
    let api_key = "offline-test-key";
    let config = RelayConfig {
        bind: "127.0.0.1".parse().unwrap(),
        port: 0,
        api_key: api_key.to_string(),
        rate_limit: 1000,
        forward_timeout_secs: 5,
    };
    let handle = server::start(config).await.expect("relay start");
    let addr = handle.addr();

    let url = format!("ws://{addr}/ws?api_key={api_key}");
    let (mut client, _) = connect_async(&url).await.expect("connect");

    send_json(
        &mut client,
        json!({"type": "register", "device_id": "ghost-device", "role": "client", "token": "t"}),
    )
    .await;

    send_json(
        &mut client,
        json!({"type": "forward", "payload": {"id": "r1", "method": "list_tasks", "params": {}}}),
    )
    .await;

    let msg = recv_text_timeout(&mut client).await;
    assert_eq!(msg["type"], "error");
    assert_eq!(msg["code"], "device_offline");

    handle.shutdown();
}

// ============================================================================
// Test 5: Invalid Bearer Token
// ============================================================================

/// A forward request with an invalid token receives UNAUTHORIZED from the daemon.
#[tokio::test]
async fn test_invalid_bearer_token() {
    let env = RelayTestEnv::new().await;

    // Connect with a token that has NOT been registered in the DB.
    let mut client = env.connect_client("this-token-does-not-exist").await;

    send_json(
        &mut client,
        json!({
            "type": "forward",
            "payload": {"id": "req-unauth", "method": "list_tasks", "params": {}},
        }),
    )
    .await;

    let response = recv_text_timeout(&mut client).await;

    // The daemon returns an UNAUTHORIZED error, wrapped in a Forward payload.
    assert_eq!(response["type"], "forward");
    assert_eq!(
        response["payload"]["error"]["code"], "UNAUTHORIZED",
        "expected UNAUTHORIZED, got: {response}"
    );

    env.shutdown();
}

// ============================================================================
// Test 6: Invalid API Key
// ============================================================================

/// A WebSocket connection with a wrong API key is rejected with 401.
#[tokio::test]
async fn test_invalid_api_key_rejected() {
    let config = RelayConfig {
        bind: "127.0.0.1".parse().unwrap(),
        port: 0,
        api_key: "correct-key".to_string(),
        rate_limit: 1000,
        forward_timeout_secs: 5,
    };
    let handle = server::start(config).await.expect("relay start");
    let addr = handle.addr();

    let url = format!("ws://{addr}/ws?api_key=wrong-key");
    let result = connect_async(&url).await;

    assert!(
        result.is_err(),
        "Connection with wrong API key must be rejected"
    );

    handle.shutdown();
}

// ============================================================================
// Test 7: Daemon Reconnection
// ============================================================================

/// After the daemon relay client disconnects, a new daemon instance reconnects
/// and operation resumes.
///
/// Axum's graceful shutdown does not forcibly close existing WebSocket
/// connections — the handler tasks remain alive. Restarting the relay server
/// therefore cannot trigger a daemon disconnect. Instead we simulate the
/// real-world reconnection scenario: the daemon process crashes/restarts while
/// the relay stays running. The relay must accept the new daemon and resume
/// routing.
#[tokio::test]
async fn test_daemon_reconnection() {
    let api_key = "reconnect-test-key";
    let device_id = "reconnect-device";

    // -- Relay server (stays running throughout) --
    let relay_handle = server::start(RelayConfig {
        bind: "127.0.0.1".parse().unwrap(),
        port: 0,
        api_key: api_key.to_string(),
        rate_limit: 1000,
        forward_timeout_secs: 5,
    })
    .await
    .expect("relay start");
    let relay_addr = relay_handle.addr();

    // -- Shared WorkflowApi + auth DB --
    let db_conn = DatabaseConnection::in_memory().expect("in-memory DB");
    let raw_conn = db_conn.shared();
    let store: Arc<dyn WorkflowStore> = Arc::new(SqliteWorkflowStore::new(db_conn.shared()));
    let api = WorkflowApi::new(minimal_workflow(), store);
    let ctx = Arc::new(CommandContext::new(
        Arc::new(Mutex::new(api)),
        Arc::clone(&raw_conn),
        PathBuf::new(),
    ));
    let code = generate_pairing_code::execute(&raw_conn).expect("pairing code");
    let valid_token =
        pair_device::execute(&raw_conn, &code, "reconnect-client").expect("pair device");
    let (event_tx, _) = broadcast::channel::<Event>(64);

    let relay_client_config = || RelayClientConfig {
        relay_url: format!("ws://{relay_addr}"),
        api_key: api_key.to_string(),
        device_id: device_id.to_string(),
    };

    // -- First daemon instance --
    let stop1 = CancellationToken::new();
    tokio::spawn(relay_client::connect(
        relay_client_config(),
        Arc::clone(&ctx),
        event_tx.clone(),
        stop1.clone(),
    ));
    wait_for_daemon_registered(relay_addr, api_key, device_id).await;

    // Verify initial operation.
    let url = format!("ws://{relay_addr}/ws?api_key={api_key}");
    let (mut client, _) = connect_async(&url).await.expect("client connect");
    send_json(
        &mut client,
        json!({"type": "register", "device_id": device_id, "role": "client", "token": valid_token}),
    )
    .await;
    send_json(
        &mut client,
        json!({
            "type": "forward",
            "payload": {"id": "pre-reconnect", "method": "list_tasks", "params": {}},
        }),
    )
    .await;
    let resp = recv_text_timeout(&mut client).await;
    assert_eq!(resp["payload"]["id"], "pre-reconnect");
    drop(client);

    // -- Stop first daemon (simulates daemon process crash/restart) --
    stop1.cancel();
    // Wait for the daemon task to exit and its connection to close so the
    // relay cleans up the daemon registry entry.
    tokio::time::sleep(Duration::from_millis(200)).await;

    // -- Second daemon instance (reconnect) --
    let stop2 = CancellationToken::new();
    tokio::spawn(relay_client::connect(
        relay_client_config(),
        Arc::clone(&ctx),
        event_tx.clone(),
        stop2.clone(),
    ));
    wait_for_daemon_registered(relay_addr, api_key, device_id).await;

    // Verify operation resumes after reconnection.
    let (mut new_client, _) = connect_async(&url).await.expect("client after reconnect");
    send_json(
        &mut new_client,
        json!({"type": "register", "device_id": device_id, "role": "client", "token": valid_token}),
    )
    .await;
    send_json(
        &mut new_client,
        json!({
            "type": "forward",
            "payload": {"id": "post-reconnect", "method": "list_tasks", "params": {}},
        }),
    )
    .await;
    let resp = recv_text_timeout(&mut new_client).await;
    assert_eq!(
        resp["payload"]["id"], "post-reconnect",
        "operation resumes after daemon reconnection"
    );

    stop2.cancel();
    relay_handle.shutdown();
}

// ============================================================================
// Test 8: Daemon Disconnect During In-Flight Request
// ============================================================================

/// When the daemon disconnects with a pending request, the client receives
/// device_offline.
///
/// This test uses a raw WebSocket as the daemon (not the relay client) so we
/// can control exactly when it disconnects — after receiving the request but
/// before sending a response.
#[tokio::test]
async fn test_daemon_disconnect_during_in_flight_request() {
    let api_key = "inflight-test-key";
    let device_id = "inflight-device";

    let config = RelayConfig {
        bind: "127.0.0.1".parse().unwrap(),
        port: 0,
        api_key: api_key.to_string(),
        rate_limit: 1000,
        forward_timeout_secs: 5,
    };
    let handle = server::start(config).await.expect("relay start");
    let addr = handle.addr();
    let url = format!("ws://{addr}/ws?api_key={api_key}");

    // Connect a raw daemon WebSocket (not the relay client).
    let (mut daemon, _) = connect_async(&url).await.expect("daemon connect");
    send_json(
        &mut daemon,
        json!({"type": "register", "device_id": device_id, "role": "daemon"}),
    )
    .await;

    // Connect an external client.
    let (mut client, _) = connect_async(&url).await.expect("client connect");
    send_json(
        &mut client,
        json!({"type": "register", "device_id": device_id, "role": "client", "token": "tok"}),
    )
    .await;

    // Small delay to ensure registrations are processed.
    tokio::time::sleep(Duration::from_millis(50)).await;

    // Client sends a forward request.
    send_json(
        &mut client,
        json!({"type": "forward", "payload": {"id": "r-inflight", "method": "ping", "params": {}}}),
    )
    .await;

    // Daemon receives the request but does NOT respond — then disconnects.
    let _daemon_msg = tokio::time::timeout(Duration::from_secs(2), daemon.next())
        .await
        .expect("daemon recv timeout")
        .expect("daemon stream ended")
        .expect("daemon ws error");
    daemon.close(None).await.expect("close daemon");
    drop(daemon);

    // The client should receive device_offline because the daemon disconnected
    // while the request was still pending.
    let msg = recv_text_timeout(&mut client).await;
    assert_eq!(msg["type"], "error");
    assert_eq!(msg["code"], "device_offline");

    handle.shutdown();
}
