//! Hook notification server for PTY session lifecycle callbacks.
//!
//! Receives Stop and `SessionEnd` hook callbacks from Claude Code PTY sessions
//! and routes them to the correct task via `ORK_TASK_ID` correlation.

use std::path::Path;

// ============================================================================
// HookServer
// ============================================================================

/// Receives lifecycle hook callbacks from Claude Code PTY sessions via a
/// Unix domain socket. Each running PTY session's hooks post to this server,
/// correlating via `ORK_TASK_ID` in the process environment.
pub struct HookServer;

impl HookServer {
    /// Start the hook server, binding to the project root's socket path.
    pub fn start(_project_root: &Path) -> Result<Self, String> {
        Ok(Self)
    }
}
