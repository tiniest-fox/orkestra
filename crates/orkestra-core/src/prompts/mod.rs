//! Agent output schemas and prompt templates.

// Re-export schema generation from orkestra-schema
pub use orkestra_schema::examples;
pub use orkestra_schema::{generate_stage_schema, SchemaConfig, PLANNER_OUTPUT_SCHEMA};

/// System prompt for the assistant chat panel.
pub const ASSISTANT_SYSTEM_PROMPT: &str = include_str!("templates/assistant/system_prompt.md");
