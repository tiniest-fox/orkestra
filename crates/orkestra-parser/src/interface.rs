//! Agent parser trait defining the API contract.

use crate::types::ParsedUpdate;
use orkestra_types::domain::LogEntry;

/// Provider-specific agent output parser.
///
/// Each provider implements this trait to handle:
/// - **Stream parsing**: Converting raw stdout lines into `LogEntry` values
/// - **Output extraction**: Finding the structured JSON in the provider's raw output
///
/// The trait does NOT interpret the JSON type (questions vs artifact vs failed) —
/// that happens in `parse_stage_output::execute()`, the single centralized location.
pub trait AgentParser: Send {
    /// Parse one stdout line during streaming.
    ///
    /// Returns log entries for the UI and an optional session ID (extracted once
    /// for providers that generate their own IDs).
    fn parse_line(&mut self, line: &str) -> ParsedUpdate;

    /// Flush any buffered entries when the stream ends.
    fn finalize(&mut self) -> Vec<LogEntry>;

    /// Extract the structured output JSON string from the provider's raw output.
    ///
    /// Returns the raw JSON string (e.g., `{"type":"questions","questions":[...]}`).
    /// Does NOT interpret the type — that's `parse_stage_output::execute()`'s job.
    fn extract_output(&self, full_output: &str) -> Result<String, String>;
}
