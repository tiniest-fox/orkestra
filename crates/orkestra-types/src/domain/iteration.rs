//! Iteration tracking for workflow stages.
//!
//! An iteration represents a single attempt at completing a stage.
//! Multiple iterations can occur when work is rejected and retried.

use serde::{Deserialize, Serialize};

use crate::runtime::Outcome;

use super::question::QuestionAnswer;

/// Output from a gate script run, attached to the iteration being validated.
///
/// Updated incrementally as output streams in during gate execution.
/// `exit_code` is None while running, set when the gate process exits.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct GateResult {
    /// All output lines accumulated during the gate run.
    pub lines: Vec<String>,
    /// Exit code — None while gate is running, set on completion.
    pub exit_code: Option<i32>,
    /// When the gate started (RFC3339).
    pub started_at: String,
    /// When the gate ended (RFC3339) — None while running.
    pub ended_at: Option<String>,
}

/// PR comment data stored in iteration trigger.
///
/// Captured at action time and passed through to the prompt builder.
/// This allows comments to be stored in the database and replayed on crash recovery.
///
/// Note: Despite the "PR" name, this type is used for both GitHub PR review comments
/// and locally-authored line comments from the task diff view. Both share the same
/// data shape and prompt rendering path — the naming reflects the original use case.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct PrCommentData {
    /// The author of the comment.
    pub author: String,
    /// The comment body text.
    pub body: String,
    /// The file path the comment is on (None for PR-level comments).
    pub path: Option<String>,
    /// The line number (if a line comment).
    pub line: Option<u32>,
}

