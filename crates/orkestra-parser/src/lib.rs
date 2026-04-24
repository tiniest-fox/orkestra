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
    ExtractionResult, ParsedUpdate, ResourceOutput, ResumeMarker, ResumeMarkerType, StageOutput,
    StageOutputError, SubtaskOutput,
};
