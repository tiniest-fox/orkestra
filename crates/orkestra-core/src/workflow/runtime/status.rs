//! Generic task status.
//!
//! Status represents the current state of a task in the workflow.
//! Active tasks are in a named stage; terminal states are fixed.

use serde::{Deserialize, Serialize};

/// Current status of a task in the workflow.
///
/// This is a stage-agnostic version of task status. Instead of having
/// `Planning`, `Working`, etc., we have `Active { stage }` with the
/// stage name as a field.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum Status {
    /// Task is actively being worked on in a specific stage.
    Active {
        /// The current stage name (e.g., "planning", "work").
        stage: String,
    },

    /// Task is waiting for child tasks to complete.
    ///
    /// Retains the stage the parent will resume from once children finish,
    /// so the kanban board can display it in the correct column.
    WaitingOnChildren {
        /// The stage the parent is logically in while waiting (typically the
        /// stage after the breakdown stage, e.g. "work").
        stage: String,
    },

    /// Task completed successfully.
    Done,

    /// Task was completed and integrated (branch merged).
    /// This is a terminal state - archived tasks are hidden from the main view.
    Archived,

    /// Task failed and cannot continue.
    Failed {
        /// Error message describing the failure.
        #[serde(skip_serializing_if = "Option::is_none")]
        error: Option<String>,
    },

    /// Task is blocked on external dependency.
    Blocked {
        /// Reason for blocking.
        #[serde(skip_serializing_if = "Option::is_none")]
        reason: Option<String>,
    },
}

impl Status {
    /// Create an active status in the given stage.
    pub fn active(stage: impl Into<String>) -> Self {
        Self::Active {
            stage: stage.into(),
        }
    }

    /// Create a failed status with an error message.
    pub fn failed(error: impl Into<String>) -> Self {
        Self::Failed {
            error: Some(error.into()),
        }
    }

    /// Create a blocked status with a reason.
    pub fn blocked(reason: impl Into<String>) -> Self {
        Self::Blocked {
            reason: Some(reason.into()),
        }
    }

    /// Create a waiting-on-children status in the given stage.
    pub fn waiting_on_children(stage: impl Into<String>) -> Self {
        Self::WaitingOnChildren {
            stage: stage.into(),
        }
    }

    /// Get the current stage name, if active or waiting on children.
    pub fn stage(&self) -> Option<&str> {
        match self {
            Status::Active { stage } | Status::WaitingOnChildren { stage } => Some(stage),
            _ => None,
        }
    }

    /// Check if this is a terminal status (task is done/archived/failed/blocked).
    pub fn is_terminal(&self) -> bool {
        matches!(
            self,
            Status::Done | Status::Archived | Status::Failed { .. } | Status::Blocked { .. }
        )
    }

    /// Check if the task is archived (completed and integrated).
    pub fn is_archived(&self) -> bool {
        matches!(self, Status::Archived)
    }

    /// Check if this is an active status (task is in a stage).
    pub fn is_active(&self) -> bool {
        matches!(self, Status::Active { .. })
    }

    /// Check if the task can transition to a new stage.
    pub fn can_transition(&self) -> bool {
        !self.is_terminal()
    }

    /// Check if the task is waiting for children.
    pub fn is_waiting_on_children(&self) -> bool {
        matches!(self, Status::WaitingOnChildren { .. })
    }
}

// Note: Status deliberately does not implement Default because the first stage
// depends on the workflow configuration. Use `Status::active(workflow.first_stage().name)`
// to create the initial status for a task.

impl std::fmt::Display for Status {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Status::Active { stage } => write!(f, "{stage}"),
            Status::WaitingOnChildren { stage } => {
                write!(f, "waiting_on_children ({stage})")
            }
            Status::Done => write!(f, "done"),
            Status::Archived => write!(f, "archived"),
            Status::Failed { error } => {
                if let Some(err) = error {
                    write!(f, "failed: {err}")
                } else {
                    write!(f, "failed")
                }
            }
            Status::Blocked { reason } => {
                if let Some(r) = reason {
                    write!(f, "blocked: {r}")
                } else {
                    write!(f, "blocked")
                }
            }
        }
    }
}

impl std::fmt::Display for Phase {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Phase::AwaitingSetup => write!(f, "awaiting_setup"),
            Phase::SettingUp => write!(f, "setting_up"),
            Phase::Idle => write!(f, "idle"),
            Phase::AgentWorking => write!(f, "agent_working"),
            Phase::AwaitingReview => write!(f, "awaiting_review"),
            Phase::Interrupted => write!(f, "interrupted"),
            Phase::Integrating => write!(f, "integrating"),
            Phase::Finishing => write!(f, "finishing"),
            Phase::Committing => write!(f, "committing"),
            Phase::Finished => write!(f, "finished"),
        }
    }
}

