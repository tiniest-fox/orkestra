//! Agent output schemas and prompt templates.

// Re-export schema generation from orkestra-schema
pub use orkestra_schema::examples;
pub use orkestra_schema::{generate_stage_schema, SchemaConfig, PLANNER_OUTPUT_SCHEMA};

/// System prompt for the assistant chat panel.
pub const ASSISTANT_SYSTEM_PROMPT: &str = include_str!("templates/assistant/system_prompt.md");

/// System prompt template for the task-scoped assistant chat panel.
///
/// Placeholders: `{task_id}`, `{task_title}`, `{task_description}`, `{current_stage}`, `{artifacts}`.
pub const TASK_ASSISTANT_SYSTEM_PROMPT: &str =
    include_str!("templates/assistant/task_system_prompt.md");

/// System prompt template for the interactive (vibe-mode) session.
///
/// Placeholders: `{task_id}`, `{task_title}`, `{task_description}`.
pub const INTERACTIVE_SYSTEM_PROMPT: &str =
    include_str!("templates/assistant/interactive_system_prompt.md");
