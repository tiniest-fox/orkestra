//! UDS listener that receives hook callbacks from Claude Code PTY sessions.
//!
//! Hook commands (Stop, `SessionEnd`) pipe a JSON payload into a Unix domain
//! socket. This module accepts those one-shot connections, parses the payload,
//! and routes each event to the per-task channel registered via
//! `HookServer::register_task`.

use std::collections::HashMap;
use std::io::Read;
use std::os::unix::net::UnixListener;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::mpsc;
use std::sync::{Arc, Mutex};
use std::thread;

use serde::Deserialize;

use super::types::{HookEvent, HookEventType, HookReceiver, HookServer};
use crate::orkestra_debug;

// ============================================================================
// Public entry point
// ============================================================================

/// Start a UDS hook notification server rooted at `project_root`.
///
/// Creates `.orkestra/.sockets/hooks-{pid}.sock`, spawns a background accept
/// loop, and returns a `HookServer` handle. Stale socket files from prior runs
/// are unlinked before binding.
pub fn execute(project_root: &Path) -> std::io::Result<HookServer> {
    let sockets_dir = project_root.join(".orkestra").join(".sockets");
    std::fs::create_dir_all(&sockets_dir)?;

    let pid = std::process::id();
    let socket_path = sockets_dir.join(format!("hooks-{pid}.sock"));

    // Remove stale socket from a prior run.
    let _ = std::fs::remove_file(&socket_path);

    let listener = UnixListener::bind(&socket_path)?;

    let senders: Arc<Mutex<HashMap<String, mpsc::Sender<HookEvent>>>> =
        Arc::new(Mutex::new(HashMap::new()));
    let shutdown = Arc::new(AtomicBool::new(false));

    let senders_clone = Arc::clone(&senders);
    let shutdown_clone = Arc::clone(&shutdown);
    let socket_path_clone = socket_path.clone();

    let thread = thread::spawn(move || {
        run_accept_loop(
            &listener,
            &senders_clone,
            &shutdown_clone,
            &socket_path_clone,
        );
    });

    Ok(HookServer {
        socket_path,
        senders,
        shutdown,
        _thread: Some(thread),
    })
}

// ============================================================================
// HookServer methods
// ============================================================================

impl HookServer {
    /// Register a task to receive hook events; returns the receiving end.
    ///
    /// Call this before spawning the PTY session so no events are missed.
    pub fn register_task(&self, task_id: &str) -> HookReceiver {
        let (tx, rx) = mpsc::channel();
        self.senders
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner)
            .insert(task_id.to_string(), tx);
        HookReceiver { receiver: rx }
    }

    /// Unregister a task, dropping any unread events for it.
    pub fn unregister_task(&self, task_id: &str) {
        self.senders
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner)
            .remove(task_id);
    }

    /// The socket path the PTY spawner should use when constructing hook commands.
    pub fn socket_path(&self) -> &Path {
        &self.socket_path
    }

    /// Stop the accept loop and remove the socket file.
    ///
    /// Safe to call more than once; errors during cleanup are ignored.
    pub fn shutdown(&self) {
        self.shutdown.store(true, Ordering::Release);
        // Probe connection unblocks the blocking accept() in the background thread.
        let _ = std::os::unix::net::UnixStream::connect(&self.socket_path);
        let _ = std::fs::remove_file(&self.socket_path);
    }
}

impl Drop for HookServer {
    fn drop(&mut self) {
        self.shutdown();
    }
}

// ============================================================================
// Accept loop
// ============================================================================