/// Phase within a stage - what the task is currently doing.
///
/// This is orthogonal to Status and tracks the sub-state within a stage.
#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Default)]
#[serde(rename_all = "snake_case")]
pub enum Phase {
    /// Task waiting for setup to be triggered by orchestrator.
    /// For subtasks, waits until dependencies are satisfied.
    AwaitingSetup,

    /// Setup actively in progress (worktree creation, setup script).
    /// Orchestrator will not pick up tasks in this phase.
    SettingUp,

    /// No active work - waiting to start or between operations.
    #[default]
    Idle,

    /// Agent is currently working.
    AgentWorking,

    /// Output is ready for human review.
    AwaitingReview,

    /// Agent was interrupted by the user. Awaiting resume.
    Interrupted,

    /// Integration (merge) is in progress.
    Integrating,

    /// Agent completed, output stored on iteration. Check if commit needed.
    Finishing,

    /// Background commit thread is running. Tick skips these.
    Committing,

    /// Stage complete — output ready to be processed, advance to next stage.
    Finished,
}

impl Phase {
    /// Check if a human action is needed.
    pub fn needs_human_action(&self) -> bool {
        matches!(self, Phase::AwaitingReview | Phase::Interrupted)
    }

    /// Check if an agent is currently working.
    pub fn has_active_agent(&self) -> bool {
        matches!(self, Phase::AgentWorking)
    }

    /// Returns true for phases where the system is doing background work
    /// (committing, integrating, finishing) but no agent is running.
    pub fn is_system_active(&self) -> bool {
        matches!(
            self,
            Phase::Committing | Phase::Integrating | Phase::Finishing
        )
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_active_status() {
        let status = Status::active("planning");
        assert_eq!(status.stage(), Some("planning"));
        assert!(status.is_active());
        assert!(!status.is_terminal());
        assert!(status.can_transition());
    }

    #[test]
    fn test_terminal_statuses() {
        assert!(Status::Done.is_terminal());
        assert!(Status::Archived.is_terminal());
        assert!(Status::failed("error").is_terminal());
        assert!(Status::blocked("reason").is_terminal());

        assert!(!Status::Done.can_transition());
        assert!(!Status::Archived.can_transition());
    }

    #[test]
    fn test_archived_status() {
        let status = Status::Archived;
        assert!(status.is_archived());
        assert!(status.is_terminal());
        assert!(!status.is_active());
        assert!(!status.can_transition());
        assert_eq!(status.to_string(), "archived");

        // Test serialization
        let json = serde_json::to_string(&status).unwrap();
        assert!(json.contains("\"type\":\"archived\""));

        let parsed: Status = serde_json::from_str(&json).unwrap();
        assert_eq!(parsed, status);
    }

    #[test]
    fn test_waiting_on_children() {
        let status = Status::waiting_on_children("work");
        assert!(!status.is_active());
        assert!(!status.is_terminal());
        assert!(status.is_waiting_on_children());
        assert_eq!(status.stage(), Some("work"));
    }

    #[test]
    fn test_status_serialization() {
        let status = Status::active("work");
        let json = serde_json::to_string(&status).unwrap();

        assert!(json.contains("\"type\":\"active\""));
        assert!(json.contains("\"stage\":\"work\""));

        let parsed: Status = serde_json::from_str(&json).unwrap();
        assert_eq!(parsed, status);
    }

    #[test]
    fn test_failed_status() {
        let status = Status::failed("Something went wrong");
        match status {
            Status::Failed { error } => {
                assert_eq!(error, Some("Something went wrong".into()));
            }
            _ => panic!("Expected Failed variant"),
        }
    }

    #[test]
    fn test_phase_default() {
        let phase = Phase::default();
        assert_eq!(phase, Phase::Idle);
        assert!(!phase.needs_human_action());
        assert!(!phase.has_active_agent());
    }

    #[test]
    fn test_phase_states() {
        assert!(Phase::AwaitingReview.needs_human_action());
        assert!(Phase::AgentWorking.has_active_agent());
        assert!(!Phase::Idle.needs_human_action());
        assert!(!Phase::Integrating.has_active_agent());
    }

    #[test]
    fn test_phase_serialization() {
        let phase = Phase::AwaitingReview;
        let json = serde_json::to_string(&phase).unwrap();
        assert_eq!(json, "\"awaiting_review\"");

        let parsed: Phase = serde_json::from_str(&json).unwrap();
        assert_eq!(parsed, phase);
    }

    #[test]
    fn test_phase_interrupted() {
        let phase = Phase::Interrupted;
        assert!(phase.needs_human_action());
        assert!(!phase.has_active_agent());
        assert_eq!(phase.to_string(), "interrupted");
    }

    #[test]
    fn test_phase_interrupted_serialization() {
        let phase = Phase::Interrupted;
        let json = serde_json::to_string(&phase).unwrap();
        assert_eq!(json, "\"interrupted\"");

        let parsed: Phase = serde_json::from_str(&json).unwrap();
        assert_eq!(parsed, phase);
    }
}
