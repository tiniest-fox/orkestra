//! Workflow transition logic.
//!
//! Transitions move a task from one stage to another based on outcomes.
//! This module provides validation and computation of transitions.

use serde::{Deserialize, Serialize};

use super::status::{Phase, Status};
use crate::workflow::config::WorkflowConfig;

/// A transition from one state to another.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct Transition {
    /// Previous status.
    pub from: Status,
    /// New status after transition.
    pub to: Status,
    /// Previous phase.
    pub from_phase: Phase,
    /// New phase after transition.
    pub to_phase: Phase,
    /// What triggered this transition.
    pub trigger: TransitionTrigger,
}

/// What triggered a transition.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum TransitionTrigger {
    /// Human approved the stage output.
    Approved,
    /// Human rejected with feedback.
    Rejected { feedback: String },
    /// Human answered questions.
    QuestionsAnswered,
    /// Stage was skipped.
    Skipped { reason: String },
    /// Agent finished working.
    AgentCompleted,
    /// Agent produced output.
    AgentOutput,
    /// Agent restaged to a different stage.
    Restage { target: String, feedback: String },
    /// Task failed.
    Failed { error: String },
    /// Task was blocked.
    Blocked { reason: String },
    /// All children completed.
    ChildrenCompleted,
}

impl Transition {
    /// Create a new transition.
    pub fn new(
        from: Status,
        to: Status,
        from_phase: Phase,
        to_phase: Phase,
        trigger: TransitionTrigger,
    ) -> Self {
        Self {
            from,
            to,
            from_phase,
            to_phase,
            trigger,
        }
    }
}

/// Validates and computes transitions based on workflow configuration.
pub struct TransitionValidator<'a> {
    workflow: &'a WorkflowConfig,
}

impl<'a> TransitionValidator<'a> {
    /// Create a new validator for the given workflow.
    pub fn new(workflow: &'a WorkflowConfig) -> Self {
        Self { workflow }
    }

    /// Compute the next status after approval.
    pub fn next_status_on_approve(
        &self,
        current_stage: &str,
        skip_optional_next: bool,
    ) -> Status {
        // Find the next stage
        if let Some(next_stage) = self.workflow.next_stage(current_stage) {
            // Skip optional stages if requested
            if next_stage.is_optional && skip_optional_next {
                // Try to find the next non-optional stage
                return self.next_status_on_approve(&next_stage.name, false);
            }
            Status::active(&next_stage.name)
        } else {
            // No more stages - task is done
            Status::Done
        }
    }

    /// Compute the transition for an approval.
    pub fn approve(
        &self,
        current_status: &Status,
        current_phase: Phase,
        skip_optional: bool,
    ) -> Result<Transition, TransitionError> {
        let current_stage = current_status
            .stage()
            .ok_or(TransitionError::NotInStage)?;

        // Must be awaiting review to approve
        if current_phase != Phase::AwaitingReview {
            return Err(TransitionError::InvalidPhase {
                expected: Phase::AwaitingReview,
                actual: current_phase,
            });
        }

        let next_status = self.next_status_on_approve(current_stage, skip_optional);

        Ok(Transition::new(
            current_status.clone(),
            next_status,
            current_phase,
            Phase::Idle,
            TransitionTrigger::Approved,
        ))
    }

    /// Compute the transition for a rejection.
    pub fn reject(
        &self,
        current_status: &Status,
        current_phase: Phase,
        feedback: impl Into<String>,
    ) -> Result<Transition, TransitionError> {
        let current_stage = current_status
            .stage()
            .ok_or(TransitionError::NotInStage)?;

        // Must be awaiting review to reject
        if current_phase != Phase::AwaitingReview {
            return Err(TransitionError::InvalidPhase {
                expected: Phase::AwaitingReview,
                actual: current_phase,
            });
        }

        // Stay in the same stage for retry
        Ok(Transition::new(
            current_status.clone(),
            Status::active(current_stage),
            current_phase,
            Phase::Idle,
            TransitionTrigger::Rejected {
                feedback: feedback.into(),
            },
        ))
    }

    /// Compute the transition for skipping a stage.
    pub fn skip(
        &self,
        current_status: &Status,
        current_phase: Phase,
        reason: impl Into<String>,
    ) -> Result<Transition, TransitionError> {
        let current_stage = current_status
            .stage()
            .ok_or(TransitionError::NotInStage)?;

        // Verify the stage is optional
        let stage_config = self
            .workflow
            .stage(current_stage)
            .ok_or_else(|| TransitionError::UnknownStage(current_stage.into()))?;

        if !stage_config.is_optional {
            return Err(TransitionError::CannotSkip(current_stage.into()));
        }

        let next_status = self.next_status_on_approve(current_stage, false);

        Ok(Transition::new(
            current_status.clone(),
            next_status,
            current_phase,
            Phase::Idle,
            TransitionTrigger::Skipped {
                reason: reason.into(),
            },
        ))
    }

