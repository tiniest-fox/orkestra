//! Integration tests for the relay client.
//!
//! Each test starts a minimal mock relay WebSocket server, exercises the relay
//! client behaviour, and asserts on messages exchanged.

use std::net::SocketAddr;
use std::path::PathBuf;
use std::sync::{Arc, Mutex};
use std::time::Duration;

use futures_util::{SinkExt, StreamExt};
use tokio::net::TcpListener;
use tokio::sync::broadcast;
use tokio_tungstenite::tungstenite::Message;
use tokio_tungstenite::{accept_async, WebSocketStream};
use tokio_util::sync::CancellationToken;

use orkestra_core::adapters::sqlite::DatabaseConnection;
use orkestra_core::workflow::{
    config::{StageConfig, WorkflowConfig},
    execution::ProviderRegistry,
    SqliteWorkflowStore, WorkflowApi, WorkflowStore,
};

use orkestra_networking::{
    relay_client::{self, RelayClientConfig},
    CommandContext, Event,
};

// ============================================================================
// Helpers
// ============================================================================

fn test_workflow() -> WorkflowConfig {
    WorkflowConfig::new(vec![
        StageConfig::new("planning", "plan"),
        StageConfig::new("work", "summary"),
    ])
}

fn test_env() -> (
    Arc<Mutex<WorkflowApi>>,
    Arc<dyn WorkflowStore>,
    Arc<Mutex<rusqlite::Connection>>,
) {
    let conn = DatabaseConnection::in_memory().expect("Failed to open in-memory DB");
    let raw_conn = conn.shared();
    let store: Arc<dyn WorkflowStore> = Arc::new(SqliteWorkflowStore::new(conn.shared()));
    let store_ref = Arc::clone(&store);
    let api = WorkflowApi::new(test_workflow(), store);
    (Arc::new(Mutex::new(api)), store_ref, raw_conn)
}

/// Bind a TCP listener on an ephemeral port and return its address.
async fn ephemeral_addr() -> (TcpListener, SocketAddr) {
    let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let addr = listener.local_addr().unwrap();
    (listener, addr)
}

/// Accept a single WebSocket connection from the listener.
async fn accept_one(listener: &TcpListener) -> WebSocketStream<tokio::net::TcpStream> {
    let (tcp, _) = listener.accept().await.unwrap();
    accept_async(tcp).await.unwrap()
}

/// Receive the next Text message from a WebSocket stream.
async fn next_text(ws: &mut WebSocketStream<tokio::net::TcpStream>) -> serde_json::Value {
    loop {
        match ws.next().await.unwrap().unwrap() {
            Message::Text(t) => return serde_json::from_str(&t).unwrap(),
            _ => continue,
        }
    }
}

/// Build a `RelayClientConfig` pointing at `addr`.
fn client_config(addr: SocketAddr, device_id: &str) -> RelayClientConfig {
    RelayClientConfig {
        relay_url: format!("ws://{addr}"),
        api_key: "test-key".to_string(),
        device_id: device_id.to_string(),
    }
}

// ============================================================================
// Tests
// ============================================================================

/// Device ID persistence: generate an ID, re-open DB, verify same ID returned.
#[test]
fn test_device_id_persistence() {
    use orkestra_store::interactions::daemon_config::load_or_generate_device_id;
    use rusqlite::OptionalExtension;

    // Use a temporary in-memory database via `DatabaseConnection::in_memory`.
    let conn = DatabaseConnection::in_memory().expect("Failed to open DB");
    let raw_conn = conn.shared();

    // First call: no device_id exists → generate and store.
    let id1 = {
        let c = raw_conn.lock().unwrap();
        load_or_generate_device_id::execute(&c).unwrap()
    };
    assert!(!id1.is_empty());

    // Second call on the same connection: must return the same ID.
    let id2 = {
        let c = raw_conn.lock().unwrap();
        load_or_generate_device_id::execute(&c).unwrap()
    };
    assert_eq!(id1, id2, "device ID must survive across calls");

    // Verify it's a valid UUID.
    uuid::Uuid::parse_str(&id1).expect("device ID must be a valid UUID");

    // Directly confirm the value in the DB.
    let stored: Option<String> = raw_conn
        .lock()
        .unwrap()
        .query_row(
            "SELECT value FROM daemon_config WHERE key = 'device_id'",
            [],
            |row| row.get(0),
        )
        .optional()
        .unwrap();
    assert_eq!(stored.as_deref(), Some(id1.as_str()));
}

