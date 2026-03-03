//! Shared connection state: daemon and client registries, pending request tracking.

use std::time::Instant;

use dashmap::DashMap;
use tokio::sync::mpsc;

// ============================================================================
// Connection Entries
// ============================================================================

/// Registered daemon connection.
pub(crate) struct DaemonConn {
    /// Channel to send serialized `RelayMessage` JSON to the daemon's socket writer.
    pub(crate) sender: mpsc::Sender<String>,
}

/// Registered client connection.
pub(crate) struct ClientConn {
    /// UUID assigned by the relay on registration.
    pub(crate) client_id: String,
    /// Channel to send serialized `RelayMessage` JSON to the client's socket writer.
    pub(crate) sender: mpsc::Sender<String>,
}

/// In-flight forward request awaiting a daemon response.
pub(crate) struct PendingRequest {
    /// Device the request was forwarded to (for daemon-disconnect cleanup).
    pub(crate) device_id: String,
    /// Client that originated the request (for client-disconnect cleanup).
    pub(crate) client_id: String,
    /// When the request was created, for timeout detection.
    pub(crate) created_at: Instant,
    /// Channel back to the originating client.
    pub(crate) client_sender: mpsc::Sender<String>,
}

// ============================================================================
// ConnectionState
// ============================================================================

/// Shared relay state: one daemon per `device_id`, multiple clients per `device_id`,
/// and a map of in-flight requests keyed by `request_id`.
pub(crate) struct ConnectionState {
    /// One registered daemon per `device_id`.
    pub(crate) daemons: DashMap<String, DaemonConn>,
    /// Zero or more registered clients per `device_id`.
    pub(crate) clients: DashMap<String, Vec<ClientConn>>,
    /// In-flight requests: `request_id` → pending request metadata + client sender.
    pub(crate) pending_requests: DashMap<String, PendingRequest>,
}

impl ConnectionState {
    pub(crate) fn new() -> Self {
        Self {
            daemons: DashMap::new(),
            clients: DashMap::new(),
            pending_requests: DashMap::new(),
        }
    }
}
