//! Poll a daemon port to check if it is ready to accept connections.

use std::net::TcpStream;
use std::time::Duration;

/// Return `true` if a TCP connection to `127.0.0.1:{port}` succeeds within
/// 200 ms. Used to detect when a newly-spawned daemon has finished starting up.
pub fn execute(port: u16) -> bool {
    let addr = format!("127.0.0.1:{port}");
    let Ok(sock_addr) = addr.parse() else {
        return false;
    };
    TcpStream::connect_timeout(&sock_addr, Duration::from_millis(200)).is_ok()
}

// ============================================================================
// Tests
// ============================================================================

#[cfg(test)]
mod tests {
    use std::net::TcpListener;

    use super::*;

    #[test]
    fn returns_true_when_port_is_listening() {
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        let port = listener.local_addr().unwrap().port();
        assert!(execute(port));
    }

    #[test]
    fn returns_false_when_port_is_not_listening() {
        // Port 1 requires root/CAP_NET_BIND_SERVICE to bind on Unix systems,
        // so it is never bound by user-space test processes. Connecting to it
        // on loopback returns ECONNREFUSED immediately with no race window.
        assert!(!execute(1));
    }
}
