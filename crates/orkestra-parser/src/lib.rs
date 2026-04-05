//! Agent output parsing.
//!
//! Parses and validates structured output from Claude Code and `OpenCode` agents.
//! Pure logic, zero I/O. Follows the interface → service → interactions pattern.

mod claude;
pub mod interactions;
pub mod interface;
mod opencode;
pub mod types;

pub use claude::ClaudeParserService;
pub use interface::AgentParser;
pub use opencode::OpenCodeParserService;
pub use types::{
    ParsedUpdate, ResourceOutput, ResumeMarker, ResumeMarkerType, StageOutput, StageOutputError,
    SubtaskOutput,
};

/// Parse a completed agent's output into a `StageOutput`.
///
/// This is the single entry point for completion parsing:
/// 1. Calls `parser.extract_output()` (provider-specific JSON extraction)
/// 2. Calls `parse_stage_output::execute()` (centralized type interpretation)
pub fn parse_completion(
    parser: &dyn AgentParser,
    full_output: &str,
    schema: &serde_json::Value,
) -> Result<StageOutput, String> {
    let json_str = parser.extract_output(full_output)?;
    interactions::output::parse_stage_output::execute(&json_str, schema).map_err(|e| e.to_string())
}
