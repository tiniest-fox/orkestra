//! Stage iteration tracking for task lifecycle.
//!
//! Each stage (Planning, Working, Reviewing) has its own iteration history.
//! This provides a clear audit trail and scoped outputs per attempt.

use serde::{Deserialize, Serialize};

/// Represents one planning attempt.
///
/// A new PlanIteration is created when:
/// - Task enters Planning status for the first time
/// - Plan is rejected and needs revision
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PlanIteration {
    /// Sequential iteration number (1, 2, 3, ...)
    pub iteration: u32,
    /// When this iteration started (RFC3339)
    pub started_at: String,
    /// The plan produced by the planner agent (None if still working)
    pub plan: Option<String>,
    /// How this iteration ended (None if still in progress)
    pub outcome: Option<PlanOutcome>,
}

/// How a plan iteration ended.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum PlanOutcome {
    /// Plan was approved by human reviewer
    Approved,
    /// Plan was rejected by human reviewer
    Rejected { feedback: String },
}

/// Represents one work attempt.
///
/// A new WorkIteration is created when:
/// - Plan is approved and task enters Working status
/// - Work is rejected and needs revision
/// - Integration fails (merge conflict) and worker needs to fix
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct WorkIteration {
    /// Sequential iteration number (1, 2, 3, ...)
    pub iteration: u32,
    /// When this iteration started (RFC3339)
    pub started_at: String,
    /// The summary produced by the worker agent (None if still working)
    pub summary: Option<String>,
    /// How this iteration ended (None if still in progress)
    pub outcome: Option<WorkOutcome>,
}

/// How a work iteration ended.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum WorkOutcome {
    /// Human approved, task goes to Done (skip review)
    Approved,
    /// Human sent to automated review
    SentToReview,
    /// Human rejected work
    Rejected { feedback: String },
    /// Automated reviewer rejected work
    ReviewerRejected { feedback: String },
    /// Integration failed (merge conflict or error)
    IntegrationFailed {
        error: String,
        conflict_files: Option<Vec<String>>,
    },
}

/// Represents one automated review attempt.
///
/// A new ReviewIteration is created when:
/// - Work is approved and sent to automated review
/// - Reviewer rejects and worker fixes, then re-sent to review
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ReviewIteration {
    /// Sequential iteration number (1, 2, 3, ...)
    pub iteration: u32,
    /// When this iteration started (RFC3339)
    pub started_at: String,
    /// The verdict produced by the reviewer agent (None if still reviewing)
    pub verdict: Option<String>,
    /// How this iteration ended (None if still in progress)
    pub outcome: Option<ReviewOutcome>,
}

/// How a review iteration ended.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum ReviewOutcome {
    /// Reviewer approved the work
    Approved,
    /// Reviewer rejected the work
    Rejected { feedback: String },
}

impl PlanIteration {
    /// Create a new plan iteration starting now.
    pub fn new(iteration: u32, now: &str) -> Self {
        Self {
            iteration,
            started_at: now.to_string(),
            plan: None,
            outcome: None,
        }
    }

    /// Check if this iteration is still in progress.
    pub fn is_active(&self) -> bool {
        self.outcome.is_none()
    }

    /// Check if this iteration needs human review (has plan but no outcome).
    pub fn needs_review(&self) -> bool {
        self.plan.is_some() && self.outcome.is_none()
    }
}

impl WorkIteration {
    /// Create a new work iteration starting now.
    pub fn new(iteration: u32, now: &str) -> Self {
        Self {
            iteration,
            started_at: now.to_string(),
            summary: None,
            outcome: None,
        }
    }

    /// Check if this iteration is still in progress.
    pub fn is_active(&self) -> bool {
        self.outcome.is_none()
    }

    /// Check if this iteration needs human review (has summary but no outcome).
    pub fn needs_review(&self) -> bool {
        self.summary.is_some() && self.outcome.is_none()
    }
}

impl ReviewIteration {
    /// Create a new review iteration starting now.
    pub fn new(iteration: u32, now: &str) -> Self {
        Self {
            iteration,
            started_at: now.to_string(),
            verdict: None,
            outcome: None,
        }
    }

    /// Check if this iteration is still in progress.
    pub fn is_active(&self) -> bool {
        self.outcome.is_none()
    }

    /// Check if this iteration needs human review (has verdict but no outcome).
    pub fn needs_review(&self) -> bool {
        self.verdict.is_some() && self.outcome.is_none()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_plan_iteration_lifecycle() {
        let mut iter = PlanIteration::new(1, "2025-01-23T00:00:00Z");

        assert!(iter.is_active());
        assert!(!iter.needs_review());

        // Planner sets plan
        iter.plan = Some("My plan".to_string());
        assert!(iter.is_active());
        assert!(iter.needs_review());

        // Human approves
        iter.outcome = Some(PlanOutcome::Approved);
        assert!(!iter.is_active());
        assert!(!iter.needs_review());
    }

    #[test]
    fn test_work_iteration_lifecycle() {
        let mut iter = WorkIteration::new(1, "2025-01-23T00:00:00Z");

        assert!(iter.is_active());
        assert!(!iter.needs_review());

        // Worker sets summary
        iter.summary = Some("Work done".to_string());
        assert!(iter.is_active());
        assert!(iter.needs_review());

        // Integration fails
        iter.outcome = Some(WorkOutcome::IntegrationFailed {
            error: "Merge conflict".to_string(),
            conflict_files: Some(vec!["file.rs".to_string()]),
        });
        assert!(!iter.is_active());
        assert!(!iter.needs_review());
    }

    #[test]
    fn test_outcome_serialization() {
        let outcome = WorkOutcome::IntegrationFailed {
            error: "Conflict".to_string(),
            conflict_files: Some(vec!["a.rs".to_string()]),
        };

        let json = serde_json::to_string(&outcome).unwrap();
        assert!(json.contains("\"type\":\"integration_failed\""));

        let parsed: WorkOutcome = serde_json::from_str(&json).unwrap();
        assert!(matches!(parsed, WorkOutcome::IntegrationFailed { .. }));
    }
}
