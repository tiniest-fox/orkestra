//! Integration tests for the WebSocket server.
//!
//! Starts a server in-process, connects a `tokio-tungstenite` client, and
//! verifies request/response/event behaviour end-to-end.

use std::net::SocketAddr;
use std::path::PathBuf;
use std::sync::{Arc, Mutex};

use tokio::sync::broadcast;
use tokio_tungstenite::{connect_async, WebSocketStream};

use orkestra_core::adapters::sqlite::DatabaseConnection;
use orkestra_core::workflow::{
    config::{StageCapabilities, StageConfig, WorkflowConfig},
    execution::ProviderRegistry,
    runtime::{Artifact, TaskState},
    SqliteWorkflowStore, WorkflowApi, WorkflowStore,
};

use axum::http::HeaderValue;
use orkestra_networking::{server, CommandContext, Event};

/// Static token used in tests to bypass device pairing.
const TEST_TOKEN: &str = "test-static-token";

// ============================================================================
// Helpers
// ============================================================================

/// A simple workflow config for tests.
fn test_workflow() -> WorkflowConfig {
    WorkflowConfig::new(vec![
        StageConfig::new("planning", "plan").with_capabilities(StageCapabilities::with_questions()),
        StageConfig::new("work", "summary"),
    ])
}

/// Build a `WorkflowApi` backed by an in-memory `SQLite` database.
///
/// Returns the API, a handle to the underlying store so tests can seed task
/// state directly, and the raw connection needed for auth in the server.
fn test_api() -> (
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

/// Start the WebSocket server on an ephemeral port using the test static token.
///
/// Returns the bound address and the broadcast sender for injecting events.
async fn start_test_server(
    api: Arc<Mutex<WorkflowApi>>,
    store: Arc<dyn WorkflowStore>,
    conn: Arc<Mutex<rusqlite::Connection>>,
) -> (SocketAddr, broadcast::Sender<Event>) {
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let addr = listener.local_addr().unwrap();
    // No drop — pass the listener directly to eliminate TOCTOU race.

    let (event_tx, _rx) = broadcast::channel::<Event>(256);
    let event_tx_clone = event_tx.clone();
    let ctx = Arc::new(CommandContext::new(
        api,
        conn,
        PathBuf::new(),
        Arc::new(ProviderRegistry::new("claudecode")),
        store,
    ));
    tokio::spawn(async move {
        let _ = server::start(
            ctx,
            event_tx_clone,
            Some(TEST_TOKEN.to_string()),
            listener,
            None::<HeaderValue>,
        )
        .await;
    });
    (addr, event_tx)
}

/// Connect an authenticated WebSocket client to the server using the test token.
async fn connect(
    addr: SocketAddr,
) -> WebSocketStream<tokio_tungstenite::MaybeTlsStream<tokio::net::TcpStream>> {
    let url = format!("ws://{addr}/ws?token={TEST_TOKEN}");
    let (stream, _) = connect_async(&url).await.expect("WebSocket connect failed");
    stream
}

/// Send a JSON-RPC-style request and return the parsed response.
///
/// Skips broadcast events (`state_reset`, `task_updated`, etc.) which have no
/// `"id"` field. RPC responses always carry the request `"id"`.
async fn request(
    stream: &mut WebSocketStream<tokio_tungstenite::MaybeTlsStream<tokio::net::TcpStream>>,
    req: serde_json::Value,
) -> serde_json::Value {
    use futures_util::{SinkExt, StreamExt};
    use tokio_tungstenite::tungstenite::protocol::Message;

    let text = serde_json::to_string(&req).unwrap();
    stream.send(Message::Text(text.into())).await.unwrap();

    loop {
        let msg = stream.next().await.unwrap().unwrap();
        let text = match msg {
            Message::Text(t) => t,
            other => panic!("Expected Text, got {other:?}"),
        };
        let parsed: serde_json::Value = serde_json::from_str(&text).unwrap();
        // Skip broadcast events — they have no "id" field.
        if parsed.get("id").is_some() {
            return parsed;
        }
    }
}

// ============================================================================
// Tests
// ============================================================================

/// Unauthenticated WS connections are rejected with 401.
#[tokio::test]
async fn test_unauthenticated_connection_rejected() {
    let (api, store, conn) = test_api();
    let (addr, _tx) = start_test_server(api, store, conn).await;

    // Connect without a token — should be rejected.
    let result = connect_async(format!("ws://{addr}/ws")).await;
    // The server returns 401, which tokio-tungstenite surfaces as an error.
    assert!(
        result.is_err(),
        "Unauthenticated connection should be rejected"
    );
}

/// List tasks on a fresh server returns an empty array.
#[tokio::test]
async fn test_list_tasks_empty() {
    let (api, store, conn) = test_api();
    let (addr, _tx) = start_test_server(Arc::clone(&api), store, conn).await;
    let mut ws = connect(addr).await;

    let response = request(
        &mut ws,
        serde_json::json!({ "id": "req-1", "method": "list_tasks", "params": {} }),
    )
    .await;

    assert_eq!(response["id"], "req-1");
    assert!(response["result"].is_array(), "result should be an array");
    assert_eq!(response["result"].as_array().unwrap().len(), 0);
}

/// Create a task then list tasks — the new task must appear.
#[tokio::test]
async fn test_create_and_list_task() {
    let (api, store, conn) = test_api();
    let (addr, _tx) = start_test_server(Arc::clone(&api), store, conn).await;
    let mut ws = connect(addr).await;

    // Create task
    let create = request(
        &mut ws,
        serde_json::json!({
            "id": "req-create",
            "method": "create_task",
            "params": { "title": "My test task", "description": "Testing" }
        }),
    )
    .await;

    assert_eq!(create["id"], "req-create");
    assert!(create["result"].is_object());
    assert_eq!(create["result"]["title"], "My test task");
    let task_id = create["result"]["id"].as_str().unwrap().to_string();

    // List tasks
    let list = request(
        &mut ws,
        serde_json::json!({ "id": "req-list", "method": "list_tasks", "params": {} }),
    )
    .await;

    assert_eq!(list["id"], "req-list");
    let tasks = list["result"].as_array().unwrap();
    assert!(
        tasks.iter().any(|t| t["id"].as_str() == Some(&task_id)),
        "created task should appear in list"
    );
}

/// `get_config` returns the workflow configuration with stages.
#[tokio::test]
async fn test_get_config() {
    let (api, store, conn) = test_api();
    let (addr, _tx) = start_test_server(Arc::clone(&api), store, conn).await;
    let mut ws = connect(addr).await;

    let response = request(
        &mut ws,
        serde_json::json!({ "id": "cfg", "method": "get_config", "params": {} }),
    )
    .await;

    assert_eq!(response["id"], "cfg");
    assert!(response["result"].is_object());
    let stages = &response["result"]["stages"];
    assert!(stages.is_array());
    assert!(stages.as_array().unwrap().len() >= 2);
}

/// Unknown method returns a `METHOD_NOT_FOUND` error.
#[tokio::test]
async fn test_unknown_method_error() {
    let (api, store, conn) = test_api();
    let (addr, _tx) = start_test_server(Arc::clone(&api), store, conn).await;
    let mut ws = connect(addr).await;

    let response = request(
        &mut ws,
        serde_json::json!({ "id": "bad", "method": "does_not_exist", "params": {} }),
    )
    .await;

    assert_eq!(response["id"], "bad");
    assert!(response["error"].is_object());
    assert_eq!(response["error"]["code"], "METHOD_NOT_FOUND");
}

/// Delete a task — subsequent get_task returns TASK_NOT_FOUND.
#[tokio::test]
async fn test_delete_task() {
    let (api, store, conn) = test_api();
    let (addr, _tx) = start_test_server(Arc::clone(&api), store, conn).await;
    let mut ws = connect(addr).await;

    // Create task
    let create = request(
        &mut ws,
        serde_json::json!({
            "id": "req-create",
            "method": "create_task",
            "params": { "title": "Delete me", "description": "" }
        }),
    )
    .await;
    let task_id = create["result"]["id"].as_str().unwrap().to_string();

    // Delete task
    let delete = request(
        &mut ws,
        serde_json::json!({
            "id": "req-delete",
            "method": "delete_task",
            "params": { "task_id": task_id }
        }),
    )
    .await;
    assert_eq!(delete["id"], "req-delete");
    assert!(delete["result"].is_null(), "delete should return null");

    // get_task should now fail
    let get = request(
        &mut ws,
        serde_json::json!({
            "id": "req-get",
            "method": "get_task",
            "params": { "task_id": task_id }
        }),
    )
    .await;
    assert_eq!(get["error"]["code"], "TASK_NOT_FOUND");
}

/// `get_archived_tasks` returns an empty array on a fresh server.
#[tokio::test]
async fn test_get_archived_tasks_empty() {
    let (api, store, conn) = test_api();
    let (addr, _tx) = start_test_server(Arc::clone(&api), store, conn).await;
    let mut ws = connect(addr).await;

    let response = request(
        &mut ws,
        serde_json::json!({ "id": "req-archived", "method": "get_archived_tasks", "params": {} }),
    )
    .await;

    assert_eq!(response["id"], "req-archived");
    assert!(response["result"].is_array());
    assert_eq!(response["result"].as_array().unwrap().len(), 0);
}

/// `approve` on a task in AwaitingApproval state succeeds.
/// A second `approve` on the same task returns INVALID_TRANSITION.
#[tokio::test]
async fn test_approve_concurrent_returns_invalid_transition() {
    let (api, store, conn) = test_api();
    let (addr, _tx) = start_test_server(Arc::clone(&api), Arc::clone(&store), conn).await;
    let mut ws = connect(addr).await;

    // Create a task and manually put it into AwaitingApproval state.
    let task = {
        let api_lock = api.lock().unwrap();
        let mut task = api_lock
            .create_task("Concurrent test", "description", None)
            .unwrap();
        task.artifacts.set(Artifact::new(
            "plan",
            "The plan",
            "planning",
            "2024-01-01T00:00:00Z",
        ));
        task.state = TaskState::awaiting_approval("planning");
        store.save_task(&task).unwrap();
        task
    };

    // First approve should succeed.
    let first = request(
        &mut ws,
        serde_json::json!({
            "id": "req-approve-1",
            "method": "approve",
            "params": { "task_id": task.id }
        }),
    )
    .await;
    assert_eq!(first["id"], "req-approve-1");
    assert!(first["result"].is_object(), "first approve should succeed");

    // Second approve should fail with INVALID_TRANSITION.
    let second = request(
        &mut ws,
        serde_json::json!({
            "id": "req-approve-2",
            "method": "approve",
            "params": { "task_id": task.id }
        }),
    )
    .await;
    assert_eq!(second["id"], "req-approve-2");
    assert_eq!(
        second["error"]["code"], "INVALID_TRANSITION",
        "second approve must return INVALID_TRANSITION"
    );
}

/// `merge_task` on a Done task returns the task and emits a `task_updated` event.
#[tokio::test]
async fn test_merge_task_emits_event() {
    use futures_util::StreamExt;
    use tokio_tungstenite::tungstenite::protocol::Message;

    let (api, store, conn) = test_api();
    let (addr, _tx) = start_test_server(Arc::clone(&api), Arc::clone(&store), conn).await;
    let mut ws = connect(addr).await;

    // Warm up the connection.
    let _ = request(
        &mut ws,
        serde_json::json!({ "id": "warmup", "method": "list_tasks", "params": {} }),
    )
    .await;

    // Create a task and manually set it to Done so merge_task can proceed.
    let task = {
        let api_lock = api.lock().unwrap();
        let mut task = api_lock
            .create_task("Merge me", "description", None)
            .unwrap();
        task.state = TaskState::Done;
        store.save_task(&task).unwrap();
        task
    };

    // Call merge_task via WS.
    let merge = request(
        &mut ws,
        serde_json::json!({
            "id": "req-merge",
            "method": "merge_task",
            "params": { "task_id": task.id }
        }),
    )
    .await;
    assert_eq!(merge["id"], "req-merge");
    assert!(
        merge["result"].is_object(),
        "merge_task should return a task object"
    );

    // The handler emits task_updated immediately. Verify it arrives.
    let msg = tokio::time::timeout(std::time::Duration::from_secs(2), ws.next())
        .await
        .expect("Timeout waiting for task_updated event")
        .unwrap()
        .unwrap();

    let text = match msg {
        Message::Text(t) => t,
        other => panic!("Expected Text, got {other:?}"),
    };
    let event: serde_json::Value = serde_json::from_str(&text).unwrap();
    assert_eq!(event["event"], "task_updated");
    assert_eq!(event["data"]["task_id"], task.id);
}

/// `list_branches` with no git service returns an empty `BranchList`.
#[tokio::test]
async fn test_list_branches_no_git() {
    let (api, store, conn) = test_api();
    let (addr, _tx) = start_test_server(Arc::clone(&api), store, conn).await;
    let mut ws = connect(addr).await;

    let response = request(
        &mut ws,
        serde_json::json!({ "id": "branches", "method": "list_branches", "params": {} }),
    )
    .await;

    assert_eq!(response["id"], "branches");
    let result = &response["result"];
    assert!(result.is_object(), "result should be an object");
    assert_eq!(
        result["branches"].as_array().unwrap().len(),
        0,
        "branches should be empty"
    );
    assert!(result["current"].is_null(), "current should be null");
    assert!(
        result["latest_commit_message"].is_null(),
        "latest_commit_message should be null"
    );
}

/// `get_task_diff` returns `NO_GIT` when no git service is configured.
#[tokio::test]
async fn test_get_task_diff_no_git() {
    let (api, store, conn) = test_api();
    let (addr, _tx) = start_test_server(Arc::clone(&api), store, conn).await;
    let mut ws = connect(addr).await;

    // Create a task to have a valid task_id.
    let create = request(
        &mut ws,
        serde_json::json!({
            "id": "req-create",
            "method": "create_task",
            "params": { "title": "Diff test task", "description": "Testing diff" }
        }),
    )
    .await;
    let task_id = create["result"]["id"].as_str().unwrap().to_string();

    // Requesting diff without git configured should return a NO_GIT error.
    let response = request(
        &mut ws,
        serde_json::json!({
            "id": "diff",
            "method": "get_task_diff",
            "params": { "task_id": task_id }
        }),
    )
    .await;

    assert_eq!(response["id"], "diff");
    assert!(response["error"].is_object(), "should return an error");
    assert_eq!(
        response["error"]["code"], "NO_GIT",
        "error code should be NO_GIT"
    );
}

/// `get_syntax_css` returns non-empty CSS strings for both light and dark themes.
#[tokio::test]
async fn test_get_syntax_css() {
    let (api, store, conn) = test_api();
    let (addr, _tx) = start_test_server(Arc::clone(&api), store, conn).await;
    let mut ws = connect(addr).await;

    let response = request(
        &mut ws,
        serde_json::json!({ "id": "css", "method": "get_syntax_css", "params": {} }),
    )
    .await;

    assert_eq!(response["id"], "css");
    let result = &response["result"];
    assert!(result.is_object(), "result should be an object");
    let light = result["light"].as_str().unwrap_or("");
    let dark = result["dark"].as_str().unwrap_or("");
    assert!(!light.is_empty(), "light CSS should be non-empty");
    assert!(!dark.is_empty(), "dark CSS should be non-empty");
}

/// A broadcast `Event` injected via `event_tx` arrives at a connected client.
#[tokio::test]
async fn test_broadcast_event_received() {
    use futures_util::StreamExt;
    use tokio_tungstenite::tungstenite::protocol::Message;

    let (api, store, conn) = test_api();
    let (addr, event_tx) = start_test_server(Arc::clone(&api), store, conn).await;
    let mut ws = connect(addr).await;

    // Warm up the connection with a round-trip so we know it's live.
    let _ = request(
        &mut ws,
        serde_json::json!({ "id": "warmup", "method": "list_tasks", "params": {} }),
    )
    .await;

    // Inject a task_updated event.
    event_tx.send(Event::task_updated("task-abc")).unwrap();

    // The next message should be the broadcast event.
    let msg = tokio::time::timeout(std::time::Duration::from_secs(2), ws.next())
        .await
        .expect("Timeout waiting for broadcast event")
        .unwrap()
        .unwrap();

    let text = match msg {
        Message::Text(t) => t,
        other => panic!("Expected Text, got {other:?}"),
    };
    let event: serde_json::Value = serde_json::from_str(&text).unwrap();
    assert_eq!(event["event"], "task_updated");
    assert_eq!(event["data"]["task_id"], "task-abc");
}

/// Full pairing flow: generate code → POST /pair → connect with token.
#[tokio::test]
async fn test_full_pairing_flow() {
    let (api, store, conn) = test_api();
    // Start server with NO static token — pairing required.
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let addr = listener.local_addr().unwrap();
    // No drop — pass the listener directly to eliminate TOCTOU race.

    let (event_tx, _rx) = broadcast::channel::<Event>(256);
    let event_tx_clone = event_tx.clone();
    let conn_for_server = Arc::clone(&conn);
    let ctx = Arc::new(CommandContext::new(
        api,
        conn_for_server,
        PathBuf::new(),
        Arc::new(ProviderRegistry::new("claudecode")),
        store,
    ));
    tokio::spawn(async move {
        let _ = server::start(ctx, event_tx_clone, None, listener, None::<HeaderValue>).await;
    });

    // Generate a pairing code using the interaction directly.
    let code = orkestra_networking::generate_pairing_code::execute(&conn).unwrap();

    // Claim the code via POST /pair.
    let client = reqwest::Client::new();
    let resp = client
        .post(format!("http://{addr}/pair"))
        .json(&serde_json::json!({ "code": code, "device_name": "test-device" }))
        .send()
        .await
        .expect("POST /pair failed");

    assert_eq!(resp.status(), 200);
    let body: serde_json::Value = resp.json().await.unwrap();
    let token = body["token"].as_str().unwrap().to_string();

    // Connect to WebSocket using the received token.
    let url = format!("ws://{addr}/ws?token={token}");
    let (mut ws, _) = connect_async(&url)
        .await
        .expect("WS connect with pairing token failed");

    // Verify the connection works — use request() so state_reset is skipped.
    let response = request(
        &mut ws,
        serde_json::json!({ "id": "test", "method": "list_tasks", "params": {} }),
    )
    .await;
    assert_eq!(response["id"], "test");
    assert!(response["result"].is_array());
}

/// Expired pairing codes are rejected.
#[tokio::test]
async fn test_expired_pairing_code_rejected() {
    let (_, _, conn) = test_api();

    // Insert a pre-expired pairing code directly via SQL.
    {
        let db = conn.lock().unwrap();
        db.execute(
            "INSERT INTO pairing_codes (code, expires_at, claimed) \
             VALUES ('999999', datetime('now', '-1 minute'), 0)",
            [],
        )
        .unwrap();
    }

    // Claiming an expired code must return InvalidCode.
    let result = orkestra_networking::pair_device::execute(&conn, "999999", "expired-device");
    assert!(
        matches!(
            result,
            Err(orkestra_networking::types::AuthError::InvalidCode)
        ),
        "Expired pairing code should be rejected, got: {result:?}"
    );
}

/// Revoked devices cannot connect.
#[tokio::test]
async fn test_revoked_device_cannot_connect() {
    let (api, store, conn) = test_api();
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let addr = listener.local_addr().unwrap();
    // No drop — pass the listener directly to eliminate TOCTOU race.

    let (event_tx, _rx) = broadcast::channel::<Event>(256);
    let event_tx_clone = event_tx.clone();
    let conn_for_server = Arc::clone(&conn);
    let ctx = Arc::new(CommandContext::new(
        api,
        conn_for_server,
        PathBuf::new(),
        Arc::new(ProviderRegistry::new("claudecode")),
        store,
    ));
    tokio::spawn(async move {
        let _ = server::start(ctx, event_tx_clone, None, listener, None::<HeaderValue>).await;
    });

    // Generate and claim a pairing code.
    let code = orkestra_networking::generate_pairing_code::execute(&conn).unwrap();
    let client = reqwest::Client::new();
    let resp = client
        .post(format!("http://{addr}/pair"))
        .json(&serde_json::json!({ "code": code, "device_name": "revoke-test" }))
        .send()
        .await
        .unwrap();
    let body: serde_json::Value = resp.json().await.unwrap();
    let token = body["token"].as_str().unwrap().to_string();

    // Verify the token works initially.
    let url = format!("ws://{addr}/ws?token={token}");
    let (ws, _) = connect_async(&url)
        .await
        .expect("Initial connection should succeed");
    drop(ws);

    // Look up the device ID then revoke it.
    let devices = orkestra_networking::list_devices::execute(&conn).unwrap();
    let device_id = devices.first().unwrap().id.clone();
    orkestra_networking::revoke_device::execute(&conn, &device_id).unwrap();

    // Token should now be rejected.
    let result = connect_async(format!("ws://{addr}/ws?token={token}")).await;
    assert!(result.is_err(), "Revoked device should be rejected");
}

/// `get_project_info` returns a response with the expected shape.
#[tokio::test]
async fn test_get_project_info() {
    let (api, store, conn) = test_api();
    let (addr, _tx) = start_test_server(Arc::clone(&api), store, conn).await;
    let mut ws = connect(addr).await;

    let response = request(
        &mut ws,
        serde_json::json!({ "id": "info", "method": "get_project_info", "params": {} }),
    )
    .await;

    assert_eq!(response["id"], "info");
    let result = &response["result"];
    assert!(result.is_object(), "result should be an object");
    assert!(
        result["project_root"].is_string(),
        "project_root should be a string"
    );
    assert!(
        result["has_git"].is_boolean(),
        "has_git should be a boolean"
    );
    assert!(
        result["has_gh_cli"].is_boolean(),
        "has_gh_cli should be a boolean"
    );
    assert!(
        result["has_run_script"].is_boolean(),
        "has_run_script should be a boolean"
    );
}

/// `create_task` with `auto_mode: true` threads the flag through to the stored task.
/// Passing an unknown `flow` name returns `INVALID_TRANSITION`.
#[tokio::test]
async fn test_create_task_with_options() {
    let (api, store, conn) = test_api();
    let (addr, _tx) = start_test_server(Arc::clone(&api), store, conn).await;
    let mut ws = connect(addr).await;

    // Create with auto_mode: true — should succeed and return a task with auto_mode set.
    let create = request(
        &mut ws,
        serde_json::json!({
            "id": "req-auto",
            "method": "create_task",
            "params": { "title": "Auto task", "description": "", "auto_mode": true }
        }),
    )
    .await;
    assert_eq!(create["id"], "req-auto");
    assert!(create["result"].is_object(), "should return a task object");
    assert_eq!(
        create["result"]["auto_mode"], true,
        "auto_mode should be true on the created task"
    );

    // Create with an unknown flow — should return INVALID_TRANSITION.
    let bad_flow = request(
        &mut ws,
        serde_json::json!({
            "id": "req-flow",
            "method": "create_task",
            "params": { "title": "Flow task", "description": "", "flow": "nonexistent_flow" }
        }),
    )
    .await;
    assert_eq!(bad_flow["id"], "req-flow");
    assert_eq!(
        bad_flow["error"]["code"], "INVALID_TRANSITION",
        "unknown flow should return INVALID_TRANSITION"
    );
}

/// `return_to_work` on a task in AwaitingApproval state succeeds.
#[tokio::test]
async fn test_return_to_work() {
    let (api, store, conn) = test_api();
    let (addr, _tx) = start_test_server(Arc::clone(&api), Arc::clone(&store), conn).await;
    let mut ws = connect(addr).await;

    // Create a task and manually put it into AwaitingApproval state.
    let task = {
        let api_lock = api.lock().unwrap();
        let mut task = api_lock
            .create_task("Return to work test", "description", None)
            .unwrap();
        task.state = TaskState::awaiting_approval("planning");
        store.save_task(&task).unwrap();
        task
    };

    // Call return_to_work — should succeed and return the task in Queued state.
    let response = request(
        &mut ws,
        serde_json::json!({
            "id": "req-rtw",
            "method": "return_to_work",
            "params": { "task_id": task.id }
        }),
    )
    .await;

    assert_eq!(response["id"], "req-rtw");
    assert!(
        response["result"].is_object(),
        "return_to_work should return a task object, got: {response:?}"
    );
}

/// Stage chat handlers are correctly dispatched: both return errors (not `METHOD_NOT_FOUND`),
/// confirming the dispatch wiring is correct.
///
/// - `stage_chat_send` returns `INVALID_STATE` because the test `WorkflowApi` has no
///   provider registry configured; the handler is reached but fails the registry guard.
/// - `stage_chat_stop` returns `TASK_NOT_FOUND` because it goes directly to the task lookup.
#[tokio::test]
async fn test_stage_chat_dispatch_wiring() {
    let (api, store, conn) = test_api();
    let (addr, _tx) = start_test_server(Arc::clone(&api), store, conn).await;
    let mut ws = connect(addr).await;

    // stage_chat_send — handler is reached but fails the provider_registry guard.
    let send = request(
        &mut ws,
        serde_json::json!({
            "id": "sc-send",
            "method": "stage_chat_send",
            "params": { "task_id": "nonexistent-task", "message": "hello" }
        }),
    )
    .await;
    assert_eq!(send["id"], "sc-send");
    assert_ne!(
        send["error"]["code"], "METHOD_NOT_FOUND",
        "stage_chat_send must be dispatched (not METHOD_NOT_FOUND)"
    );
    assert_eq!(
        send["error"]["code"], "INVALID_STATE",
        "stage_chat_send with no registry returns INVALID_STATE before task lookup"
    );

    // stage_chat_stop — goes directly to task lookup, so returns TASK_NOT_FOUND.
    let stop = request(
        &mut ws,
        serde_json::json!({
            "id": "sc-stop",
            "method": "stage_chat_stop",
            "params": { "task_id": "nonexistent-task" }
        }),
    )
    .await;
    assert_eq!(stop["id"], "sc-stop");
    assert_eq!(
        stop["error"]["code"], "TASK_NOT_FOUND",
        "stage_chat_stop with unknown task must return TASK_NOT_FOUND"
    );
}

/// Assistant handlers are correctly dispatched.
///
/// - `assistant_list_sessions` returns an array (confirms dispatch and that the same store
///   backing `WorkflowApi` is used — empty here, but reachable).
/// - `assistant_get_logs` is dispatched without a `METHOD_NOT_FOUND` error.
/// - `assistant_stop` returns `INVALID_PARAMS` when `session_id` is missing.
#[tokio::test]
async fn test_assistant_dispatch_wiring() {
    let (api, store, conn) = test_api();
    let (addr, _tx) = start_test_server(Arc::clone(&api), store, conn).await;
    let mut ws = connect(addr).await;

    // list_sessions — should return an empty array (not a dispatch error).
    let list = request(
        &mut ws,
        serde_json::json!({ "id": "a-list", "method": "assistant_list_sessions", "params": {} }),
    )
    .await;
    assert_eq!(list["id"], "a-list");
    assert!(
        list["result"].is_array(),
        "assistant_list_sessions should return an array"
    );

    // send_message — should be dispatched (not METHOD_NOT_FOUND).
    let send = request(
        &mut ws,
        serde_json::json!({
            "id": "a-send",
            "method": "assistant_send_message",
            "params": { "message": "hello" }
        }),
    )
    .await;
    assert_eq!(send["id"], "a-send");
    assert_ne!(
        send["error"]["code"], "METHOD_NOT_FOUND",
        "assistant_send_message should be dispatched (not METHOD_NOT_FOUND)"
    );

    // get_logs — passing a session_id should not produce METHOD_NOT_FOUND.
    let logs = request(
        &mut ws,
        serde_json::json!({
            "id": "a-logs",
            "method": "assistant_get_logs",
            "params": { "session_id": "no-such-session" }
        }),
    )
    .await;
    assert_eq!(logs["id"], "a-logs");
    assert_ne!(
        logs["error"]["code"], "METHOD_NOT_FOUND",
        "assistant_get_logs should be dispatched (not METHOD_NOT_FOUND)"
    );

    // stop — missing session_id should return INVALID_PARAMS (not METHOD_NOT_FOUND).
    let stop = request(
        &mut ws,
        serde_json::json!({
            "id": "a-stop",
            "method": "assistant_stop",
            "params": {}
        }),
    )
    .await;
    assert_eq!(stop["id"], "a-stop");
    assert_eq!(
        stop["error"]["code"], "INVALID_PARAMS",
        "assistant_stop with missing session_id should return INVALID_PARAMS"
    );
}

/// A server started with a restricted `allowed_origin` echoes the origin back
/// in `Access-Control-Allow-Origin` when the request origin matches.
#[tokio::test]
async fn test_cors_restricted_origin() {
    let (api, store, conn) = test_api();
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let addr = listener.local_addr().unwrap();

    let (event_tx, _rx) = broadcast::channel::<Event>(256);
    let event_tx_clone = event_tx.clone();
    let ctx = Arc::new(CommandContext::new(
        api,
        conn,
        PathBuf::new(),
        Arc::new(ProviderRegistry::new("claudecode")),
        store,
    ));

    let allowed = HeaderValue::from_static("https://allowed.example.com");
    tokio::spawn(async move {
        let _ = server::start(
            ctx,
            event_tx_clone,
            Some(TEST_TOKEN.to_string()),
            listener,
            Some(allowed),
        )
        .await;
    });

    // POST /pair with a matching Origin header — ACAO should be set.
    // The code "000000" is intentionally invalid; we only care about the CORS header.
    let client = reqwest::Client::new();
    let resp = client
        .post(format!("http://{addr}/pair"))
        .header("Origin", "https://allowed.example.com")
        .json(&serde_json::json!({ "code": "000000", "device_name": "cors-test" }))
        .send()
        .await
        .expect("Request failed");

    let acao = resp.headers().get("access-control-allow-origin");
    assert!(
        acao.is_some(),
        "Access-Control-Allow-Origin should be set for a matching origin"
    );
    assert_eq!(
        acao.unwrap(),
        "https://allowed.example.com",
        "ACAO should echo the restricted origin"
    );
}
