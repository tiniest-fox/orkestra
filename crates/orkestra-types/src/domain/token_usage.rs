//! Token usage types for Claude Code session tracking.

use serde::{Deserialize, Serialize};

/// Raw token counts from a single Claude Code API call.
#[derive(Debug, Clone, Default, Serialize, Deserialize, PartialEq)]
pub struct TokenUsage {
    pub input_tokens: u64,
    pub output_tokens: u64,
    pub cache_creation_input_tokens: u64,
    pub cache_read_input_tokens: u64,
}

impl TokenUsage {
    /// Add another usage record into this one.
    pub fn add(&mut self, other: &TokenUsage) {
        self.input_tokens += other.input_tokens;
        self.output_tokens += other.output_tokens;
        self.cache_creation_input_tokens += other.cache_creation_input_tokens;
        self.cache_read_input_tokens += other.cache_read_input_tokens;
    }

    /// Sum of all four token fields.
    pub fn total(&self) -> u64 {
        self.input_tokens
            + self.output_tokens
            + self.cache_creation_input_tokens
            + self.cache_read_input_tokens
    }
}

/// Token usage for a single stage session.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SessionTokenUsage {
    pub session_id: String,
    pub stage: String,
    /// `None` if the session file is missing or the session has no Claude session ID.
    pub usage: Option<TokenUsage>,
}

/// Token usage for all sessions within a stage, with a stage subtotal.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct StageTokenUsage {
    pub stage: String,
    pub sessions: Vec<SessionTokenUsage>,
    pub total: TokenUsage,
}

/// Token usage for all stages in a task, with a trak-level total.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TaskTokenUsage {
    pub task_id: String,
    pub stages: Vec<StageTokenUsage>,
    pub total: TokenUsage,
}
