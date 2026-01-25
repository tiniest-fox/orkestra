//! Generic workflow outcomes.
//!
//! Outcomes describe how a stage or loop ended. They are stage-agnostic,
//! using string stage names instead of hardcoded enum variants.

use serde::{Deserialize, Serialize};

/// How a work loop or iteration ended.
///
/// This is a stage-agnostic version of outcomes. Instead of having
/// `PlanRejected`, `WorkRejected`, etc., we have a single `StageRejected`
/// with the stage name as a field.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum Outcome {
    /// Stage output was approved by human or automated reviewer.
    Approved,

    /// Stage output was rejected with feedback.
    Rejected {
        /// The stage that was rejected.
        stage: String,
        /// Feedback explaining the rejection.
        feedback: String,
    },

    /// Stage is waiting for human to answer questions.
    AwaitingAnswers {
        /// The stage that asked questions.
        stage: String,
    },

    /// Task completed successfully.
    Completed {
        /// When the branch was merged (if applicable).
        #[serde(skip_serializing_if = "Option::is_none")]
        merged_at: Option<String>,
        /// The merge commit SHA (if applicable).
        #[serde(skip_serializing_if = "Option::is_none")]
        commit_sha: Option<String>,
        /// The target branch merged into (if applicable).
        #[serde(skip_serializing_if = "Option::is_none")]
        target_branch: Option<String>,
    },

    /// Integration (merge) failed.
    IntegrationFailed {
        /// Error message describing the failure.
        error: String,
        /// Files with merge conflicts (if applicable).
        #[serde(default, skip_serializing_if = "Vec::is_empty")]
        conflict_files: Vec<String>,
    },

    /// Agent encountered an error.
    AgentError {
        /// Error message from the agent.
        error: String,
    },

    /// Task was blocked on external dependency.
    Blocked {
        /// Reason for blocking.
        reason: String,
    },

    /// Stage was skipped.
    Skipped {
        /// The stage that was skipped.
        stage: String,
        /// Reason for skipping.
        reason: String,
    },

    /// Agent is restaging to a different stage.
    /// This is used when an agent (e.g., reviewer) redirects work to another stage.
    Restage {
        /// The stage that produced this outcome.
        from_stage: String,
        /// The target stage to transition to.
        target: String,
        /// Feedback explaining why restaging is needed.
        feedback: String,
    },
}

impl Outcome {
    /// Create a rejection outcome for a stage.
    pub fn rejected(stage: impl Into<String>, feedback: impl Into<String>) -> Self {
        Self::Rejected {
            stage: stage.into(),
            feedback: feedback.into(),
        }
    }

    /// Create a skipped outcome for a stage.
    pub fn skipped(stage: impl Into<String>, reason: impl Into<String>) -> Self {
        Self::Skipped {
            stage: stage.into(),
            reason: reason.into(),
        }
    }

    /// Create an awaiting answers outcome.
    pub fn awaiting_answers(stage: impl Into<String>) -> Self {
        Self::AwaitingAnswers {
            stage: stage.into(),
        }
    }

    /// Create a completed outcome without merge info.
    pub fn completed() -> Self {
        Self::Completed {
            merged_at: None,
            commit_sha: None,
            target_branch: None,
        }
    }

    /// Create a completed outcome with merge info.
    pub fn completed_with_merge(
        merged_at: impl Into<String>,
        commit_sha: impl Into<String>,
        target_branch: impl Into<String>,
    ) -> Self {
        Self::Completed {
            merged_at: Some(merged_at.into()),
            commit_sha: Some(commit_sha.into()),
            target_branch: Some(target_branch.into()),
        }
    }

    /// Create a restage outcome.
    pub fn restage(
        from_stage: impl Into<String>,
        target: impl Into<String>,
        feedback: impl Into<String>,
    ) -> Self {
        Self::Restage {
            from_stage: from_stage.into(),
            target: target.into(),
            feedback: feedback.into(),
        }
    }

    /// Get the feedback from a rejection or restage, if applicable.
    pub fn feedback(&self) -> Option<&str> {
        match self {
            Outcome::Rejected { feedback, .. } | Outcome::Restage { feedback, .. } => {
                Some(feedback)
            }
            _ => None,
        }
    }

    /// Get the stage name from this outcome, if applicable.
    pub fn stage(&self) -> Option<&str> {
        match self {
            Outcome::Rejected { stage, .. }
            | Outcome::AwaitingAnswers { stage }
            | Outcome::Skipped { stage, .. } => Some(stage),
            Outcome::Restage { from_stage, .. } => Some(from_stage),
            _ => None,
        }
    }

    /// Get the restage target, if this is a restage outcome.
    pub fn restage_target(&self) -> Option<&str> {
        match self {
            Outcome::Restage { target, .. } => Some(target),
            _ => None,
        }
    }

