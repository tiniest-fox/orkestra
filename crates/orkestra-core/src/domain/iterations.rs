//! Unified stage iteration tracking for task lifecycle.
//!
//! This module provides a generic iteration system that works across all stages
//! (Plan, Breakdown, Work, Review). Key concepts:
//!
//! - **Stage**: An enum representing the workflow phase (Plan, Breakdown, Work, Review)
//! - **StageSession**: Tracks a Claude session for a task+stage (one session spans all iterations)
//! - **Iteration**: A single turn/attempt within a stage session
//! - **Outcome**: How an iteration ended (unified across all stages)
//!
//! Iterations are "turns" within a session. When we reject a plan and request changes,
//! we resume the same Claude conversation with feedback - we don't start a new conversation.

use serde::{Deserialize, Serialize};

use super::planner_questions::PlannerQuestion;

// =============================================================================
// Stage Enum
// =============================================================================

/// Core stage identifiers - compile-time checked.
///
/// Each stage represents a phase in the task workflow.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Stage {
    /// Planning phase - agent creates implementation plan
    Plan,
    /// Breakdown phase - agent decomposes complex task into subtasks
    Breakdown,
    /// Work phase - agent implements the approved plan
    Work,
    /// Review phase - automated review of completed work
    Review,
}

impl Stage {
    /// Convert to string representation for database storage.
    pub fn as_str(&self) -> &'static str {
        match self {
            Stage::Plan => "plan",
            Stage::Breakdown => "breakdown",
            Stage::Work => "work",
            Stage::Review => "review",
        }
    }

    /// Parse from string (for database loading).
    pub fn from_str(s: &str) -> Option<Self> {
        match s {
            "plan" => Some(Stage::Plan),
            "breakdown" => Some(Stage::Breakdown),
            "work" => Some(Stage::Work),
            "review" => Some(Stage::Review),
            _ => None,
        }
    }
}

impl std::fmt::Display for Stage {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "{}", self.as_str())
    }
}

// =============================================================================
// StageSession
// =============================================================================

/// Stage-level session tracking (one session per task + stage).
///
/// A single Claude session spans all iterations within a stage.
/// The session_id is stable across iterations - when we reject a plan,
/// we resume the same conversation with feedback.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct StageSession {
    /// The task this session belongs to.
    pub task_id: String,
    /// Which stage this session is for.
    pub stage: Stage,
    /// Claude session ID for resume functionality.
    pub session_id: Option<String>,
    /// Current agent process ID (if running).
    pub agent_pid: Option<u32>,
    /// When this stage session was created.
    pub started_at: String,
}

impl StageSession {
    /// Create a new stage session.
    pub fn new(task_id: String, stage: Stage, started_at: String) -> Self {
        Self {
            task_id,
            stage,
            session_id: None,
            agent_pid: None,
            started_at,
        }
    }

    /// Check if an agent is currently running for this session.
    pub fn is_running(&self) -> bool {
        self.agent_pid.is_some()
    }

    /// Check if this session can be resumed (has session_id, no running agent).
    pub fn can_resume(&self) -> bool {
        self.session_id.is_some() && self.agent_pid.is_none()
    }
}

// =============================================================================
// Iteration
// =============================================================================

/// A single iteration/turn within a stage session.
///
/// Each iteration represents one back-and-forth with the agent.
/// For example:
/// - Iteration 1: Agent outputs questions -> Outcome::NeedsAnswers
/// - Iteration 2: Agent outputs plan -> Outcome::AwaitingApproval
/// - Iteration 3: (after rejection) Agent outputs revised plan -> Outcome::Approved
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Iteration {
    /// The task this iteration belongs to.
    pub task_id: String,
    /// Which stage this iteration is in.
    pub stage: Stage,
    /// Sequential iteration number (1, 2, 3, ...).
    pub iteration: u32,
    /// When this iteration started.
    pub started_at: String,
    /// When this iteration ended (None if still in progress).
    pub ended_at: Option<String>,
    /// The data produced by the agent (JSON, stage-specific structure).
    pub data: Option<serde_json::Value>,
    /// How this iteration ended (None if still in progress).
    pub outcome: Option<Outcome>,
}

impl Iteration {
    /// Create a new iteration.
    pub fn new(task_id: String, stage: Stage, iteration: u32, started_at: String) -> Self {
        Self {
            task_id,
            stage,
            iteration,
            started_at,
            ended_at: None,
            data: None,
            outcome: None,
        }
    }

    /// Check if this iteration is still in progress.
    pub fn is_active(&self) -> bool {
        self.outcome.is_none()
    }