    /// Compute the transition when agent produces output.
    pub fn agent_output(
        &self,
        current_status: &Status,
        current_phase: Phase,
    ) -> Result<Transition, TransitionError> {
        // Must be agent working
        if current_phase != Phase::AgentWorking {
            return Err(TransitionError::InvalidPhase {
                expected: Phase::AgentWorking,
                actual: current_phase,
            });
        }

        let stage = current_status
            .stage()
            .ok_or(TransitionError::NotInStage)?;

        let stage_config = self
            .workflow
            .stage(stage)
            .ok_or_else(|| TransitionError::UnknownStage(stage.into()))?;

        // Determine next phase based on stage config
        let next_phase = if stage_config.is_automated {
            // Automated stages don't need human review
            Phase::Idle
        } else {
            Phase::AwaitingReview
        };

        Ok(Transition::new(
            current_status.clone(),
            current_status.clone(),
            current_phase,
            next_phase,
            TransitionTrigger::AgentOutput,
        ))
    }

    /// Compute the transition when marking failed.
    pub fn fail(
        &self,
        current_status: &Status,
        current_phase: Phase,
        error: impl Into<String>,
    ) -> Result<Transition, TransitionError> {
        if current_status.is_terminal() {
            return Err(TransitionError::AlreadyTerminal);
        }

        let error_str = error.into();
        Ok(Transition::new(
            current_status.clone(),
            Status::failed(&error_str),
            current_phase,
            Phase::Idle,
            TransitionTrigger::Failed { error: error_str },
        ))
    }

    /// Compute the transition when marking blocked.
    pub fn block(
        &self,
        current_status: &Status,
        current_phase: Phase,
        reason: impl Into<String>,
    ) -> Result<Transition, TransitionError> {
        if current_status.is_terminal() {
            return Err(TransitionError::AlreadyTerminal);
        }

        let reason_str = reason.into();
        Ok(Transition::new(
            current_status.clone(),
            Status::blocked(&reason_str),
            current_phase,
            Phase::Idle,
            TransitionTrigger::Blocked { reason: reason_str },
        ))
    }

    /// Compute the transition when agent restages to a different stage.
    ///
    /// This is used when an automated agent (e.g., reviewer) redirects work to another stage.
    /// The current stage must have the target stage in its `supports_restage` capability.
    pub fn restage(
        &self,
        current_status: &Status,
        current_phase: Phase,
        target: impl Into<String>,
        feedback: impl Into<String>,
    ) -> Result<Transition, TransitionError> {
        let current_stage = current_status
            .stage()
            .ok_or(TransitionError::NotInStage)?;

        let target_str = target.into();
        let feedback_str = feedback.into();

        // Verify the current stage has restage capability for the target
        let stage_config = self
            .workflow
            .stage(current_stage)
            .ok_or_else(|| TransitionError::UnknownStage(current_stage.into()))?;

        if !stage_config.capabilities.can_restage_to(&target_str) {
            return Err(TransitionError::CannotRestage {
                from: current_stage.into(),
                target: target_str,
            });
        }

        // Verify the target stage exists
        if self.workflow.stage(&target_str).is_none() {
            return Err(TransitionError::UnknownStage(target_str));
        }

        Ok(Transition::new(
            current_status.clone(),
            Status::active(&target_str),
            current_phase,
            Phase::Idle,
            TransitionTrigger::Restage {
                target: target_str,
                feedback: feedback_str,
            },
        ))
    }
}

/// Error during transition validation.
#[derive(Debug, Clone, thiserror::Error, PartialEq)]
pub enum TransitionError {
    #[error("Task is not in an active stage")]
    NotInStage,

    #[error("Unknown stage: {0}")]
    UnknownStage(String),

    #[error("Invalid phase: expected {expected:?}, got {actual:?}")]
    InvalidPhase { expected: Phase, actual: Phase },

    #[error("Cannot skip non-optional stage: {0}")]
    CannotSkip(String),

    #[error("Task is already in terminal state")]
    AlreadyTerminal,

    #[error("Stage '{from}' cannot restage to '{target}' (not in supports_restage)")]
    CannotRestage { from: String, target: String },
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::workflow::config::{StageCapabilities, StageConfig};

