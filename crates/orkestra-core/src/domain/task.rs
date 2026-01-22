use serde::{Deserialize, Serialize};
use crate::error::{OrkestraError, Result};

/// Task status representing the current state in the workflow.
///
/// The workflow is simplified to 3 main phases:
/// - Planning: Agent is creating a plan, or plan is ready for review
/// - Working: Agent is implementing, or work is ready for review
/// - Done: Task completed
///
/// "Needs review" is detected by checking data fields:
/// - Planning + plan.is_some() → needs plan approval
/// - Working + summary.is_some() → needs work review
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum TaskStatus {
    Planning,
    Working,
    Done,
    Failed,
    Blocked,
}

impl TaskStatus {
    /// Check if transition to a new status is allowed.
    ///
    /// The task workflow follows this state machine:
    /// - Planning -> Working (plan approved)
    /// - Planning -> Failed/Blocked
    /// - Working -> Done (work approved)
    /// - Working -> Planning (rare: restart planning)
    /// - Working -> Failed/Blocked
    /// - Any -> Failed/Blocked (can fail or block from anywhere)
    pub fn can_transition_to(&self, new: &TaskStatus) -> bool {
        use TaskStatus::*;
        matches!(
            (self, new),
            (Planning, Working)      // plan approved
                | (Planning, Failed)
                | (Planning, Blocked)
                | (Working, Done)    // work approved
                | (Working, Planning) // rare: restart planning
                | (Working, Failed)
                | (Working, Blocked)
                | (_, Failed)        // can fail from anywhere
                | (_, Blocked)       // can block from anywhere
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
    /// Tasks start in Planning status immediately.
    pub fn new(id: String, title: String, description: String, now: &str) -> Self {
        Self {
            id,
            title,
            description,
            status: TaskStatus::Planning,
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

    /// Returns true if task is in Planning and has a plan ready for review.
    pub fn needs_plan_review(&self) -> bool {
        self.status == TaskStatus::Planning && self.plan.is_some()
    }

    /// Returns true if task is Working and has work ready for review.
    pub fn needs_work_review(&self) -> bool {
        self.status == TaskStatus::Working && self.summary.is_some()
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
    fn test_new_task_starts_in_planning() {
        let task = Task::new("001".into(), "Test".into(), "Desc".into(), "now");
        assert_eq!(task.status, TaskStatus::Planning);
    }

    #[test]
    fn test_valid_transitions() {
        let mut task = Task::new("001".into(), "Test".into(), "Desc".into(), "now");
        assert_eq!(task.status, TaskStatus::Planning);

        // Planning -> Working (plan approved)
        assert!(task.transition_to(TaskStatus::Working, "now").is_ok());
        assert_eq!(task.status, TaskStatus::Working);

        // Working -> Done (work approved)
        assert!(task.transition_to(TaskStatus::Done, "now").is_ok());
        assert_eq!(task.status, TaskStatus::Done);
    }

    #[test]
    fn test_invalid_transition() {
        let mut task = Task::new("001".into(), "Test".into(), "Desc".into(), "now");
        task.status = TaskStatus::Done;

        // Can't go from Done to Planning
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
    fn test_needs_plan_review() {
        let mut task = Task::new("001".into(), "Test".into(), "Desc".into(), "now");
        assert!(!task.needs_plan_review());

        task.plan = Some("My plan".to_string());
        assert!(task.needs_plan_review());

        // Not true if status is Working
        task.status = TaskStatus::Working;
        assert!(!task.needs_plan_review());
    }

    #[test]
    fn test_needs_work_review() {
        let mut task = Task::new("001".into(), "Test".into(), "Desc".into(), "now");
        task.status = TaskStatus::Working;
        assert!(!task.needs_work_review());

        task.summary = Some("Done".to_string());
        assert!(task.needs_work_review());

        // Not true if status is Planning
        task.status = TaskStatus::Planning;
        assert!(!task.needs_work_review());
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