/// The relay client sends a Register message after connecting.
#[tokio::test]
async fn test_register_on_connect() {
    let (listener, addr) = ephemeral_addr().await;
    let (api, store, conn) = test_env();
    let ctx = Arc::new(CommandContext::new(
        api,
        conn,
        PathBuf::new(),
        Arc::new(ProviderRegistry::new("claudecode")),
        store,
    ));
    let (event_tx, _) = broadcast::channel::<Event>(16);
    let stop = CancellationToken::new();

    // Spawn the relay client.
    let stop_clone = stop.clone();
    let ctx_clone = Arc::clone(&ctx);
    let event_tx_clone = event_tx.clone();
    tokio::spawn(async move {
        let _ = relay_client::connect(
            client_config(addr, "test-device-123"),
            ctx_clone,
            event_tx_clone,
            stop_clone,
        )
        .await;
    });

    // Accept the connection and read the first message.
    let mut ws = accept_one(&listener).await;
    let msg = next_text(&mut ws).await;

    stop.cancel();

    assert_eq!(msg["type"], "register");
    assert_eq!(msg["device_id"], "test-device-123");
    assert_eq!(msg["role"], "daemon");
}

/// The relay client forwards an orchestrator event as an Event message.
#[tokio::test]
async fn test_event_forwarding() {
    let (listener, addr) = ephemeral_addr().await;
    let (api, store, conn) = test_env();
    let ctx = Arc::new(CommandContext::new(
        api,
        conn,
        PathBuf::new(),
        Arc::new(ProviderRegistry::new("claudecode")),
        store,
    ));
    let (event_tx, _) = broadcast::channel::<Event>(16);
    let stop = CancellationToken::new();

    let stop_clone = stop.clone();
    let ctx_clone = Arc::clone(&ctx);
    let event_tx_clone = event_tx.clone();
    tokio::spawn(async move {
        let _ = relay_client::connect(
            client_config(addr, "dev-events"),
            ctx_clone,
            event_tx_clone,
            stop_clone,
        )
        .await;
    });

    let mut ws = accept_one(&listener).await;
    // Consume the Register message.
    let _ = next_text(&mut ws).await;

    // Inject an event.
    event_tx
        .send(Event::task_updated("task-xyz"))
        .expect("send failed");

    // The next message should be an Event wrapping the task_updated payload.
    let msg = tokio::time::timeout(Duration::from_secs(2), next_text(&mut ws))
        .await
        .expect("Timeout waiting for event");

    stop.cancel();

    assert_eq!(msg["type"], "event");
    let payload = &msg["payload"];
    assert_eq!(payload["event"], "task_updated");
    assert_eq!(payload["data"]["task_id"], "task-xyz");
}

/// Clean shutdown: cancelling the stop token causes the relay client to exit.
#[tokio::test]
async fn test_clean_shutdown() {
    let (listener, addr) = ephemeral_addr().await;
    let (api, store, conn) = test_env();
    let ctx = Arc::new(CommandContext::new(
        api,
        conn,
        PathBuf::new(),
        Arc::new(ProviderRegistry::new("claudecode")),
        store,
    ));
    let (event_tx, _) = broadcast::channel::<Event>(16);
    let stop = CancellationToken::new();

    let stop_clone = stop.clone();
    let ctx_clone = Arc::clone(&ctx);
    let event_tx_clone = event_tx.clone();
    let handle = tokio::spawn(async move {
        relay_client::connect(
            client_config(addr, "shutdown-test"),
            ctx_clone,
            event_tx_clone,
            stop_clone,
        )
        .await
    });

    // Accept so the client can connect.
    let mut ws = accept_one(&listener).await;
    let _ = next_text(&mut ws).await; // consume Register

    // Cancel and verify the task finishes promptly.
    stop.cancel();
    let result = tokio::time::timeout(Duration::from_secs(3), handle)
        .await
        .expect("relay client did not shut down within 3s");
    assert!(result.unwrap().is_ok(), "relay client should exit cleanly");
}

