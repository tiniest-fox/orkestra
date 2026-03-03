//! Task state — unified enum replacing the old Status + Phase pair.
//!
//! `TaskState` is the single source of truth for what a task is doing.
//! Each variant has exactly one meaning. No more cross-referencing
//! Status + Phase to determine the actual situation.

use std::fmt;

use serde::{Deserialize, Serialize};

/// The complete state of a task in the workflow.
///
/// Every non-terminal variant (except `Integrating`) carries the stage name.
/// Terminal variants carry optional context (error message, block reason).
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum TaskState {
    // -- Setup --
    /// Task waiting for setup to be triggered by orchestrator.
    /// For subtasks, waits until dependencies are satisfied.
    AwaitingSetup { stage: String },

    /// Setup actively in progress (worktree creation, setup script).
    SettingUp { stage: String },

    // -- Queued --
    /// Ready for orchestrator to spawn an agent. Waiting in line.
    Queued { stage: String },

    // -- Active work --
    /// Agent is currently working on this task.
    AgentWorking { stage: String },

    /// Agent completed, waiting for gate script to start.
    AwaitingGate { stage: String },

    /// Gate script is executing.
    GateRunning { stage: String },

    /// Agent completed, output stored. Checking if commit needed.
    Finishing { stage: String },

    /// Background commit thread is running.
    Committing { stage: String },

    /// Commit pipeline complete. Ready for `advance_all_committed` to pick up.
    Committed { stage: String },

    /// Integration (merge) is in progress.
    Integrating,

    // -- Awaiting human --
    /// Stage output ready for human approval.
    AwaitingApproval { stage: String },

    /// Agent asked questions that need human answers.
    AwaitingQuestionAnswer { stage: String },

    /// Reviewer agent rejected; awaiting human confirmation of rejection.
    AwaitingRejectionConfirmation { stage: String },

    /// Agent was interrupted by the user. Awaiting resume.
    Interrupted { stage: String },

    // -- Parent --
    /// Waiting for child tasks to complete before advancing.
    WaitingOnChildren { stage: String },

    // -- Terminal --
    /// Task completed successfully (all stages done).
    Done,

    /// Task completed and integrated (branch merged).
    Archived,

    /// Task failed and cannot continue.
    Failed {
        #[serde(skip_serializing_if = "Option::is_none")]
        error: Option<String>,
    },

    /// Task is blocked on external dependency.
    Blocked {
        #[serde(skip_serializing_if = "Option::is_none")]
        reason: Option<String>,
    },
}

// ============================================================================
// Constructors
// ============================================================================

impl TaskState {
    pub fn awaiting_setup(stage: impl Into<String>) -> Self {
        Self::AwaitingSetup {
            stage: stage.into(),
        }
    }

    pub fn setting_up(stage: impl Into<String>) -> Self {
        Self::SettingUp {
            stage: stage.into(),
        }
    }

    pub fn queued(stage: impl Into<String>) -> Self {
        Self::Queued {
            stage: stage.into(),
        }
    }

    pub fn agent_working(stage: impl Into<String>) -> Self {
        Self::AgentWorking {
            stage: stage.into(),
        }
    }

    pub fn awaiting_gate(stage: impl Into<String>) -> Self {
        Self::AwaitingGate {
            stage: stage.into(),
        }
    }

    pub fn gate_running(stage: impl Into<String>) -> Self {
        Self::GateRunning {
            stage: stage.into(),
        }
    }

    pub fn finishing(stage: impl Into<String>) -> Self {
        Self::Finishing {
            stage: stage.into(),
        }
    }

    pub fn committing(stage: impl Into<String>) -> Self {
        Self::Committing {
            stage: stage.into(),
        }
    }

    pub fn committed(stage: impl Into<String>) -> Self {
        Self::Committed {
            stage: stage.into(),
        }
    }

    pub fn awaiting_approval(stage: impl Into<String>) -> Self {
        Self::AwaitingApproval {
            stage: stage.into(),
        }
    }

    pub fn awaiting_question_answer(stage: impl Into<String>) -> Self {
        Self::AwaitingQuestionAnswer {
            stage: stage.into(),
        }
    }

    pub fn awaiting_rejection_confirmation(stage: impl Into<String>) -> Self {
        Self::AwaitingRejectionConfirmation {
            stage: stage.into(),
        }
    }

    pub fn interrupted(stage: impl Into<String>) -> Self {
        Self::Interrupted {
            stage: stage.into(),
        }
    }

    pub fn waiting_on_children(stage: impl Into<String>) -> Self {
        Self::WaitingOnChildren {
            stage: stage.into(),
        }
    }

    pub fn failed(error: impl Into<String>) -> Self {
        Self::Failed {
            error: Some(error.into()),
        }
    }

    pub fn blocked(reason: impl Into<String>) -> Self {
        Self::Blocked {
            reason: Some(reason.into()),
        }
    }
}

// ============================================================================
// Query methods
// ============================================================================