fn run_accept_loop(
    listener: &UnixListener,
    senders: &Arc<Mutex<HashMap<String, mpsc::Sender<HookEvent>>>>,
    shutdown: &Arc<AtomicBool>,
    socket_path: &Path,
) {
    loop {
        match listener.accept() {
            Ok((stream, _)) => {
                if shutdown.load(Ordering::Acquire) {
                    break;
                }
                let mut buf = String::new();
                if let Err(e) = stream.take(65_536).read_to_string(&mut buf) {
                    orkestra_debug!("hooks", "read error on hook connection: {e}");
                    continue;
                }
                let trimmed = buf.trim();
                if !trimmed.is_empty() {
                    dispatch_payload(trimmed, senders);
                }
            }
            Err(e) => {
                if !shutdown.load(Ordering::Acquire) {
                    orkestra_debug!("hooks", "accept error on hook socket: {e}");
                }
                break;
            }
        }
    }
    // Best-effort cleanup if shutdown() hasn't already removed the file.
    let _ = std::fs::remove_file(socket_path);
}

fn dispatch_payload(payload: &str, senders: &Arc<Mutex<HashMap<String, mpsc::Sender<HookEvent>>>>) {
    let parsed: HookPayload = match serde_json::from_str(payload) {
        Ok(p) => p,
        Err(e) => {
            orkestra_debug!("hooks", "invalid JSON in hook payload: {e}");
            return;
        }
    };

    let event_type = match parsed.event.as_str() {
        "stop" => HookEventType::Stop,
        "session_end" => HookEventType::SessionEnd,
        other => {
            orkestra_debug!("hooks", "unknown hook event type: {other}");
            return;
        }
    };

    if parsed.task_id.is_empty() {
        orkestra_debug!("hooks", "hook payload missing task_id");
        return;
    }

    let event = HookEvent {
        event_type,
        task_id: parsed.task_id.clone(),
        session_id: parsed.session_id,
        transcript_path: parsed.transcript_path.map(PathBuf::from),
        reason: parsed.reason,
    };

    let senders = senders
        .lock()
        .unwrap_or_else(std::sync::PoisonError::into_inner);
    if let Some(sender) = senders.get(&parsed.task_id) {
        // Ignore send errors — the receiver may have been dropped intentionally.
        let _ = sender.send(event);
    }
}

// ============================================================================
// Payload deserialization
// ============================================================================

#[derive(Deserialize)]
struct HookPayload {
    event: String,
    task_id: String,
    session_id: String,
    transcript_path: Option<String>,
    reason: Option<String>,
}