/// Reconnection: after the mock relay closes the connection, the client retries.
#[tokio::test]
async fn test_reconnection_after_disconnect() {
    let (listener, addr) = ephemeral_addr().await;
    let (api, store, conn) = test_env();
    let ctx = Arc::new(CommandContext::new(
        api,
        conn,
        PathBuf::new(),
        Arc::new(ProviderRegistry::new("claudecode")),
        store,
    ));
    let (event_tx, _) = broadcast::channel::<Event>(16);
    let stop = CancellationToken::new();

    let stop_clone = stop.clone();
    let ctx_clone = Arc::clone(&ctx);
    let event_tx_clone = event_tx.clone();
    tokio::spawn(async move {
        let _ = relay_client::connect(
            client_config(addr, "reconnect-test"),
            ctx_clone,
            event_tx_clone,
            stop_clone,
        )
        .await;
    });

    // First connection: accept and immediately close.
    {
        let mut ws = accept_one(&listener).await;
        let _ = next_text(&mut ws).await; // consume Register
        let _ = ws.close(None).await;
    }

    // The client should reconnect within a few seconds (1s backoff).
    let reconnected = tokio::time::timeout(Duration::from_secs(5), accept_one(&listener)).await;
    assert!(
        reconnected.is_ok(),
        "relay client should reconnect after disconnect"
    );

    stop.cancel();
}

/// Forward request: send a Forward message, expect the response to echo client_id.
#[tokio::test]
async fn test_request_forwarding_echoes_client_id() {
    use orkestra_networking::{generate_pairing_code, pair_device};

    let (listener, addr) = ephemeral_addr().await;
    let (api, store, conn) = test_env();
    let ctx = Arc::new(CommandContext::new(
        Arc::clone(&api),
        Arc::clone(&conn),
        PathBuf::new(),
        Arc::new(ProviderRegistry::new("claudecode")),
        store,
    ));
    let (event_tx, _) = broadcast::channel::<Event>(16);
    let stop = CancellationToken::new();

    // Create a valid device token for authentication.
    let code = generate_pairing_code::execute(&conn).unwrap();
    let token = pair_device::execute(&conn, &code, "test-client").unwrap();

    let stop_clone = stop.clone();
    let ctx_clone = Arc::clone(&ctx);
    let event_tx_clone = event_tx.clone();
    tokio::spawn(async move {
        let _ = relay_client::connect(
            client_config(addr, "fwd-test"),
            ctx_clone,
            event_tx_clone,
            stop_clone,
        )
        .await;
    });

    let mut ws = accept_one(&listener).await;
    let _ = next_text(&mut ws).await; // consume Register

    // Send a Forward with a valid token and a list_tasks request.
    let forward_msg = serde_json::json!({
        "type": "forward",
        "client_id": "client-abc",
        "token": token,
        "payload": {
            "id": "req-1",
            "method": "list_tasks",
            "params": {}
        }
    });
    ws.send(Message::Text(
        serde_json::to_string(&forward_msg).unwrap().into(),
    ))
    .await
    .unwrap();

    let response = tokio::time::timeout(Duration::from_secs(2), next_text(&mut ws))
        .await
        .expect("Timeout waiting for response");

    stop.cancel();

    // The response must be a Forward echoing client_id.
    assert_eq!(response["type"], "forward");
    assert_eq!(response["client_id"], "client-abc");
    let payload = &response["payload"];
    assert_eq!(payload["id"], "req-1");
    assert!(
        payload["result"].is_array(),
        "list_tasks should return an array"
    );
}

/// Forward request with no token returns UNAUTHORIZED.
#[tokio::test]
async fn test_forward_without_token_is_unauthorized() {
    let (listener, addr) = ephemeral_addr().await;
    let (api, store, conn) = test_env();
    let ctx = Arc::new(CommandContext::new(
        api,
        conn,
        PathBuf::new(),
        Arc::new(ProviderRegistry::new("claudecode")),
        store,
    ));
    let (event_tx, _) = broadcast::channel::<Event>(16);
    let stop = CancellationToken::new();

    let stop_clone = stop.clone();
    let ctx_clone = Arc::clone(&ctx);
    let event_tx_clone = event_tx.clone();
    tokio::spawn(async move {
        let _ = relay_client::connect(
            client_config(addr, "auth-test"),
            ctx_clone,
            event_tx_clone,
            stop_clone,
        )
        .await;
    });

    let mut ws = accept_one(&listener).await;
    let _ = next_text(&mut ws).await; // consume Register

    let forward_msg = serde_json::json!({
        "type": "forward",
        "client_id": "client-xyz",
        "payload": {
            "id": "req-unauth",
            "method": "list_tasks",
            "params": {}
        }
    });
    ws.send(Message::Text(
        serde_json::to_string(&forward_msg).unwrap().into(),
    ))
    .await
    .unwrap();

    let response = tokio::time::timeout(Duration::from_secs(2), next_text(&mut ws))
        .await
        .expect("Timeout waiting for response");

    stop.cancel();

    assert_eq!(response["type"], "forward");
    assert_eq!(response["client_id"], "client-xyz");
    assert_eq!(response["payload"]["error"]["code"], "UNAUTHORIZED");
}