impl TaskState {
    /// Get the current stage name, if not terminal or integrating.
    pub fn stage(&self) -> Option<&str> {
        match self {
            Self::AwaitingSetup { stage }
            | Self::SettingUp { stage }
            | Self::Queued { stage }
            | Self::AgentWorking { stage }
            | Self::AwaitingGate { stage }
            | Self::GateRunning { stage }
            | Self::Finishing { stage }
            | Self::Committing { stage }
            | Self::Committed { stage }
            | Self::AwaitingApproval { stage }
            | Self::AwaitingQuestionAnswer { stage }
            | Self::AwaitingRejectionConfirmation { stage }
            | Self::Interrupted { stage }
            | Self::WaitingOnChildren { stage } => Some(stage),
            Self::Integrating
            | Self::Done
            | Self::Archived
            | Self::Failed { .. }
            | Self::Blocked { .. } => None,
        }
    }

    /// Check if this is a terminal state (task will not progress further).
    pub fn is_terminal(&self) -> bool {
        matches!(
            self,
            Self::Done | Self::Archived | Self::Failed { .. } | Self::Blocked { .. }
        )
    }

    /// Check if a human action is needed to proceed.
    pub fn needs_human_action(&self) -> bool {
        matches!(
            self,
            Self::AwaitingApproval { .. }
                | Self::AwaitingQuestionAnswer { .. }
                | Self::AwaitingRejectionConfirmation { .. }
                | Self::Interrupted { .. }
        )
    }

    /// Check if an agent is currently working.
    pub fn has_active_agent(&self) -> bool {
        matches!(self, Self::AgentWorking { .. })
    }

    /// Returns true for states where the system is doing background work
    /// (finishing, committing, committed, integrating, gate running, awaiting gate) but no agent is running.
    pub fn is_system_active(&self) -> bool {
        matches!(
            self,
            Self::Finishing { .. }
                | Self::Committing { .. }
                | Self::Committed { .. }
                | Self::Integrating
                | Self::GateRunning { .. }
                | Self::AwaitingGate { .. }
        )
    }

    pub fn is_done(&self) -> bool {
        matches!(self, Self::Done)
    }

    pub fn is_archived(&self) -> bool {
        matches!(self, Self::Archived)
    }

    pub fn is_failed(&self) -> bool {
        matches!(self, Self::Failed { .. })
    }

    pub fn is_blocked(&self) -> bool {
        matches!(self, Self::Blocked { .. })
    }

    pub fn is_waiting_on_children(&self) -> bool {
        matches!(self, Self::WaitingOnChildren { .. })
    }

    /// Check if the task is in an active stage (not terminal, not waiting on children).
    pub fn is_active(&self) -> bool {
        !self.is_terminal() && !self.is_waiting_on_children()
    }

    /// Check if the task can transition to a new stage.
    pub fn can_transition(&self) -> bool {
        !self.is_terminal()
    }
}

// ============================================================================
// Display
// ============================================================================

impl fmt::Display for TaskState {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::AwaitingSetup { stage } => write!(f, "awaiting_setup ({stage})"),
            Self::SettingUp { stage } => write!(f, "setting_up ({stage})"),
            Self::Queued { stage } => write!(f, "queued ({stage})"),
            Self::AgentWorking { stage } => write!(f, "agent_working ({stage})"),
            Self::AwaitingGate { stage } => write!(f, "awaiting_gate ({stage})"),
            Self::GateRunning { stage } => write!(f, "gate_running ({stage})"),
            Self::Finishing { stage } => write!(f, "finishing ({stage})"),
            Self::Committing { stage } => write!(f, "committing ({stage})"),
            Self::Committed { stage } => write!(f, "committed ({stage})"),
            Self::Integrating => write!(f, "integrating"),
            Self::AwaitingApproval { stage } => write!(f, "awaiting_approval ({stage})"),
            Self::AwaitingQuestionAnswer { stage } => {
                write!(f, "awaiting_question_answer ({stage})")
            }
            Self::AwaitingRejectionConfirmation { stage } => {
                write!(f, "awaiting_rejection_confirmation ({stage})")
            }
            Self::Interrupted { stage } => write!(f, "interrupted ({stage})"),
            Self::WaitingOnChildren { stage } => write!(f, "waiting_on_children ({stage})"),
            Self::Done => write!(f, "done"),
            Self::Archived => write!(f, "archived"),
            Self::Failed { error } => {
                if let Some(err) = error {
                    write!(f, "failed: {err}")
                } else {
                    write!(f, "failed")
                }
            }
            Self::Blocked { reason } => {
                if let Some(r) = reason {
                    write!(f, "blocked: {r}")
                } else {
                    write!(f, "blocked")
                }
            }
        }
    }
}

