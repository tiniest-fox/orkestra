//! Token usage types for Claude Code session tracking.

use std::path::{Path, PathBuf};

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

/// Compute the path where Claude Code writes JSONL transcripts for a session.
///
/// Claude Code writes `~/.claude/projects/<encoded-cwd>/<session-id>.jsonl`
/// where encoded-cwd replaces every `/` or `.` with `-`. Replacing `.` is
/// necessary for paths containing hidden directories like `.orkestra`.
pub fn compute_transcript_path(home_dir: &Path, working_dir: &Path, session_id: &str) -> PathBuf {
    let encoded_cwd: String = working_dir
        .to_string_lossy()
        .chars()
        .map(|c| if c == '/' || c == '.' { '-' } else { c })
        .collect();
    home_dir
        .join(".claude")
        .join("projects")
        .join(encoded_cwd)
        .join(format!("{session_id}.jsonl"))
}

// ============================================================================
// Tests
// ============================================================================

#[cfg(test)]
mod tests {
    use super::*;
    use std::path::PathBuf;

    #[test]
    fn test_compute_transcript_path_encodes_slashes_and_dots() {
        let home = PathBuf::from("/home/user");
        let working_dir = PathBuf::from("/home/user/projects/.orkestra/.worktrees/my-task");
        let result = compute_transcript_path(&home, &working_dir, "abc-123");
        let expected = home
            .join(".claude")
            .join("projects")
            .join("-home-user-projects--orkestra--worktrees-my-task")
            .join("abc-123.jsonl");
        assert_eq!(result, expected);
    }

    #[test]
    fn test_compute_transcript_path_appends_jsonl_extension() {
        let home = PathBuf::from("/tmp");
        let working_dir = PathBuf::from("/tmp/project");
        let result = compute_transcript_path(&home, &working_dir, "session-xyz");
        assert!(result.to_string_lossy().ends_with("session-xyz.jsonl"));
    }
}
