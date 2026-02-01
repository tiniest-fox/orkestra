//! Iteration tracking for workflow stages.
//!
//! An iteration represents a single attempt at completing a stage.
//! Multiple iterations can occur when work is rejected and retried.

use serde::{Deserialize, Serialize};

use crate::workflow::runtime::Outcome;

use super::question::QuestionAnswer;

/// Why this iteration was created - determines the resume prompt type.
///
/// This is stored as `incoming_context` on an iteration to track why it exists.
/// The orchestrator reads this when spawning agents to send the appropriate resume prompt.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum IterationTrigger {
    /// Human rejected previous output.
    Feedback { feedback: String },
    /// Agent (reviewer) rejected and sent work back to this stage.
    Rejection {
        from_stage: String,
        feedback: String,
    },
    /// Integration (merge) failed.
    Integration {
        message: String,
        conflict_files: Vec<String>,
    },
    /// Human answered questions.
    Answers { answers: Vec<QuestionAnswer> },
    /// Crash recovery (session interrupted).
    Interrupted,
    /// Script stage failed and redirected to this stage.
    ScriptFailure { from_stage: String, error: String },
}

/// A single iteration (attempt) within a stage.
///
/// Tracks one agent execution cycle in a stage. Multiple iterations
/// occur when output is rejected and the agent retries.
///
/// All iterations in the same stage share a `StageSession` which maintains
/// Claude session continuity across rejections.
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

    /// Reference to the parent `StageSession`.
    /// Can be looked up by (`task_id`, stage) if not set.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub stage_session_id: Option<String>,

    /// Context explaining why this iteration was created.
    /// None = first iteration of stage (fresh start, no special context).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub incoming_context: Option<IterationTrigger>,

    /// Whether the `incoming_context` trigger has been delivered to the agent.
    /// Once delivered, crash recovery should use "session interrupted" instead of
    /// replaying the original trigger.
    #[serde(default)]
    pub trigger_delivered: bool,
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
            stage_session_id: None,
            incoming_context: None,
            trigger_delivered: false,
        }
    }

    /// Builder: set incoming context (why this iteration was created).
    #[must_use]
    pub fn with_context(mut self, context: IterationTrigger) -> Self {
        self.incoming_context = Some(context);
        self
    }

    /// Builder: set stage session ID reference.
    #[must_use]
    pub fn with_stage_session_id(mut self, stage_session_id: impl Into<String>) -> Self {
        self.stage_session_id = Some(stage_session_id.into());
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
    fn test_iteration_with_stage_session() {
        let iter = Iteration::new("iter-1", "task-1", "work", 1, "now")
            .with_stage_session_id("stage-session-abc");
        assert_eq!(iter.stage_session_id, Some("stage-session-abc".into()));
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
        iter.end("later", Outcome::rejected("work", "Tests are failing"));

        assert!(!iter.is_active());
        let outcome = iter.outcome().unwrap();
        assert_eq!(outcome.feedback(), Some("Tests are failing"));
    }

    #[test]
    fn test_iteration_serialization() {
        let iter = Iteration::new("iter-1", "task-1", "planning", 1, "2025-01-24T10:00:00Z")
            .with_stage_session_id("stage-session-123");

        let json = serde_json::to_string(&iter).unwrap();
        assert!(json.contains("\"id\":\"iter-1\""));
        assert!(json.contains("\"stage\":\"planning\""));
        assert!(json.contains("\"stage_session_id\":\"stage-session-123\""));

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
        assert!(!yaml.contains("stage_session_id:"));
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

    #[test]
    fn test_iteration_trigger_feedback() {
        let trigger = IterationTrigger::Feedback {
            feedback: "Tests are failing".to_string(),
        };
        let json = serde_json::to_string(&trigger).unwrap();
        assert!(json.contains("\"type\":\"feedback\""));
        assert!(json.contains("Tests are failing"));

        let parsed: IterationTrigger = serde_json::from_str(&json).unwrap();
        assert_eq!(parsed, trigger);
    }

    #[test]
    fn test_iteration_trigger_rejection() {
        let trigger = IterationTrigger::Rejection {
            from_stage: "review".to_string(),
            feedback: "Needs more tests".to_string(),
        };
        let json = serde_json::to_string(&trigger).unwrap();
        assert!(json.contains("\"type\":\"rejection\""));
        assert!(json.contains("\"from_stage\":\"review\""));

        let parsed: IterationTrigger = serde_json::from_str(&json).unwrap();
        assert_eq!(parsed, trigger);
    }

    #[test]
    fn test_iteration_trigger_integration() {
        let trigger = IterationTrigger::Integration {
            message: "Merge conflict".to_string(),
            conflict_files: vec!["src/main.rs".to_string()],
        };
        let json = serde_json::to_string(&trigger).unwrap();
        assert!(json.contains("\"type\":\"integration\""));
        assert!(json.contains("\"conflict_files\""));

        let parsed: IterationTrigger = serde_json::from_str(&json).unwrap();
        assert_eq!(parsed, trigger);
    }

    #[test]
    fn test_iteration_trigger_answers() {
        use super::super::question::QuestionAnswer;

        let trigger = IterationTrigger::Answers {
            answers: vec![QuestionAnswer::new("Which DB?", "PostgreSQL", "now")],
        };
        let json = serde_json::to_string(&trigger).unwrap();
        assert!(json.contains("\"type\":\"answers\""));
        assert!(json.contains("PostgreSQL"));

        let parsed: IterationTrigger = serde_json::from_str(&json).unwrap();
        assert_eq!(parsed, trigger);
    }

    #[test]
    fn test_iteration_trigger_interrupted() {
        let trigger = IterationTrigger::Interrupted;
        let json = serde_json::to_string(&trigger).unwrap();
        assert!(json.contains("\"type\":\"interrupted\""));

        let parsed: IterationTrigger = serde_json::from_str(&json).unwrap();
        assert_eq!(parsed, trigger);
    }

    #[test]
    fn test_iteration_with_context() {
        let iter = Iteration::new("iter-1", "task-1", "work", 2, "now").with_context(
            IterationTrigger::Feedback {
                feedback: "Add error handling".to_string(),
            },
        );

        assert!(iter.incoming_context.is_some());
        match &iter.incoming_context {
            Some(IterationTrigger::Feedback { feedback }) => {
                assert_eq!(feedback, "Add error handling");
            }
            _ => panic!("Expected Feedback trigger"),
        }
    }

    #[test]
    fn test_iteration_with_context_serialization() {
        let iter = Iteration::new("iter-1", "task-1", "work", 2, "now").with_context(
            IterationTrigger::Feedback {
                feedback: "Fix tests".to_string(),
            },
        );

        let json = serde_json::to_string(&iter).unwrap();
        assert!(json.contains("\"incoming_context\""));
        assert!(json.contains("\"type\":\"feedback\""));
        assert!(json.contains("Fix tests"));

        let parsed: Iteration = serde_json::from_str(&json).unwrap();
        assert_eq!(parsed, iter);
    }

    #[test]
    fn test_iteration_without_context_omits_field() {
        let iter = Iteration::new("iter-1", "task-1", "planning", 1, "now");
        let yaml = serde_yaml::to_string(&iter).unwrap();
        // incoming_context should be omitted when None
        assert!(!yaml.contains("incoming_context"));
    }

    #[test]
    fn test_iteration_trigger_script_failure() {
        let trigger = IterationTrigger::ScriptFailure {
            from_stage: "checks".to_string(),
            error: "npm test failed with exit code 1".to_string(),
        };
        let json = serde_json::to_string(&trigger).unwrap();
        assert!(json.contains("\"type\":\"script_failure\""));
        assert!(json.contains("\"from_stage\":\"checks\""));
        assert!(json.contains("npm test failed"));

        let parsed: IterationTrigger = serde_json::from_str(&json).unwrap();
        assert_eq!(parsed, trigger);
    }

    #[test]
    fn test_iteration_with_script_failure_context() {
        let iter = Iteration::new("iter-1", "task-1", "work", 2, "now").with_context(
            IterationTrigger::ScriptFailure {
                from_stage: "lint".to_string(),
                error: "eslint found 5 errors".to_string(),
            },
        );

        assert!(iter.incoming_context.is_some());
        match &iter.incoming_context {
            Some(IterationTrigger::ScriptFailure { from_stage, error }) => {
                assert_eq!(from_stage, "lint");
                assert!(error.contains("eslint"));
            }
            _ => panic!("Expected ScriptFailure trigger"),
        }
    }
}
