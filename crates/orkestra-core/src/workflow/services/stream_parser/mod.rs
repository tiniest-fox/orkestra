//! Stream parsers for real-time agent stdout log capture.
//!
//! Each provider emits stdout in a different format. The `StreamParser` trait
//! provides a uniform interface: feed it lines, get back `LogEntry` values.
//!
//! Provider-specific implementations live in their own modules:
//! - `claude` — parses Claude Code JSONL events
//! - `opencode` — parses OpenCode `--format json` events

mod claude;
mod opencode;

use crate::workflow::domain::LogEntry;

pub use claude::ClaudeStreamParser;
pub use opencode::OpenCodeStreamParser;

// ============================================================================
// StreamParser trait
// ============================================================================

/// Parses provider-specific stdout lines into structured log entries.
pub trait StreamParser: Send {
    /// Parse a single line from the agent's stdout.
    ///
    /// Returns zero or more `LogEntry` values extracted from this line.
    /// Non-parseable or irrelevant lines return an empty vec.
    fn parse_line(&mut self, line: &str) -> Vec<LogEntry>;

    /// Signal that the stream has ended. Returns any remaining buffered entries.
    fn finalize(&mut self) -> Vec<LogEntry>;

    /// Return the session ID extracted from the stream, if the provider generates
    /// its own (e.g. OpenCode's `ses_...` IDs). Returns `None` for providers where
    /// we set the session ID upfront (e.g. Claude Code).
    fn extracted_session_id(&self) -> Option<&str> {
        None
    }
}
