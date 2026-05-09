//! SQL serialization helpers for domain enums and internal record types.
//!
//! Converts between Rust domain types and their string representations
//! used in `SQLite` columns. Also defines internal record types that live
//! only in the persistence layer.

use std::fmt;
use std::str::FromStr;

use orkestra_types::domain::SessionState;

// ============================================================================
// Worktree record types
// ============================================================================

/// Status of a prewarmed worktree.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum WorktreeStatus {
    /// Worktree creation is in progress.
    Pending,
    /// Worktree is ready for adoption by a task.
    Ready,
}

impl fmt::Display for WorktreeStatus {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            WorktreeStatus::Pending => write!(f, "pending"),
            WorktreeStatus::Ready => write!(f, "ready"),
        }
    }
}

impl FromStr for WorktreeStatus {
    type Err = String;

    fn from_str(s: &str) -> Result<Self, Self::Err> {
        match s {
            "pending" => Ok(WorktreeStatus::Pending),
            "ready" => Ok(WorktreeStatus::Ready),
            other => Err(format!("unknown worktree status: {other:?}")),
        }
    }
}

/// A prewarmed worktree record stored in the `worktrees` table.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct WorktreeRecord {
    /// Petname ID — matches the task ID that will adopt this worktree.
    pub task_id: String,
    /// Current status of the worktree.
    pub status: WorktreeStatus,
    /// Base branch used when creating the worktree.
    pub base_branch: Option<String>,
    /// Absolute path to the worktree on disk.
    pub worktree_path: Option<String>,
    /// Branch name created for this worktree (e.g. `task/my-id`).
    pub branch_name: Option<String>,
    /// Git commit SHA of the base branch at worktree creation time.
    pub base_commit: Option<String>,
    /// ISO 8601 timestamp when the record was created.
    pub created_at: String,
}

/// Convert a `SessionState` to its database string representation.
pub fn session_state_to_str(state: SessionState) -> &'static str {
    match state {
        SessionState::Spawning => "spawning",
        SessionState::Active => "active",
        SessionState::Completed => "completed",
        SessionState::Abandoned => "abandoned",
        SessionState::Superseded => "superseded",
    }
}

/// Parse a `SessionState` from its database string representation.
pub fn parse_session_state(s: &str) -> SessionState {
    match s {
        "spawning" => SessionState::Spawning,
        "completed" => SessionState::Completed,
        "abandoned" => SessionState::Abandoned,
        "superseded" => SessionState::Superseded,
        _ => SessionState::Active,
    }
}
