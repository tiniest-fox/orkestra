//! Message forwarding loop between the relay WebSocket and the local dispatcher.

use std::sync::Arc;

use futures_util::{SinkExt, StreamExt};
use tokio::net::TcpStream;
use tokio::sync::broadcast;
use tokio_tungstenite::tungstenite::Message;
use tokio_tungstenite::{MaybeTlsStream, WebSocketStream};
use tokio_util::sync::CancellationToken;

use crate::interactions::auth::verify_token;
use crate::interactions::command::dispatch::{self, CommandContext};
use crate::types::{ErrorPayload, ErrorResponse, Event, Request, Response as WsResponse};

use orkestra_relay_protocol::RelayMessage;

/// Drive the relay message loop for one connection lifetime.
///
/// Multiplexes three sources: incoming relay messages, outgoing broadcast events,
/// and the stop signal. Returns when the connection closes or the stop token is
/// cancelled — the caller decides whether to reconnect.
pub(super) async fn run(
    ws: WebSocketStream<MaybeTlsStream<TcpStream>>,
    ctx: Arc<CommandContext>,
    event_tx: broadcast::Sender<Event>,
    stop: CancellationToken,
) {
    let (mut sink, mut stream) = ws.split();
    let mut event_rx = event_tx.subscribe();

    loop {
        tokio::select! {
            // Incoming relay message.
            msg = stream.next() => {
                match msg {
                    Some(Ok(Message::Text(text))) => {
                        let relay_msg: RelayMessage = match serde_json::from_str(&text) {
                            Ok(m) => m,
                            Err(e) => {
                                tracing::warn!("Relay: failed to parse message: {e}");
                                continue;
                            }
                        };

                        match relay_msg {
                            RelayMessage::Forward { client_id, request_id, token, payload } => {
                                let response = handle_forward(
                                    token,
                                    payload,
                                    Arc::clone(&ctx),
                                    event_tx.clone(),
                                )
                                .await;

                                let envelope = RelayMessage::Forward {
                                    client_id,
                                    request_id, // Echo request_id back for relay response routing
                                    token: None,
                                    payload: response,
                                };
                                let text = serde_json::to_string(&envelope)
                                    .unwrap_or_else(|_| r#"{"type":"error","code":"SERIALIZE","message":"serialization failed"}"#.into());
                                if sink.send(Message::Text(text.into())).await.is_err() {
                                    break;
                                }
                            }
                            RelayMessage::Error { code, message } => {
                                tracing::warn!("Relay error from server: [{code}] {message}");
                            }
                            RelayMessage::Register { .. } | RelayMessage::Event { .. } => {
                                tracing::warn!("Relay: unexpected message type from server");
                            }
                        }
                    }
                    Some(Ok(Message::Close(_))) | None => break,
                    Some(Err(e)) => {
                        tracing::warn!("Relay WebSocket error: {e}");
                        break;
                    }
                    Some(Ok(_)) => {} // ignore binary / ping / pong
                }
            }

            // Outgoing broadcast event.
            broadcast_result = event_rx.recv() => {
                match broadcast_result {
                    Ok(event) => {
                        let payload = serde_json::to_value(&event)
                            .unwrap_or(serde_json::Value::Null);
                        let envelope = RelayMessage::Event { payload };
                        let text = serde_json::to_string(&envelope)
                            .unwrap_or_else(|_| r#"{"type":"event","payload":{}}"#.into());
                        if sink.send(Message::Text(text.into())).await.is_err() {
                            break;
                        }
                    }
                    Err(broadcast::error::RecvError::Lagged(_)) => {
                        if let Some(reset_event) = crate::interactions::event::build_state_reset::execute(&ctx).await {
                            let payload = serde_json::to_value(&reset_event)
                                .unwrap_or(serde_json::Value::Null);
                            let envelope = RelayMessage::Event { payload };
                            let text = serde_json::to_string(&envelope)
                                .unwrap_or_else(|_| r#"{"type":"event","payload":{}}"#.into());
                            if sink.send(Message::Text(text.into())).await.is_err() {
                                break;
                            }
                        }
                    }
                    Err(broadcast::error::RecvError::Closed) => break,
                }
            }

            // Stop signal.
            () = stop.cancelled() => break,
        }
    }
}

// ============================================================================
// Helpers
// ============================================================================

/// Authenticate and dispatch a forwarded request, returning the response payload.
async fn handle_forward(
    token: Option<String>,
    payload: serde_json::Value,
    ctx: Arc<CommandContext>,
    event_tx: broadcast::Sender<Event>,
) -> serde_json::Value {
    // Token is required — reject requests without one.
    let Some(token_str) = token else {
        return unauthorized_error();
    };

    // Verify the bearer token.
    let conn = Arc::clone(&ctx.conn);
    let verified =
        tokio::task::spawn_blocking(move || verify_token::execute(&conn, &token_str)).await;

    if !matches!(verified, Ok(Ok(_))) {
        return unauthorized_error();
    }

    // Parse the payload as a Request.
    let request: Request = match serde_json::from_value(payload) {
        Ok(r) => r,
        Err(e) => {
            return serde_json::to_value(ErrorResponse {
                id: String::new(),
                error: ErrorPayload::invalid_params(e.to_string()),
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

fn unauthorized_error() -> serde_json::Value {
    serde_json::to_value(ErrorResponse {
        id: String::new(),
        error: ErrorPayload::new("UNAUTHORIZED", "Invalid or missing bearer token"),
    })
    .unwrap_or(serde_json::Value::Null)
}
