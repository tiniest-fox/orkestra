//! Iteration tracking for workflow stages.
//!
//! An iteration represents a single attempt at completing a stage.
//! Multiple iterations can occur when work is rejected and retried.

use serde::{Deserialize, Serialize};

use crate::workflow::runtime::Outcome;

/// A single iteration (attempt) within a stage.
///
/// Tracks one agent execution cycle in a stage. Multiple iterations
/// occur when output is rejected and the agent retries.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct Iteration {
    /// Unique identifier for this iteration.
    pub id: String,

    /// ID of the task this iteration belongs to.
    pub task_id: String,

    /// Stage name (e.g., "planning", "work").
    pub stage: String,

    /// Iteration number within this stage (1, 2, 3...).
    pub iteration_number: u32,

    /// When this iteration started (RFC3339).
    pub started_at: String,

    /// When this iteration ended (RFC3339), if complete.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub ended_at: Option<String>,

    /// How this iteration ended, if complete.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub outcome: Option<Outcome>,

    /// Claude session ID for resuming interrupted work.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub session_id: Option<String>,
}

impl Iteration {
    /// Create a new iteration.
    pub fn new(
        id: impl Into<String>,
        task_id: impl Into<String>,
        stage: impl Into<String>,
        iteration_number: u32,
        started_at: impl Into<String>,
    ) -> Self {
        Self {
            id: id.into(),
            task_id: task_id.into(),
            stage: stage.into(),
            iteration_number,
            started_at: started_at.into(),
            ended_at: None,
            outcome: None,
            session_id: None,
        }
    }

    /// Builder: set session ID.
    #[must_use]
    pub fn with_session_id(mut self, session_id: impl Into<String>) -> Self {
        self.session_id = Some(session_id.into());
        self
    }

    /// Check if this iteration is still active (not ended).
    pub fn is_active(&self) -> bool {
        self.ended_at.is_none()
    }

    /// Check if this iteration has output ready for review.
    pub fn is_awaiting_review(&self) -> bool {
        self.ended_at.is_some() && self.outcome.is_none()
    }

    /// End this iteration with an outcome.
    pub fn end(&mut self, ended_at: impl Into<String>, outcome: Outcome) {
        self.ended_at = Some(ended_at.into());
        self.outcome = Some(outcome);
    }

    /// Get the outcome if the iteration has ended.
    pub fn outcome(&self) -> Option<&Outcome> {
        self.outcome.as_ref()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_iteration_new() {
        let iter = Iteration::new("iter-1", "task-1", "planning", 1, "2025-01-24T10:00:00Z");
        assert_eq!(iter.id, "iter-1");
        assert_eq!(iter.task_id, "task-1");
        assert_eq!(iter.stage, "planning");
        assert_eq!(iter.iteration_number, 1);
        assert!(iter.is_active());
        assert!(!iter.is_awaiting_review());
    }

    #[test]
    fn test_iteration_with_session() {
        let iter = Iteration::new("iter-1", "task-1", "work", 1, "now")
            .with_session_id("session-abc");
        assert_eq!(iter.session_id, Some("session-abc".into()));
    }

    #[test]
    fn test_iteration_end() {
        let mut iter = Iteration::new("iter-1", "task-1", "planning", 1, "2025-01-24T10:00:00Z");
        assert!(iter.is_active());

        iter.end("2025-01-24T10:30:00Z", Outcome::Approved);
        assert!(!iter.is_active());
        assert!(matches!(iter.outcome(), Some(Outcome::Approved)));
    }

    #[test]
    fn test_iteration_rejection() {
        let mut iter = Iteration::new("iter-1", "task-1", "work", 1, "now");
        iter.end(
            "later",
            Outcome::rejected("work", "Tests are failing"),
        );

        assert!(!iter.is_active());
        let outcome = iter.outcome().unwrap();
        assert_eq!(outcome.feedback(), Some("Tests are failing"));
    }

    #[test]
    fn test_iteration_serialization() {
        let iter = Iteration::new("iter-1", "task-1", "planning", 1, "2025-01-24T10:00:00Z")
            .with_session_id("session-123");

        let json = serde_json::to_string(&iter).unwrap();
        assert!(json.contains("\"id\":\"iter-1\""));
        assert!(json.contains("\"stage\":\"planning\""));
        assert!(json.contains("\"session_id\":\"session-123\""));

        let parsed: Iteration = serde_json::from_str(&json).unwrap();
        assert_eq!(parsed, iter);
    }

    #[test]
    fn test_iteration_yaml_serialization() {
        let iter = Iteration::new("iter-1", "task-1", "work", 2, "2025-01-24T10:00:00Z");
        let yaml = serde_yaml::to_string(&iter).unwrap();

        assert!(yaml.contains("id: iter-1"));
        assert!(yaml.contains("iteration_number: 2"));
        // Optional fields should be omitted
        assert!(!yaml.contains("session_id:"));
        assert!(!yaml.contains("ended_at:"));

        let parsed: Iteration = serde_yaml::from_str(&yaml).unwrap();
        assert_eq!(parsed, iter);
    }

    #[test]
    fn test_iteration_with_outcome_serialization() {
        let mut iter = Iteration::new("iter-1", "task-1", "planning", 1, "start");
        iter.end("end", Outcome::Approved);

        let json = serde_json::to_string(&iter).unwrap();
        assert!(json.contains("\"outcome\""));
        assert!(json.contains("\"type\":\"approved\""));

        let parsed: Iteration = serde_json::from_str(&json).unwrap();
        assert_eq!(parsed, iter);
    }
}
