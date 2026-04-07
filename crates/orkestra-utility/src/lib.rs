//! Lightweight AI utility tasks for Orkestra.
//!
//! Provides title generation, commit message generation, and PR description
//! generation using Claude haiku. Each utility runs as a single-turn AI call
//! with structured JSON output and schema validation. Interactive mode is also
//! supported for tasks that require tool use in a working directory.

// Suppress pedantic clippy warnings we're not addressing yet
#![allow(clippy::missing_errors_doc)]
#![allow(clippy::must_use_candidate)]

pub mod commit_message;
pub mod pr_description;
pub mod runner;
pub mod title;

// -- Types --

/// Error type for utility task execution.
#[derive(Debug, Clone)]
pub enum UtilityError {
    /// Failed to spawn the Claude process.
    SpawnFailed(String),
    /// I/O error during communication.
    IoError(String),
    /// Task timed out.
    Timeout,
    /// Process completed but produced no parseable structured output.
    OutputNotFound(String),
    /// Failed to parse output.
    ParseError(String),
    /// Schema is invalid.
    SchemaError(String),
    /// Output failed schema validation.
    ValidationFailed(String),
    /// Task definition not found.
    TaskNotFound(String),
}

impl std::fmt::Display for UtilityError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::SpawnFailed(msg) => write!(f, "Failed to spawn process: {msg}"),
            Self::IoError(msg) => write!(f, "I/O error: {msg}"),
            Self::Timeout => write!(f, "Task timed out"),
            Self::OutputNotFound(msg) => write!(f, "Output not found: {msg}"),
            Self::ParseError(msg) => write!(f, "Parse error: {msg}"),
            Self::SchemaError(msg) => write!(f, "Schema error: {msg}"),
            Self::ValidationFailed(msg) => write!(f, "Validation failed: {msg}"),
            Self::TaskNotFound(name) => write!(f, "Task not found: {name}"),
        }
    }
}

impl std::error::Error for UtilityError {}

// -- Re-exports --

pub use commit_message::{
    collect_model_names, fallback_commit_message, format_commit_message,
    ClaudeCommitMessageGenerator, CommitMessageGenerator,
};
pub use orkestra_types::config::models::friendly_model_name;
pub use pr_description::{format_pr_footer, ClaudePrDescriptionGenerator, PrDescriptionGenerator};
pub use runner::{ExecutionMode, UtilityRunner};
pub use title::{
    generate_fallback_title, generate_title_sync, ClaudeTitleGenerator, TitleGenerator,
};

#[cfg(any(test, feature = "testutil"))]
pub use commit_message::mock::MockCommitMessageGenerator;
#[cfg(any(test, feature = "testutil"))]
pub use pr_description::mock::MockPrDescriptionGenerator;
#[cfg(any(test, feature = "testutil"))]
pub use title::mock::MockTitleGenerator;