    fn test_workflow() -> WorkflowConfig {
        WorkflowConfig::new(vec![
            StageConfig::new("planning", "plan")
                .with_capabilities(StageCapabilities::with_questions()),
            StageConfig::new("breakdown", "breakdown")
                .with_inputs(vec!["plan".into()])
                .optional(),
            StageConfig::new("work", "summary").with_inputs(vec!["plan".into()]),
            StageConfig::new("review", "verdict")
                .with_inputs(vec!["summary".into()])
                .automated(),
        ])
    }

    #[test]
    fn test_approve_moves_to_next_stage() {
        let workflow = test_workflow();
        let validator = TransitionValidator::new(&workflow);

        let status = Status::active("planning");
        let transition = validator.approve(&status, Phase::AwaitingReview, false).unwrap();

        assert_eq!(transition.to, Status::active("breakdown"));
        assert_eq!(transition.to_phase, Phase::Idle);
        assert!(matches!(transition.trigger, TransitionTrigger::Approved));
    }

    #[test]
    fn test_approve_skips_optional_stage() {
        let workflow = test_workflow();
        let validator = TransitionValidator::new(&workflow);

        let status = Status::active("planning");
        let transition = validator.approve(&status, Phase::AwaitingReview, true).unwrap();

        // Should skip breakdown (optional) and go to work
        assert_eq!(transition.to, Status::active("work"));
    }

    #[test]
    fn test_approve_last_stage_goes_to_done() {
        let workflow = test_workflow();
        let validator = TransitionValidator::new(&workflow);

        let status = Status::active("review");
        let transition = validator.approve(&status, Phase::AwaitingReview, false).unwrap();

        assert_eq!(transition.to, Status::Done);
    }

    #[test]
    fn test_approve_requires_awaiting_review() {
        let workflow = test_workflow();
        let validator = TransitionValidator::new(&workflow);

        let status = Status::active("planning");
        let result = validator.approve(&status, Phase::Idle, false);

        assert!(matches!(result, Err(TransitionError::InvalidPhase { .. })));
    }

    #[test]
    fn test_reject_stays_in_stage() {
        let workflow = test_workflow();
        let validator = TransitionValidator::new(&workflow);

        let status = Status::active("planning");
        let transition = validator
            .reject(&status, Phase::AwaitingReview, "Need more detail")
            .unwrap();

        assert_eq!(transition.to, Status::active("planning"));
        assert_eq!(transition.to_phase, Phase::Idle);
        assert!(matches!(
            transition.trigger,
            TransitionTrigger::Rejected { .. }
        ));
    }

    #[test]
    fn test_skip_optional_stage() {
        let workflow = test_workflow();
        let validator = TransitionValidator::new(&workflow);

        let status = Status::active("breakdown");
        let transition = validator.skip(&status, Phase::Idle, "Simple task").unwrap();

        assert_eq!(transition.to, Status::active("work"));
        assert!(matches!(transition.trigger, TransitionTrigger::Skipped { .. }));
    }

    #[test]
    fn test_skip_non_optional_fails() {
        let workflow = test_workflow();
        let validator = TransitionValidator::new(&workflow);

        let status = Status::active("planning");
        let result = validator.skip(&status, Phase::Idle, "reason");

        assert!(matches!(result, Err(TransitionError::CannotSkip(_))));
    }

    #[test]
    fn test_agent_output_for_normal_stage() {
        let workflow = test_workflow();
        let validator = TransitionValidator::new(&workflow);

        let status = Status::active("planning");
        let transition = validator.agent_output(&status, Phase::AgentWorking).unwrap();

        // Normal stage goes to awaiting review
        assert_eq!(transition.to_phase, Phase::AwaitingReview);
    }

    #[test]
    fn test_agent_output_for_automated_stage() {
        let workflow = test_workflow();
        let validator = TransitionValidator::new(&workflow);

        let status = Status::active("review");
        let transition = validator.agent_output(&status, Phase::AgentWorking).unwrap();

        // Automated stage goes to idle (no human review needed)
        assert_eq!(transition.to_phase, Phase::Idle);
    }

    #[test]
    fn test_fail_transition() {
        let workflow = test_workflow();
        let validator = TransitionValidator::new(&workflow);

        let status = Status::active("work");
        let transition = validator.fail(&status, Phase::AgentWorking, "Error").unwrap();

        assert!(matches!(transition.to, Status::Failed { .. }));
    }