// ============================================================================
// Tests
// ============================================================================

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_queued_state() {
        let state = TaskState::queued("planning");
        assert_eq!(state.stage(), Some("planning"));
        assert!(state.is_active());
        assert!(!state.is_terminal());
        assert!(state.can_transition());
    }

    #[test]
    fn test_terminal_states() {
        assert!(TaskState::Done.is_terminal());
        assert!(TaskState::Archived.is_terminal());
        assert!(TaskState::failed("error").is_terminal());
        assert!(TaskState::blocked("reason").is_terminal());

        assert!(!TaskState::Done.can_transition());
        assert!(!TaskState::Archived.can_transition());
    }

    #[test]
    fn test_archived_state() {
        let state = TaskState::Archived;
        assert!(state.is_archived());
        assert!(state.is_terminal());
        assert!(!state.is_active());
        assert!(!state.can_transition());
        assert!(state.to_string().contains("archived"));
    }

    #[test]
    fn test_waiting_on_children() {
        let state = TaskState::waiting_on_children("work");
        assert!(!state.is_active());
        assert!(!state.is_terminal());
        assert!(state.is_waiting_on_children());
        assert_eq!(state.stage(), Some("work"));
    }

    #[test]
    fn test_serialization() {
        let state = TaskState::agent_working("work");
        let json = serde_json::to_string(&state).unwrap();
        assert!(json.contains("\"type\":\"agent_working\""));
        assert!(json.contains("\"stage\":\"work\""));

        let parsed: TaskState = serde_json::from_str(&json).unwrap();
        assert_eq!(parsed, state);
    }

    #[test]
    fn test_done_serialization() {
        let state = TaskState::Done;
        let json = serde_json::to_string(&state).unwrap();
        assert!(json.contains("\"type\":\"done\""));

        let parsed: TaskState = serde_json::from_str(&json).unwrap();
        assert_eq!(parsed, state);
    }

    #[test]
    fn test_failed_serialization() {
        let state = TaskState::failed("Something went wrong");
        let json = serde_json::to_string(&state).unwrap();
        assert!(json.contains("\"type\":\"failed\""));
        assert!(json.contains("\"error\":\"Something went wrong\""));

        let parsed: TaskState = serde_json::from_str(&json).unwrap();
        assert_eq!(parsed, state);
    }

    #[test]
    fn test_failed_no_error_serialization() {
        let state = TaskState::Failed { error: None };
        let json = serde_json::to_string(&state).unwrap();
        assert!(!json.contains("error"));

        let parsed: TaskState = serde_json::from_str(&json).unwrap();
        assert_eq!(parsed, state);
    }

    #[test]
    fn test_integrating_no_stage() {
        let state = TaskState::Integrating;
        assert!(state.stage().is_none());
        assert!(state.is_system_active());
        assert!(!state.is_terminal());
    }

    #[test]
    fn test_needs_human_action() {
        assert!(TaskState::awaiting_approval("review").needs_human_action());
        assert!(TaskState::awaiting_question_answer("planning").needs_human_action());
        assert!(TaskState::awaiting_rejection_confirmation("review").needs_human_action());
        assert!(TaskState::interrupted("work").needs_human_action());

        assert!(!TaskState::agent_working("work").needs_human_action());
        assert!(!TaskState::queued("work").needs_human_action());
        assert!(!TaskState::Done.needs_human_action());
    }

    #[test]
    fn test_system_active() {
        assert!(TaskState::finishing("work").is_system_active());
        assert!(TaskState::committing("work").is_system_active());
        assert!(TaskState::Integrating.is_system_active());
        assert!(TaskState::awaiting_gate("work").is_system_active());
        assert!(TaskState::gate_running("work").is_system_active());

        assert!(!TaskState::agent_working("work").is_system_active());
        assert!(!TaskState::queued("work").is_system_active());
    }

    #[test]
    fn test_has_active_agent() {
        assert!(TaskState::agent_working("work").has_active_agent());
        assert!(!TaskState::queued("work").has_active_agent());
        assert!(!TaskState::finishing("work").has_active_agent());
    }

    #[test]
    fn test_awaiting_gate_state() {
        let state = TaskState::awaiting_gate("work");
        assert_eq!(state.stage(), Some("work"));
        assert!(state.is_active());
        assert!(!state.is_terminal());
        assert!(!state.needs_human_action());
        assert!(!state.has_active_agent());
        assert!(state.is_system_active());
        assert_eq!(state.to_string(), "awaiting_gate (work)");
    }

    #[test]
    fn test_gate_running_state() {
        let state = TaskState::gate_running("work");
        assert_eq!(state.stage(), Some("work"));
        assert!(state.is_active());
        assert!(!state.is_terminal());
        assert!(!state.needs_human_action());
        assert!(!state.has_active_agent());
        assert!(state.is_system_active());
        assert_eq!(state.to_string(), "gate_running (work)");
    }

    #[test]
    fn test_gate_states_serialization() {
        let state = TaskState::awaiting_gate("checks");
        let json = serde_json::to_string(&state).unwrap();
        assert!(json.contains("\"type\":\"awaiting_gate\""));
        assert!(json.contains("\"stage\":\"checks\""));
        let parsed: TaskState = serde_json::from_str(&json).unwrap();
        assert_eq!(parsed, state);

        let state = TaskState::gate_running("checks");
        let json = serde_json::to_string(&state).unwrap();
        assert!(json.contains("\"type\":\"gate_running\""));
        let parsed: TaskState = serde_json::from_str(&json).unwrap();
        assert_eq!(parsed, state);
    }
}