    /// Check if this iteration needs human review (has data but no outcome).
    pub fn needs_review(&self) -> bool {
        self.data.is_some() && self.outcome.is_none()
    }

    // =========================================================================
    // Stage-Specific Data Accessors
    // =========================================================================

    /// Get plan data (only valid for Plan stage).
    pub fn plan(&self) -> Option<String> {
        if self.stage != Stage::Plan {
            return None;
        }
        self.data
            .as_ref()?
            .get("plan")?
            .as_str()
            .map(String::from)
    }

    /// Get work summary (only valid for Work stage).
    pub fn summary(&self) -> Option<String> {
        if self.stage != Stage::Work {
            return None;
        }
        self.data
            .as_ref()?
            .get("summary")?
            .as_str()
            .map(String::from)
    }

    /// Get review verdict (only valid for Review stage).
    pub fn verdict(&self) -> Option<String> {
        if self.stage != Stage::Review {
            return None;
        }
        self.data
            .as_ref()?
            .get("verdict")?
            .as_str()
            .map(String::from)
    }

    /// Get breakdown plan (only valid for Breakdown stage).
    pub fn breakdown(&self) -> Option<serde_json::Value> {
        if self.stage != Stage::Breakdown {
            return None;
        }
        self.data.as_ref()?.get("breakdown").cloned()
    }

    /// Get questions from data (for NeedsAnswers outcome).
    pub fn questions(&self) -> Option<Vec<PlannerQuestion>> {
        let questions_value = self.data.as_ref()?.get("questions")?;
        serde_json::from_value(questions_value.clone()).ok()
    }
}

// =============================================================================
// Outcome
// =============================================================================

/// Unified outcome type - works for all stages.
///
/// This enum covers all possible ways an iteration can end.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum Outcome {
    // =========================================================================
    // Awaiting Human Decision
    // =========================================================================
    /// Agent produced output, awaiting human approval.
    AwaitingApproval,

    /// Agent asked questions, needs answers before continuing.
    /// The next iteration will include the answers in its data.
    NeedsAnswers,

    // =========================================================================
    // Human Decisions
    // =========================================================================
    /// Human approved the output.
    Approved,

    /// Human rejected the output with feedback.
    Rejected {
        feedback: String,
    },

    // =========================================================================
    // Automated Transitions
    // =========================================================================
    /// Work sent to automated review (human chose to use reviewer).
    SentToReview,

    /// Automated reviewer rejected the work.
    ReviewerRejected {
        feedback: String,
    },

    /// Integration (merge) failed.
    IntegrationFailed {
        error: String,
        conflict_files: Vec<String>,
    },

    // =========================================================================
    // Terminal Outcomes
    // =========================================================================
    /// Agent or task failed unrecoverably.
    Failed {
        reason: String,
    },

    /// Task is blocked on external dependency.
    Blocked {
        reason: String,
    },

    /// Stage was skipped (e.g., skip_breakdown flag).
    Skipped {
        reason: String,
    },
}

// =============================================================================
// Legacy Type Aliases (for migration compatibility)
// =============================================================================

// These types are kept for backwards compatibility during migration.
// They will be removed once all code is migrated to use the unified types.

/// Legacy: Represents one planning attempt.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PlanIteration {
    pub iteration: u32,
    pub started_at: String,
    pub plan: Option<String>,
    pub outcome: Option<PlanOutcome>,
}

/// Legacy: How a plan iteration ended.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum PlanOutcome {
    Approved,
    Rejected { feedback: String },
}

/// Legacy: Represents one work attempt.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct WorkIteration {
    pub iteration: u32,
    pub started_at: String,
    pub summary: Option<String>,
    pub outcome: Option<WorkOutcome>,
}

/// Legacy: How a work iteration ended.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum WorkOutcome {
    Approved,
    SentToReview,
    Rejected { feedback: String },
    ReviewerRejected { feedback: String },
    IntegrationFailed {
        error: String,
        conflict_files: Option<Vec<String>>,
    },
}

/// Legacy: Represents one automated review attempt.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ReviewIteration {
    pub iteration: u32,
    pub started_at: String,
    pub verdict: Option<String>,
    pub outcome: Option<ReviewOutcome>,
}

/// Legacy: How a review iteration ended.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum ReviewOutcome {
    Approved,
    Rejected { feedback: String },
}

// Legacy implementations for backwards compatibility
impl PlanIteration {
    pub fn new(iteration: u32, now: &str) -> Self {
        Self {
            iteration,
            started_at: now.to_string(),
            plan: None,
            outcome: None,
        }
    }

