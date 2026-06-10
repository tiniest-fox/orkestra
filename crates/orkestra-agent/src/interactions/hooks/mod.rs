//! Hook notification server for PTY-based Claude Code sessions.
//!
//! Provides a Unix domain socket listener that receives lifecycle callbacks
//! (Stop, `SessionEnd`) from Claude Code hook commands and routes them to
//! per-task receivers.

pub mod server;
pub mod types;

pub use server::execute;
pub use types::{HookEvent, HookEventType, HookReceiver, HookServer};