    #[test]
    fn test_fail_already_terminal() {
        let workflow = test_workflow();
        let validator = TransitionValidator::new(&workflow);

        let status = Status::Done;
        let result = validator.fail(&status, Phase::Idle, "Error");

        assert!(matches!(result, Err(TransitionError::AlreadyTerminal)));
    }

    #[test]
    fn test_block_transition() {
        let workflow = test_workflow();
        let validator = TransitionValidator::new(&workflow);

        let status = Status::active("work");
        let transition = validator
            .block(&status, Phase::Idle, "Waiting for API access")
            .unwrap();

        assert!(matches!(transition.to, Status::Blocked { .. }));
    }

    #[test]
    fn test_consecutive_optional_stages() {
        // Workflow with multiple consecutive optional stages
        let workflow = WorkflowConfig::new(vec![
            StageConfig::new("planning", "plan"),
            StageConfig::new("design", "design").optional(),
            StageConfig::new("breakdown", "breakdown").optional(),
            StageConfig::new("work", "summary"),
        ]);
        let validator = TransitionValidator::new(&workflow);

        // skip_optional_next only skips the immediate next optional stage
        let status = Status::active("planning");
        let transition = validator.approve(&status, Phase::AwaitingReview, true).unwrap();

        // Skips "design" (optional), goes to "breakdown" (also optional but not skipped)
        assert_eq!(transition.to, Status::active("breakdown"));

        // To skip all optional stages, caller would need to loop or use skip()
    }

    #[test]
    fn test_all_remaining_stages_optional() {
        // Workflow where all remaining stages are optional
        let workflow = WorkflowConfig::new(vec![
            StageConfig::new("planning", "plan"),
            StageConfig::new("review1", "review1").optional(),
            StageConfig::new("review2", "review2").optional(),
        ]);
        let validator = TransitionValidator::new(&workflow);

        let status = Status::active("planning");
        let transition = validator.approve(&status, Phase::AwaitingReview, true).unwrap();

        // Skips review1, goes to review2 (not skipped since recursive call uses false)
        assert_eq!(transition.to, Status::active("review2"));
    }

    #[test]
    fn test_restage_transition() {
        // Workflow with review that can restage to work
        let workflow = WorkflowConfig::new(vec![
            StageConfig::new("planning", "plan"),
            StageConfig::new("work", "summary"),
            StageConfig::new("review", "verdict")
                .with_capabilities(StageCapabilities::with_restage(vec!["work".into()]))
                .automated(),
        ]);
        let validator = TransitionValidator::new(&workflow);

        let status = Status::active("review");
        let transition = validator
            .restage(&status, Phase::Idle, "work", "Tests are failing")
            .unwrap();

        assert_eq!(transition.to, Status::active("work"));
        assert_eq!(transition.to_phase, Phase::Idle);
        assert!(matches!(
            transition.trigger,
            TransitionTrigger::Restage { target, feedback }
            if target == "work" && feedback == "Tests are failing"
        ));
    }

    #[test]
    fn test_restage_not_allowed() {
        // Workflow where review cannot restage to planning
        let workflow = WorkflowConfig::new(vec![
            StageConfig::new("planning", "plan"),
            StageConfig::new("work", "summary"),
            StageConfig::new("review", "verdict")
                .with_capabilities(StageCapabilities::with_restage(vec!["work".into()]))
                .automated(),
        ]);
        let validator = TransitionValidator::new(&workflow);

        let status = Status::active("review");
        let result = validator.restage(&status, Phase::Idle, "planning", "Bad plan");

        assert!(matches!(
            result,
            Err(TransitionError::CannotRestage { from, target })
            if from == "review" && target == "planning"
        ));
    }

    #[test]
    fn test_restage_no_capability() {
        // Workflow where planning has no restage capability
        let workflow = test_workflow();
        let validator = TransitionValidator::new(&workflow);

        let status = Status::active("planning");
        let result = validator.restage(&status, Phase::Idle, "work", "Skip to work");

        assert!(matches!(
            result,
            Err(TransitionError::CannotRestage { .. })
        ));
    }

    #[test]
    fn test_restage_unknown_target() {
        // Workflow with restage to non-existent stage
        let workflow = WorkflowConfig::new(vec![
            StageConfig::new("review", "verdict")
                .with_capabilities(StageCapabilities::with_restage(vec!["nonexistent".into()])),
        ]);
        let validator = TransitionValidator::new(&workflow);

        let status = Status::active("review");
        let result = validator.restage(&status, Phase::Idle, "nonexistent", "feedback");

        // First validates capability (passes), then checks target exists (fails)
        assert!(matches!(result, Err(TransitionError::UnknownStage(_))));
    }
}
