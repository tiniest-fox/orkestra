use serde::{Deserialize, Serialize};
use crate::error::{OrkestraError, Result};

/// Task status representing the current state in the workflow.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum TaskStatus {
    Pending,
    Planning,
    AwaitingApproval,
    InProgress,
    ReadyForReview,
    Done,
    Failed,
    Blocked,
}

impl TaskStatus {
    /// Check if transition to a new status is allowed.
    ///
    /// The task workflow follows this state machine:
    /// - Pending -> Planning (task started)
    /// - Planning -> AwaitingApproval (plan created)
    /// - AwaitingApproval -> InProgress (plan approved)
    /// - AwaitingApproval -> Planning (plan changes requested)
    /// - InProgress -> ReadyForReview (work completed)
    /// - InProgress -> Failed/Blocked (work failed or blocked)
    /// - ReadyForReview -> Done (review approved)
    /// - ReadyForReview -> InProgress (review changes requested)
    /// - Any -> Failed/Blocked (can fail or block from anywhere)
    pub fn can_transition_to(&self, new: &TaskStatus) -> bool {
        use TaskStatus::*;
        matches!(
            (self, new),
            (Pending, Planning)
                | (Planning, AwaitingApproval)
                | (AwaitingApproval, InProgress)
                | (AwaitingApproval, Planning)
                | (InProgress, ReadyForReview)
                | (InProgress, Failed)
                | (InProgress, Blocked)
                | (ReadyForReview, Done)
                | (ReadyForReview, InProgress)
                | (_, Failed)
                | (_, Blocked)
        )
    }
}

/// Session information for tracking agent sessions.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SessionInfo {
    pub session_id: String,
    pub started_at: String,
}

/// A task representing a unit of work to be completed by agents.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Task {
    pub id: String,
    pub title: String,
    pub description: String,
    pub status: TaskStatus,
    pub created_at: String,
    pub updated_at: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub completed_at: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub summary: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub agent_pid: Option<u32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub plan: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub plan_feedback: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub review_feedback: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub sessions: Option<indexmap::IndexMap<String, SessionInfo>>,
    #[serde(default)]
    pub auto_approve: bool,
}

impl Task {
    /// Create a new task with the given ID, title, and description.
    pub fn new(id: String, title: String, description: String, now: &str) -> Self {
        Self {
            id,
            title,
            description,
            status: TaskStatus::Pending,
            created_at: now.to_string(),
            updated_at: now.to_string(),
            completed_at: None,
            summary: None,
            error: None,
            agent_pid: None,
            plan: None,
            plan_feedback: None,
            review_feedback: None,
            sessions: None,
            auto_approve: false,
        }
    }

    /// Transition the task to a new status, validating the transition.
    pub fn transition_to(&mut self, new_status: TaskStatus, now: &str) -> Result<()> {
        if !self.status.can_transition_to(&new_status) {
            return Err(OrkestraError::InvalidTransition {
                from: format!("{:?}", self.status),
                to: format!("{:?}", new_status),
            });
        }
        self.status = new_status;
        self.updated_at = now.to_string();
        Ok(())
    }

    /// Get the next review session key (review_0, review_1, etc.)
    pub fn next_review_session_key(&self) -> String {
        let count = self
            .sessions
            .as_ref()
            .map(|s| s.keys().filter(|k| k.starts_with("review_")).count())
            .unwrap_or(0);
        format!("review_{}", count)
    }

    /// Add a session to the task.
    pub fn add_session(&mut self, session_type: &str, session_id: &str, now: &str) {
        let session = SessionInfo {
            session_id: session_id.to_string(),
            started_at: now.to_string(),
        };

        match &mut self.sessions {
            Some(sessions) => {
                sessions.insert(session_type.to_string(), session);
            }
            None => {
                let mut sessions = indexmap::IndexMap::new();
                sessions.insert(session_type.to_string(), session);
                self.sessions = Some(sessions);
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_valid_transitions() {
        let mut task = Task::new("001".into(), "Test".into(), "Desc".into(), "now");

        assert!(task.transition_to(TaskStatus::Planning, "now").is_ok());
        assert_eq!(task.status, TaskStatus::Planning);

        assert!(task.transition_to(TaskStatus::AwaitingApproval, "now").is_ok());
        assert_eq!(task.status, TaskStatus::AwaitingApproval);

        assert!(task.transition_to(TaskStatus::InProgress, "now").is_ok());
        assert_eq!(task.status, TaskStatus::InProgress);

        assert!(task.transition_to(TaskStatus::ReadyForReview, "now").is_ok());
        assert_eq!(task.status, TaskStatus::ReadyForReview);

        assert!(task.transition_to(TaskStatus::Done, "now").is_ok());
        assert_eq!(task.status, TaskStatus::Done);
    }

    #[test]
    fn test_invalid_transition() {
        let mut task = Task::new("001".into(), "Test".into(), "Desc".into(), "now");
        task.status = TaskStatus::Done;

        let result = task.transition_to(TaskStatus::Planning, "now");
        assert!(result.is_err());
    }

    #[test]
    fn test_can_fail_from_anywhere() {
        let task = Task::new("001".into(), "Test".into(), "Desc".into(), "now");
        assert!(task.status.can_transition_to(&TaskStatus::Failed));
        assert!(task.status.can_transition_to(&TaskStatus::Blocked));
    }

    #[test]
    fn test_review_session_key() {
        let mut task = Task::new("001".into(), "Test".into(), "Desc".into(), "now");

        assert_eq!(task.next_review_session_key(), "review_0");

        task.add_session("review_0", "session-1", "now");
        assert_eq!(task.next_review_session_key(), "review_1");

        task.add_session("review_1", "session-2", "now");
        assert_eq!(task.next_review_session_key(), "review_2");
    }
}
