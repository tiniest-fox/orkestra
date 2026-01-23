//! Work loop tracking for task lifecycle.
//!
//! A work loop represents one pass through the task lifecycle without interruption.
//! A new loop starts when work is rejected or encounters an error, providing
//! a history of the task's journey through the system.

use serde::{Deserialize, Serialize};

use super::TaskStatus;

/// Represents one pass through the task lifecycle.
///
/// A new loop starts when:
/// - Task is created (loop 1)
/// - Plan gets rejected
/// - Work gets rejected
/// - Integration fails (conflict/error)
/// - Agent encounters an error
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct WorkLoop {
    /// Sequential loop number (1, 2, 3, ...)
    pub loop_number: u32,
    /// When this loop started (RFC3339)
    pub started_at: String,
    /// When this loop ended (RFC3339), None if still in progress
    pub ended_at: Option<String>,
    /// What status the task was in when this loop started
    pub started_from: TaskStatus,
    /// How this loop ended, None if still in progress
    pub outcome: Option<LoopOutcome>,
}

/// How a work loop ended.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum LoopOutcome {
    /// Plan was rejected by human reviewer
    PlanRejected { feedback: String },
    /// Breakdown was rejected by human reviewer
    BreakdownRejected { feedback: String },
    /// Work was rejected by human reviewer
    WorkRejected { feedback: String },
    /// Work was rejected by automated reviewer agent
    ReviewerRejected { feedback: String },
    /// Integration failed (merge conflict, etc.)
    IntegrationFailed {
        error: String,
        conflict_files: Option<Vec<String>>,
    },
    /// Agent crashed/timed out/errored
    AgentError { error: String },
    /// Task was marked as blocked
    Blocked { reason: String },
    /// Task completed successfully (merged or no merge needed)
    Completed {
        /// When the branch was merged (if applicable)
        #[serde(skip_serializing_if = "Option::is_none")]
        merged_at: Option<String>,
        /// The merge commit SHA (if applicable)
        #[serde(skip_serializing_if = "Option::is_none")]
        commit_sha: Option<String>,
        /// The target branch merged into (if applicable)
        #[serde(skip_serializing_if = "Option::is_none")]
        target_branch: Option<String>,
    },
}

impl WorkLoop {
    /// Create a new work loop starting now.
    pub fn new(loop_number: u32, started_from: TaskStatus, now: &str) -> Self {
        Self {
            loop_number,
            started_at: now.to_string(),
            ended_at: None,
            started_from,
            outcome: None,
        }
    }

    /// End this loop with the given outcome.
    pub fn end(&mut self, outcome: LoopOutcome, now: &str) {
        self.ended_at = Some(now.to_string());
        self.outcome = Some(outcome);
    }

    /// Check if this loop is still in progress.
    pub fn is_active(&self) -> bool {
        self.outcome.is_none()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_new_loop() {
        let loop1 = WorkLoop::new(1, TaskStatus::Planning, "2025-01-01T00:00:00Z");
        assert_eq!(loop1.loop_number, 1);
        assert_eq!(loop1.started_from, TaskStatus::Planning);
        assert!(loop1.is_active());
        assert!(loop1.outcome.is_none());
    }

    #[test]
    fn test_end_loop() {
        let mut loop1 = WorkLoop::new(1, TaskStatus::Planning, "2025-01-01T00:00:00Z");
        loop1.end(
            LoopOutcome::PlanRejected {
                feedback: "Need more detail".to_string(),
            },
            "2025-01-01T01:00:00Z",
        );

        assert!(!loop1.is_active());
        assert!(loop1.ended_at.is_some());
        assert!(matches!(
            loop1.outcome,
            Some(LoopOutcome::PlanRejected { .. })
        ));
    }

    #[test]
    fn test_loop_outcome_serialization() {
        let outcome = LoopOutcome::IntegrationFailed {
            error: "Merge conflict".to_string(),
            conflict_files: Some(vec!["src/main.rs".to_string()]),
        };

        let json = serde_json::to_string(&outcome).unwrap();
        assert!(json.contains("\"type\":\"integration_failed\""));
        assert!(json.contains("\"conflict_files\""));

        let parsed: LoopOutcome = serde_json::from_str(&json).unwrap();
        assert!(matches!(parsed, LoopOutcome::IntegrationFailed { .. }));
    }
}