// ============================================================================
// Tests
// ============================================================================

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Write;
    use std::os::unix::net::UnixStream;
    use std::time::Duration;
    use tempfile::TempDir;

    fn send_payload(socket_path: &Path, payload: &str) {
        let mut stream = UnixStream::connect(socket_path).expect("connect to hook socket");
        stream
            .write_all(payload.as_bytes())
            .expect("write hook payload");
        // Drop closes the connection, flushing the write.
    }

    #[test]
    fn test_stop_event_delivered() {
        let dir = TempDir::new().unwrap();
        let server = execute(dir.path()).unwrap();
        let rx = server.register_task("task-1");

        send_payload(
            server.socket_path(),
            r#"{"event":"stop","task_id":"task-1","session_id":"ses-abc","transcript_path":"/tmp/a.jsonl"}"#,
        );

        let event = rx.recv_timeout(Duration::from_secs(2)).unwrap();
        assert_eq!(event.task_id, "task-1");
        assert_eq!(event.session_id, "ses-abc");
        assert_eq!(event.event_type, HookEventType::Stop);
        assert_eq!(event.transcript_path, Some(PathBuf::from("/tmp/a.jsonl")));
        assert!(event.reason.is_none());
    }

    #[test]
    fn test_session_end_event_with_reason() {
        let dir = TempDir::new().unwrap();
        let server = execute(dir.path()).unwrap();
        let rx = server.register_task("task-x");

        send_payload(
            server.socket_path(),
            r#"{"event":"session_end","task_id":"task-x","session_id":"ses-xyz","reason":"prompt_input_exit"}"#,
        );

        let event = rx.recv_timeout(Duration::from_secs(2)).unwrap();
        assert_eq!(event.event_type, HookEventType::SessionEnd);
        assert_eq!(event.reason.as_deref(), Some("prompt_input_exit"));
    }

    #[test]
    fn test_multi_task_routing() {
        let dir = TempDir::new().unwrap();
        let server = execute(dir.path()).unwrap();
        let rx1 = server.register_task("task-1");
        let rx2 = server.register_task("task-2");

        send_payload(
            server.socket_path(),
            r#"{"event":"stop","task_id":"task-2","session_id":"s2"}"#,
        );
        send_payload(
            server.socket_path(),
            r#"{"event":"stop","task_id":"task-1","session_id":"s1"}"#,
        );

        let e2 = rx2.recv_timeout(Duration::from_secs(2)).unwrap();
        let e1 = rx1.recv_timeout(Duration::from_secs(2)).unwrap();
        assert_eq!(e1.task_id, "task-1");
        assert_eq!(e2.task_id, "task-2");
    }

    #[test]
    fn test_invalid_json_no_crash() {
        let dir = TempDir::new().unwrap();
        let server = execute(dir.path()).unwrap();
        let rx = server.register_task("task-1");

        send_payload(server.socket_path(), "not valid json {{");

        // Give the accept thread time to process the payload.
        std::thread::sleep(Duration::from_millis(100));

        // No event delivered.
        assert!(rx.recv_timeout(Duration::from_millis(10)).is_err());
    }

    #[test]
    fn test_unknown_event_type_skipped() {
        let dir = TempDir::new().unwrap();
        let server = execute(dir.path()).unwrap();
        let rx = server.register_task("task-1");

        send_payload(
            server.socket_path(),
            r#"{"event":"notification","task_id":"task-1","session_id":"s1"}"#,
        );

        std::thread::sleep(Duration::from_millis(100));
        assert!(rx.recv_timeout(Duration::from_millis(10)).is_err());
    }

    #[test]
    fn test_unregistered_task_no_crash() {
        let dir = TempDir::new().unwrap();
        let server = execute(dir.path()).unwrap();

        // Send to a task_id that was never registered.
        send_payload(
            server.socket_path(),
            r#"{"event":"stop","task_id":"ghost-task","session_id":"s1"}"#,
        );

        std::thread::sleep(Duration::from_millis(100));
        // No panic = success.
    }

    #[test]
    fn test_unregister_drops_events() {
        let dir = TempDir::new().unwrap();
        let server = execute(dir.path()).unwrap();
        let rx = server.register_task("task-1");
        server.unregister_task("task-1");

        send_payload(
            server.socket_path(),
            r#"{"event":"stop","task_id":"task-1","session_id":"s1"}"#,
        );

        std::thread::sleep(Duration::from_millis(100));
        // Sender was removed, so the receiver gets nothing new.
        assert!(rx.recv_timeout(Duration::from_millis(10)).is_err());
    }

    #[test]
    fn test_socket_cleanup_on_shutdown() {
        let dir = TempDir::new().unwrap();
        let server = execute(dir.path()).unwrap();
        let socket_path = server.socket_path().to_path_buf();

        assert!(socket_path.exists(), "socket should exist after start");

        server.shutdown();
        // shutdown() removes the file synchronously before returning.
        assert!(
            !socket_path.exists(),
            "socket should be removed after shutdown"
        );
    }

    #[test]
    fn test_stale_socket_overwritten_on_start() {
        let dir = TempDir::new().unwrap();

        // Create a fake stale socket file at the expected path.
        let pid = std::process::id();
        let stale_path = dir
            .path()
            .join(".orkestra")
            .join(".sockets")
            .join(format!("hooks-{pid}.sock"));
        std::fs::create_dir_all(stale_path.parent().unwrap()).unwrap();
        std::fs::write(&stale_path, b"stale").unwrap();

        // Server must start without error despite the stale file.
        let server = execute(dir.path()).expect("should overwrite stale socket");
        assert!(server.socket_path().exists());
    }
}
