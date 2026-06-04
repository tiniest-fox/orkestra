//! Types for hook events and server/receiver handles.

use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::atomic::AtomicBool;
use std::sync::mpsc::{Receiver, Sender};
use std::sync::{Arc, Mutex};
use std::thread::JoinHandle;
use std::time::Duration;

// ============================================================================
// Events
// ============================================================================

/// The kind of lifecycle event that fired.
#[derive(Debug, Clone, PartialEq)]
pub enum HookEventType {
    Stop,
    SessionEnd,
}

/// A lifecycle event received from a Claude Code PTY session hook.
#[derive(Debug, Clone)]
pub struct HookEvent {
    pub event_type: HookEventType,
    pub task_id: String,
    pub session_id: String,
    pub transcript_path: Option<PathBuf>,
    /// Populated for `SessionEnd` events (e.g. `"prompt_input_exit"`).
    pub reason: Option<String>,
}

// ============================================================================
// Server and Receiver
// ============================================================================

/// Running UDS hook notification server.
///
/// Drop (or call `shutdown()`) to stop the accept loop and remove the socket
/// file. Use `register_task` to obtain a per-task `HookReceiver` before the
/// corresponding PTY session starts.
pub struct HookServer {
    pub(crate) socket_path: PathBuf,
    pub(crate) senders: Arc<Mutex<HashMap<String, Sender<HookEvent>>>>,
    pub(crate) shutdown: Arc<AtomicBool>,
    /// Held so the thread stays alive for the server's lifetime.
    pub(crate) _thread: Option<JoinHandle<()>>,
}

/// Per-task receiver end of the hook event channel.
pub struct HookReceiver {
    pub(crate) receiver: Receiver<HookEvent>,
}

impl HookReceiver {
    /// Block until a hook event arrives for this task or the timeout elapses.
    pub fn recv_timeout(
        &self,
        timeout: Duration,
    ) -> Result<HookEvent, std::sync::mpsc::RecvTimeoutError> {
        self.receiver.recv_timeout(timeout)
    }
}
