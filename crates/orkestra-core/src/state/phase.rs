//! Explicit phase tracking for tasks.
//!
//! The `TaskPhase` enum eliminates ambiguity about what state a task is in
//! within a given status. Instead of inferring phase from field values
//! (e.g., `Working` + `summary.is_some()` = awaiting review), we track it explicitly.

use serde::{Deserialize, Serialize};

/// Explicit phase within a status - eliminates field-based inference.
///
/// This provides a single source of truth for what's happening with a task:
/// - `Idle`: Between phases or in terminal states
/// - `AgentWorking`: An agent process is actively running
/// - `AwaitingReview`: Output ready, waiting for human decision
/// - `Integrating`: Merging branch back to primary
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum TaskPhase {
    /// Task is between phases, in a terminal state, or waiting for orchestrator.
    /// This is the default/reset state.
    #[default]
    Idle,

    /// An agent process is currently running for this task.
    /// Set immediately when spawning, cleared when agent exits.
    AgentWorking,

    /// Agent output is ready and waiting for human review/decision.
    /// Examples: plan needs approval, work needs review, breakdown needs approval.
    AwaitingReview,

    /// Task is Done and its branch is being merged back to primary.
    /// Temporary state during the integration process.
    Integrating,
}

impl TaskPhase {
    /// Check if the task is waiting for human input.
    pub fn needs_human_action(&self) -> bool {
        matches!(self, TaskPhase::AwaitingReview)
    }

    /// Check if an agent is actively working on this task.
    pub fn has_active_agent(&self) -> bool {
        matches!(self, TaskPhase::AgentWorking)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_default_is_idle() {
        assert_eq!(TaskPhase::default(), TaskPhase::Idle);
    }

    #[test]
    fn test_needs_human_action() {
        assert!(!TaskPhase::Idle.needs_human_action());
        assert!(!TaskPhase::AgentWorking.needs_human_action());
        assert!(TaskPhase::AwaitingReview.needs_human_action());
        assert!(!TaskPhase::Integrating.needs_human_action());
    }

    #[test]
    fn test_has_active_agent() {
        assert!(!TaskPhase::Idle.has_active_agent());
        assert!(TaskPhase::AgentWorking.has_active_agent());
        assert!(!TaskPhase::AwaitingReview.has_active_agent());
        assert!(!TaskPhase::Integrating.has_active_agent());
    }

    #[test]
    fn test_serialization() {
        let phase = TaskPhase::AwaitingReview;
        let json = serde_json::to_string(&phase).unwrap();
        assert_eq!(json, "\"awaiting_review\"");

        let parsed: TaskPhase = serde_json::from_str(&json).unwrap();
        assert_eq!(parsed, TaskPhase::AwaitingReview);
    }
}
