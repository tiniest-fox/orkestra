//! Protocol types and configuration for the relay server.

use std::net::IpAddr;

use tokio::sync::oneshot;

// ============================================================================
// Wire Protocol (re-exported from shared crate)
// ============================================================================

pub use orkestra_relay_protocol::{RelayMessage, Role};

// ============================================================================
// Server Configuration
// ============================================================================

/// Configuration for the relay server.
#[derive(Debug, Clone)]
pub struct RelayConfig {
    /// IP address to bind to.
    pub bind: IpAddr,
    /// Port to listen on.
    pub port: u16,
    /// Required API key for WebSocket connections.
    pub api_key: String,
    /// Maximum WebSocket connections per IP per minute.
    pub rate_limit: u32,
    /// How long (seconds) a pending forward request may wait before timing out.
    ///
    /// Defaults to 30 seconds. Set to a lower value in tests.
    pub forward_timeout_secs: u64,
}

impl RelayConfig {
    pub fn bind_addr(&self) -> std::net::SocketAddr {
        std::net::SocketAddr::new(self.bind, self.port)
    }
}

// ============================================================================
// Server Handle
// ============================================================================

/// Handle to a running relay server.
///
/// Provides access to the actual bound address (useful with port 0 in tests)
/// and a graceful shutdown mechanism.
pub struct RelayHandle {
    pub(crate) addr: std::net::SocketAddr,
    pub(crate) shutdown_tx: oneshot::Sender<()>,
}

impl RelayHandle {
    /// Returns the socket address the server is bound to.
    pub fn addr(&self) -> std::net::SocketAddr {
        self.addr
    }

    /// Signal the server to shut down gracefully.
    pub fn shutdown(self) {
        let _ = self.shutdown_tx.send(());
    }
}