/// Failed CI check data stored in iteration trigger.
///
/// Captured at action time and passed through to the prompt builder.
/// This allows checks to be stored in the database and replayed on crash recovery.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct PrCheckData {
    /// Name of the check (e.g., "CI / build").
    pub name: String,
    /// Failure summary from GitHub check run output (e.g., "3 tests failed").
    pub summary: Option<String>,
}

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
    /// User selected PR comments and/or failed CI checks to address.
    /// Old DB records with `pr_comments` type deserialize as this variant.
    #[serde(alias = "pr_comments")]
    PrFeedback {
        /// Selected comments to address (captured at action time).
        comments: Vec<PrCommentData>,
        /// Selected failed CI checks to address.
        #[serde(default)]
        checks: Vec<PrCheckData>,
        /// Optional guidance from the user.
        guidance: Option<String>,
    },
    /// Human answered questions.
    Answers { answers: Vec<QuestionAnswer> },
    /// Crash recovery (session interrupted).
    Interrupted,
    /// Gate script failed. The task re-queues with this error as context.
    /// Old DB records with `script_failure` type deserialize as this variant.
    #[serde(alias = "script_failure")]
    GateFailure { error: String },
    /// Human retried a failed task, optionally with instructions.
    RetryFailed { instructions: Option<String> },
    /// Human retried a blocked task, optionally with instructions.
    RetryBlocked { instructions: Option<String> },
    /// User interrupted and then resumed, optionally with a message.
    ManualResume { message: Option<String> },
    /// The user chatted with the agent and is now returning to structured work.
    ///
    /// Carries the optional final message the user typed before clicking
    /// "Return to Work", which is injected into the resume prompt so the
    /// agent sees it as a closing instruction.
    ReturnToWork { message: Option<String> },
    /// Human redirected the task to this stage from another stage.
    Redirect {
        /// The stage the task was redirected from.
        from_stage: String,
        /// Human-provided context explaining the redirect.
        message: String,
    },
    /// Human restarted the current stage for a fresh attempt.
    Restart {
        /// Human-provided context explaining the restart.
        message: String,
    },
    /// Task exited interactive mode and is returning to structured work.
    /// Old DB records with `interactive` type deserialize as this variant.
    #[serde(alias = "interactive")]
    ReturnFromInteractive,
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

    /// Short narrative summary of what the agent did during this iteration.
    /// Only present on work-completing outputs (artifact, approval, subtasks).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub activity_log: Option<String>,

    /// Gate script result for this iteration.
    /// Populated incrementally as the gate streams output; complete when `exit_code` is set.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub gate_result: Option<GateResult>,
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
            activity_log: None,
            gate_result: None,
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

    /// Builder: set activity log.
    #[must_use]
    pub fn with_activity_log(mut self, log: impl Into<String>) -> Self {
        self.activity_log = Some(log.into());
        self
    }

    /// Builder: set gate result.
    #[must_use]
    pub fn with_gate_result(mut self, gate_result: GateResult) -> Self {
        self.gate_result = Some(gate_result);
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
    fn test_iteration_trigger_script_failure_deserializes_as_gate_failure() {
        // Old DB records with script_failure type should deserialize as GateFailure
        let old_json =
            r#"{"type":"script_failure","from_stage":"checks","error":"npm test failed"}"#;
        let parsed: IterationTrigger = serde_json::from_str(old_json).unwrap();
        assert!(
            matches!(parsed, IterationTrigger::GateFailure { .. }),
            "Expected GateFailure from script_failure alias, got: {parsed:?}"
        );
    }

    #[test]
    fn test_iteration_trigger_manual_resume() {
        let trigger = IterationTrigger::ManualResume {
            message: Some("Fix the validation logic".to_string()),
        };
        let json = serde_json::to_string(&trigger).unwrap();
        assert!(json.contains("\"type\":\"manual_resume\""));
        assert!(json.contains("Fix the validation logic"));

        let parsed: IterationTrigger = serde_json::from_str(&json).unwrap();
        assert_eq!(parsed, trigger);
    }

    #[test]
    fn test_iteration_trigger_manual_resume_no_message() {
        let trigger = IterationTrigger::ManualResume { message: None };
        let json = serde_json::to_string(&trigger).unwrap();
        assert!(json.contains("\"type\":\"manual_resume\""));
        // message should be omitted or null when None
        assert!(json.contains("\"message\":null") || !json.contains("message"));

        let parsed: IterationTrigger = serde_json::from_str(&json).unwrap();
        assert_eq!(parsed, trigger);
    }

    #[test]
    fn test_iteration_with_manual_resume_context() {
        let iter = Iteration::new("iter-1", "task-1", "work", 2, "now").with_context(
            IterationTrigger::ManualResume {
                message: Some("Continue with tests".to_string()),
            },
        );

        assert!(iter.incoming_context.is_some());
        match &iter.incoming_context {
            Some(IterationTrigger::ManualResume { message }) => {
                assert_eq!(message.as_deref(), Some("Continue with tests"));
            }
            _ => panic!("Expected ManualResume trigger"),
        }
    }

    #[test]
    fn test_iteration_trigger_pr_feedback() {
        let trigger = IterationTrigger::PrFeedback {
            comments: vec![
                PrCommentData {
                    author: "reviewer1".to_string(),
                    body: "Fix this bug".to_string(),
                    path: Some("src/main.rs".to_string()),
                    line: Some(42),
                },
                PrCommentData {
                    author: "reviewer2".to_string(),
                    body: "Add tests".to_string(),
                    path: None,
                    line: None,
                },
            ],
            checks: vec![],
            guidance: Some("Focus on the performance comments".to_string()),
        };
        let json = serde_json::to_string(&trigger).unwrap();
        assert!(json.contains("\"type\":\"pr_feedback\""));
        assert!(json.contains("\"comments\""));
        assert!(json.contains("reviewer1"));
        assert!(json.contains("Fix this bug"));
        assert!(json.contains("Focus on the performance comments"));

        let parsed: IterationTrigger = serde_json::from_str(&json).unwrap();
        assert_eq!(parsed, trigger);
    }

    #[test]
    fn test_iteration_trigger_pr_feedback_no_guidance() {
        let trigger = IterationTrigger::PrFeedback {
            comments: vec![PrCommentData {
                author: "reviewer".to_string(),
                body: "Please fix".to_string(),
                path: Some("lib.rs".to_string()),
                line: Some(10),
            }],
            checks: vec![],
            guidance: None,
        };
        let json = serde_json::to_string(&trigger).unwrap();
        assert!(json.contains("\"type\":\"pr_feedback\""));
        assert!(json.contains("\"comments\""));
        // guidance should be null when None
        assert!(json.contains("\"guidance\":null") || !json.contains("\"guidance\""));

        let parsed: IterationTrigger = serde_json::from_str(&json).unwrap();
        assert_eq!(parsed, trigger);
    }

    #[test]
    fn test_iteration_trigger_gate_failure() {
        let trigger = IterationTrigger::GateFailure {
            error: "cargo clippy found 3 errors".to_string(),
        };
        let json = serde_json::to_string(&trigger).unwrap();
        assert!(json.contains("\"type\":\"gate_failure\""));
        assert!(json.contains("cargo clippy found 3 errors"));

        let parsed: IterationTrigger = serde_json::from_str(&json).unwrap();
        assert_eq!(parsed, trigger);
    }

    #[test]
    fn test_iteration_with_pr_feedback_context() {
        let iter = Iteration::new("iter-1", "task-1", "work", 2, "now").with_context(
            IterationTrigger::PrFeedback {
                comments: vec![PrCommentData {
                    author: "lead".to_string(),
                    body: "Address all comments".to_string(),
                    path: None,
                    line: None,
                }],
                checks: vec![],
                guidance: Some("Address all comments".to_string()),
            },
        );

        assert!(iter.incoming_context.is_some());
        match &iter.incoming_context {
            Some(IterationTrigger::PrFeedback {
                comments,
                checks,
                guidance,
            }) => {
                assert_eq!(comments.len(), 1);
                assert_eq!(comments[0].author, "lead");
                assert_eq!(checks.len(), 0);
                assert_eq!(guidance.as_deref(), Some("Address all comments"));
            }
            _ => panic!("Expected PrFeedback trigger"),
        }
    }

    #[test]
    fn test_iteration_trigger_pr_feedback_backward_compat() {
        // Old DB records with `pr_comments` type should deserialize as PrFeedback
        let old_json = r#"{"type":"pr_comments","comments":[{"author":"r","body":"fix","path":null,"line":null}],"guidance":null}"#;
        let parsed: IterationTrigger = serde_json::from_str(old_json).unwrap();
        match parsed {
            IterationTrigger::PrFeedback {
                comments,
                checks,
                guidance,
            } => {
                assert_eq!(comments.len(), 1);
                assert_eq!(checks.len(), 0);
                assert!(guidance.is_none());
            }
            _ => panic!("Expected PrFeedback trigger"),
        }
    }

    #[test]
    fn test_pr_check_data() {
        let check = PrCheckData {
            name: "CI / build".to_string(),
            summary: Some("3 tests failed".to_string()),
        };
        let json = serde_json::to_string(&check).unwrap();
        assert!(json.contains("CI / build"));
        assert!(json.contains("3 tests failed"));

        let parsed: PrCheckData = serde_json::from_str(&json).unwrap();
        assert_eq!(parsed, check);
    }

    #[test]
    fn test_iteration_trigger_pr_feedback_with_checks() {
        let trigger = IterationTrigger::PrFeedback {
            comments: vec![],
            checks: vec![PrCheckData {
                name: "CI / lint".to_string(),
                summary: Some("clippy: 2 warnings".to_string()),
            }],
            guidance: None,
        };
        let json = serde_json::to_string(&trigger).unwrap();
        assert!(json.contains("\"type\":\"pr_feedback\""));
        assert!(json.contains("CI / lint"));
        assert!(json.contains("clippy: 2 warnings"));

        let parsed: IterationTrigger = serde_json::from_str(&json).unwrap();
        assert_eq!(parsed, trigger);
    }
}