    pub fn is_active(&self) -> bool {
        self.outcome.is_none()
    }

    pub fn needs_review(&self) -> bool {
        self.plan.is_some() && self.outcome.is_none()
    }
}

impl WorkIteration {
    pub fn new(iteration: u32, now: &str) -> Self {
        Self {
            iteration,
            started_at: now.to_string(),
            summary: None,
            outcome: None,
        }
    }

    pub fn is_active(&self) -> bool {
        self.outcome.is_none()
    }

    pub fn needs_review(&self) -> bool {
        self.summary.is_some() && self.outcome.is_none()
    }
}

impl ReviewIteration {
    pub fn new(iteration: u32, now: &str) -> Self {
        Self {
            iteration,
            started_at: now.to_string(),
            verdict: None,
            outcome: None,
        }
    }

    pub fn is_active(&self) -> bool {
        self.outcome.is_none()
    }

    pub fn needs_review(&self) -> bool {
        self.verdict.is_some() && self.outcome.is_none()
    }
}

// =============================================================================
// Tests
// =============================================================================

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_stage_roundtrip() {
        for stage in [Stage::Plan, Stage::Breakdown, Stage::Work, Stage::Review] {
            let s = stage.as_str();
            let parsed = Stage::from_str(s).unwrap();
            assert_eq!(stage, parsed);
        }
    }

    #[test]
    fn test_stage_serde() {
        let stage = Stage::Plan;
        let json = serde_json::to_string(&stage).unwrap();
        assert_eq!(json, "\"plan\"");

        let parsed: Stage = serde_json::from_str(&json).unwrap();
        assert_eq!(parsed, Stage::Plan);
    }

    #[test]
    fn test_iteration_lifecycle() {
        let mut iter = Iteration::new(
            "task-1".to_string(),
            Stage::Plan,
            1,
            "2025-01-23T00:00:00Z".to_string(),
        );

        assert!(iter.is_active());
        assert!(!iter.needs_review());

        // Agent sets data
        iter.data = Some(serde_json::json!({"plan": "My plan"}));
        assert!(iter.is_active());
        assert!(iter.needs_review());

        // Human approves
        iter.outcome = Some(Outcome::Approved);
        iter.ended_at = Some("2025-01-23T01:00:00Z".to_string());
        assert!(!iter.is_active());
        assert!(!iter.needs_review());
    }

    #[test]
    fn test_iteration_plan_accessor() {
        let mut iter = Iteration::new(
            "task-1".to_string(),
            Stage::Plan,
            1,
            "2025-01-23T00:00:00Z".to_string(),
        );

        assert!(iter.plan().is_none());

        iter.data = Some(serde_json::json!({"plan": "Do X then Y"}));
        assert_eq!(iter.plan(), Some("Do X then Y".to_string()));

        // Wrong stage returns None even with plan data
        iter.stage = Stage::Work;
        assert!(iter.plan().is_none());
    }

    #[test]
    fn test_outcome_serialization() {
        let outcome = Outcome::IntegrationFailed {
            error: "Conflict".to_string(),
            conflict_files: vec!["a.rs".to_string()],
        };

        let json = serde_json::to_string(&outcome).unwrap();
        assert!(json.contains("\"type\":\"integration_failed\""));

        let parsed: Outcome = serde_json::from_str(&json).unwrap();
        assert!(matches!(parsed, Outcome::IntegrationFailed { .. }));
    }

    #[test]
    fn test_stage_session() {
        let mut session = StageSession::new(
            "task-1".to_string(),
            Stage::Plan,
            "2025-01-23T00:00:00Z".to_string(),
        );

        assert!(!session.is_running());
        assert!(!session.can_resume());

        session.session_id = Some("claude-session-123".to_string());
        assert!(!session.is_running());
        assert!(session.can_resume());

        session.agent_pid = Some(12345);
        assert!(session.is_running());
        assert!(!session.can_resume());
    }

    // Legacy tests for backwards compatibility
    #[test]
    fn test_legacy_plan_iteration_lifecycle() {
        let mut iter = PlanIteration::new(1, "2025-01-23T00:00:00Z");

        assert!(iter.is_active());
        assert!(!iter.needs_review());

        iter.plan = Some("My plan".to_string());
        assert!(iter.is_active());
        assert!(iter.needs_review());

        iter.outcome = Some(PlanOutcome::Approved);
        assert!(!iter.is_active());
        assert!(!iter.needs_review());
    }

    #[test]
    fn test_legacy_work_outcome_serialization() {
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