    /// Check if this is a terminal outcome (task is done).
    pub fn is_terminal(&self) -> bool {
        matches!(
            self,
            Outcome::Completed { .. } | Outcome::Blocked { .. }
        )
    }

    /// Check if this outcome requires restarting the stage.
    pub fn requires_retry(&self) -> bool {
        matches!(
            self,
            Outcome::Rejected { .. } | Outcome::IntegrationFailed { .. } | Outcome::AgentError { .. }
        )
    }
}

impl std::fmt::Display for Outcome {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Outcome::Approved => write!(f, "approved"),
            Outcome::Rejected { stage, .. } => write!(f, "{stage} rejected"),
            Outcome::AwaitingAnswers { stage } => write!(f, "{stage} awaiting answers"),
            Outcome::Completed { .. } => write!(f, "completed"),
            Outcome::IntegrationFailed { .. } => write!(f, "integration failed"),
            Outcome::AgentError { .. } => write!(f, "agent error"),
            Outcome::Blocked { .. } => write!(f, "blocked"),
            Outcome::Skipped { stage, .. } => write!(f, "{stage} skipped"),
            Outcome::Restage { target, .. } => write!(f, "restage to {target}"),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_rejected_outcome() {
        let outcome = Outcome::rejected("planning", "Need more detail");
        assert_eq!(outcome.feedback(), Some("Need more detail"));
        assert_eq!(outcome.stage(), Some("planning"));
        assert!(outcome.requires_retry());
        assert!(!outcome.is_terminal());
    }

    #[test]
    fn test_completed_outcome() {
        let outcome = Outcome::completed();
        assert!(outcome.is_terminal());
        assert!(!outcome.requires_retry());
        assert!(outcome.feedback().is_none());
    }

    #[test]
    fn test_completed_with_merge() {
        let outcome = Outcome::completed_with_merge(
            "2025-01-01T00:00:00Z",
            "abc123",
            "main",
        );
        match outcome {
            Outcome::Completed { merged_at, commit_sha, target_branch } => {
                assert_eq!(merged_at, Some("2025-01-01T00:00:00Z".into()));
                assert_eq!(commit_sha, Some("abc123".into()));
                assert_eq!(target_branch, Some("main".into()));
            }
            _ => panic!("Expected Completed variant"),
        }
    }

    #[test]
    fn test_skipped_outcome() {
        let outcome = Outcome::skipped("breakdown", "Task is simple");
        assert_eq!(outcome.stage(), Some("breakdown"));
        assert!(!outcome.requires_retry());
    }

    #[test]
    fn test_integration_failed() {
        let outcome = Outcome::IntegrationFailed {
            error: "Merge conflict".into(),
            conflict_files: vec!["src/main.rs".into()],
        };
        assert!(outcome.requires_retry());
        assert!(!outcome.is_terminal());
    }

    #[test]
    fn test_outcome_serialization() {
        let outcome = Outcome::rejected("planning", "Need more detail");
        let json = serde_json::to_string(&outcome).unwrap();

        assert!(json.contains("\"type\":\"rejected\""));
        assert!(json.contains("\"stage\":\"planning\""));
        assert!(json.contains("\"feedback\":\"Need more detail\""));

        let parsed: Outcome = serde_json::from_str(&json).unwrap();
        assert_eq!(parsed, outcome);
    }

    #[test]
    fn test_outcome_yaml_serialization() {
        let outcome = Outcome::rejected("work", "Tests failing");
        let yaml = serde_yaml::to_string(&outcome).unwrap();

        assert!(yaml.contains("type: rejected"));
        assert!(yaml.contains("stage: work"));

        let parsed: Outcome = serde_yaml::from_str(&yaml).unwrap();
        assert_eq!(parsed, outcome);
    }

    #[test]
    fn test_restage_outcome() {
        let outcome = Outcome::restage("review", "work", "Tests are failing");
        assert_eq!(outcome.stage(), Some("review"));
        assert_eq!(outcome.restage_target(), Some("work"));
        assert_eq!(outcome.feedback(), Some("Tests are failing"));
        assert!(!outcome.is_terminal());
        assert!(!outcome.requires_retry()); // Restage is not a retry, it's a redirect
    }

    #[test]
    fn test_restage_serialization() {
        let outcome = Outcome::restage("review", "work", "Fix the tests");
        let json = serde_json::to_string(&outcome).unwrap();

        assert!(json.contains("\"type\":\"restage\""));
        assert!(json.contains("\"from_stage\":\"review\""));
        assert!(json.contains("\"target\":\"work\""));
        assert!(json.contains("\"feedback\":\"Fix the tests\""));

        let parsed: Outcome = serde_json::from_str(&json).unwrap();
        assert_eq!(parsed, outcome);
    }

    #[test]
    fn test_restage_display() {
        let outcome = Outcome::restage("review", "work", "feedback");
        assert_eq!(outcome.to_string(), "restage to work");
    }
}
