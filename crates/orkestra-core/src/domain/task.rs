use crate::error::{OrkestraError, Result};
use serde::{Deserialize, Serialize};

/// Task status representing the current state in the workflow.
///
/// The workflow is simplified to 3 main phases:
/// - Planning: Agent is creating a plan, or plan is ready for review
/// - Working: Agent is implementing, or work is ready for review
/// - Done: Task completed
///
/// "Needs review" is detected by checking data fields:
/// - Planning + `plan.is_some()` → needs plan approval
/// - Working + `summary.is_some()` → needs work review
#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum TaskStatus {
    Planning,
    BreakingDown,
    WaitingOnSubtasks,
    Working,
    Reviewing,
    Done,
    Failed,
    Blocked,
}

/// Task kind distinguishes between parallel tasks and checklist subtasks.
///
/// - Task: Appears in Kanban board, has its own worker agent
/// - Subtask: Hidden from Kanban, shown as checklist item in parent task
#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize, Default)]
#[serde(rename_all = "snake_case")]
pub enum TaskKind {
    #[default]
    Task,
    Subtask,
}

/// Result of attempting to integrate a task branch back to the primary branch.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum IntegrationResult {
    /// Branch was successfully merged and cleaned up.
    Merged {
        merged_at: String,
        commit_sha: String,
        target_branch: String,
    },
    /// Merge conflict occurred. Task was reopened for resolution.
    Conflict { conflict_files: Vec<String> },
    /// Integration was skipped (not a root task, no worktree, etc.).
    Skipped { reason: String },
}

impl TaskStatus {
    /// Check if transition to a new status is allowed.
    ///
    /// The task workflow follows this state machine:
    /// - Planning -> Working (plan approved)
    /// - Planning -> Failed/Blocked
    /// - Working -> Reviewing (work approved, automated review)
    /// - Working -> Done (work approved, skip review)
    /// - Working -> Planning (rare: restart planning)
    /// - Working -> Failed/Blocked
    /// - Reviewing -> Done (reviewer approved)
    /// - Reviewing -> Working (reviewer rejected, back to worker)
    /// - Reviewing -> Failed/Blocked
    /// - Any -> Failed/Blocked (can fail or block from anywhere)
    pub fn can_transition_to(&self, new: &TaskStatus) -> bool {
        use TaskStatus::{
            Blocked, BreakingDown, Done, Failed, Planning, Reviewing, WaitingOnSubtasks, Working,
        };
        matches!(
            (self, new),
            // Planning transitions
            (Planning, BreakingDown | Working | Failed | Blocked)
                | (BreakingDown, WaitingOnSubtasks | Working | Failed | Blocked)
                | (WaitingOnSubtasks, Done | Blocked | Failed)
                // Working transitions
                | (Working, Done | Reviewing | Planning | Blocked | Failed)
                // Reviewing transitions
                | (Reviewing, Done | Working | Blocked | Failed)
                // Universal failure/block transitions
                | (_, Blocked | Failed)
        )
    }
}

/// Session information for tracking agent sessions.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SessionInfo {
    pub session_id: String,
    pub started_at: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub agent_pid: Option<u32>,
}

/// A task representing a unit of work to be completed by agents.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Task {
    pub id: String,
    /// Title of the task. Optional - can be auto-generated asynchronously.
    /// When None, the UI should display a truncated description instead.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub title: Option<String>,
    pub description: String,
    pub status: TaskStatus,
    /// Kind of task: Task (Kanban, parallel) or Subtask (checklist item)
    #[serde(default)]
    pub kind: TaskKind,
    pub created_at: String,
    pub updated_at: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub completed_at: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub summary: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub plan: Option<String>,
    // Note: Feedback (plan_feedback, review_feedback, reviewer_feedback) has been moved
    // to WorkLoop outcomes for single source of truth and audit trail.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub sessions: Option<indexmap::IndexMap<String, SessionInfo>>,
    #[serde(default)]
    pub auto_approve: bool,
    /// Parent task ID for subtasks (None for root tasks)
    #[serde(skip_serializing_if = "Option::is_none")]
    pub parent_id: Option<String>,
    /// The breakdown produced by the breakdown agent
    #[serde(skip_serializing_if = "Option::is_none")]
    pub breakdown: Option<String>,
    // Note: breakdown_feedback has been moved to WorkLoop outcomes
    /// Whether this task should skip breakdown and go straight to working
    #[serde(default)]
    pub skip_breakdown: bool,
    /// Currently running agent process ID (set immediately when spawned, cleared when finished)
    #[serde(skip_serializing_if = "Option::is_none")]
    pub agent_pid: Option<u32>,
    /// Git branch name for this task (e.g., "task/TASK-001")
    /// Only set on root tasks; child tasks inherit from parent.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub branch_name: Option<String>,
    /// Path to the git worktree for this task (e.g., ".orkestra/worktrees/TASK-001")
    /// Only set on root tasks; child tasks inherit from parent.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub worktree_path: Option<String>,
    // Note: integration_result has been moved to WorkLoop outcomes for single source of truth.
}

impl Task {
    /// Create a new task with the given ID, title, and description.
    /// Tasks start in Planning status immediately.
    /// Title can be None if it will be generated asynchronously.
    pub fn new(id: String, title: Option<String>, description: String, now: &str) -> Self {
        Self {
            id,
            title,
            description,
            status: TaskStatus::Planning,
            kind: TaskKind::Task,
            created_at: now.to_string(),
            updated_at: now.to_string(),
            completed_at: None,
            summary: None,
            error: None,
            plan: None,
            sessions: None,
            auto_approve: false,
            parent_id: None,
            breakdown: None,
            skip_breakdown: false,
            agent_pid: None,
            branch_name: None,
            worktree_path: None,
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

    /// Returns true if task is `BreakingDown` and has breakdown ready for review.
    pub fn needs_breakdown_review(&self) -> bool {
        self.status == TaskStatus::BreakingDown && self.breakdown.is_some()
    }

    /// Returns true if task is in the `Reviewing` state (automated review in progress).
    pub fn is_reviewing(&self) -> bool {
        self.status == TaskStatus::Reviewing
    }

    /// Transition the task to a new status, validating the transition.
    pub fn transition_to(&mut self, new_status: TaskStatus, now: &str) -> Result<()> {
        if !self.status.can_transition_to(&new_status) {
            return Err(OrkestraError::InvalidTransition {
                from: format!("{:?}", self.status),
                to: format!("{new_status:?}"),
            });
        }
        self.status = new_status;
        self.updated_at = now.to_string();
        Ok(())
    }

    /// Add a session to the task.
    pub fn add_session(
        &mut self,
        session_type: &str,
        session_id: &str,
        now: &str,
        agent_pid: Option<u32>,
    ) {
        let session = SessionInfo {
            session_id: session_id.to_string(),
            started_at: now.to_string(),
            agent_pid,
        };

        if let Some(sessions) = &mut self.sessions {
            sessions.insert(session_type.to_string(), session);
        } else {
            let mut sessions = indexmap::IndexMap::new();
            sessions.insert(session_type.to_string(), session);
            self.sessions = Some(sessions);
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_new_task_starts_in_planning() {
        let task = Task::new("001".into(), Some("Test".into()), "Desc".into(), "now");
        assert_eq!(task.status, TaskStatus::Planning);
    }

    #[test]
    fn test_valid_transitions() {
        let mut task = Task::new("001".into(), Some("Test".into()), "Desc".into(), "now");
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
        let mut task = Task::new("001".into(), Some("Test".into()), "Desc".into(), "now");
        task.status = TaskStatus::Done;

        // Can't go from Done to Planning
        let result = task.transition_to(TaskStatus::Planning, "now");
        assert!(result.is_err());
    }

    #[test]
    fn test_can_fail_from_anywhere() {
        let task = Task::new("001".into(), Some("Test".into()), "Desc".into(), "now");
        assert!(task.status.can_transition_to(&TaskStatus::Failed));
        assert!(task.status.can_transition_to(&TaskStatus::Blocked));
    }

    #[test]
    fn test_needs_plan_review() {
        let mut task = Task::new("001".into(), Some("Test".into()), "Desc".into(), "now");
        assert!(!task.needs_plan_review());

        task.plan = Some("My plan".to_string());
        assert!(task.needs_plan_review());

        // Not true if status is Working
        task.status = TaskStatus::Working;
        assert!(!task.needs_plan_review());
    }

    #[test]
    fn test_needs_work_review() {
        let mut task = Task::new("001".into(), Some("Test".into()), "Desc".into(), "now");
        task.status = TaskStatus::Working;
        assert!(!task.needs_work_review());

        task.summary = Some("Done".to_string());
        assert!(task.needs_work_review());

        // Not true if status is Planning
        task.status = TaskStatus::Planning;
        assert!(!task.needs_work_review());
    }

    #[test]
    fn test_breakdown_workflow_transitions() {
        let mut task = Task::new("001".into(), Some("Test".into()), "Desc".into(), "now");
        assert_eq!(task.status, TaskStatus::Planning);

        // Planning -> BreakingDown (plan approved, breakdown enabled)
        assert!(task.transition_to(TaskStatus::BreakingDown, "now").is_ok());
        assert_eq!(task.status, TaskStatus::BreakingDown);

        // BreakingDown -> WaitingOnSubtasks (breakdown approved)
        assert!(task
            .transition_to(TaskStatus::WaitingOnSubtasks, "now")
            .is_ok());
        assert_eq!(task.status, TaskStatus::WaitingOnSubtasks);

        // WaitingOnSubtasks -> Done (all children done)
        assert!(task.transition_to(TaskStatus::Done, "now").is_ok());
        assert_eq!(task.status, TaskStatus::Done);
    }

    #[test]
    fn test_breakdown_skip_to_working() {
        let mut task = Task::new("001".into(), Some("Test".into()), "Desc".into(), "now");
        task.skip_breakdown = true;

        // Planning -> Working (skip breakdown)
        assert!(task.transition_to(TaskStatus::Working, "now").is_ok());
        assert_eq!(task.status, TaskStatus::Working);
    }

    #[test]
    fn test_breakdown_no_subtasks_needed() {
        let mut task = Task::new("001".into(), Some("Test".into()), "Desc".into(), "now");
        assert!(task.transition_to(TaskStatus::BreakingDown, "now").is_ok());

        // BreakingDown -> Working (breakdown agent decides no subtasks needed)
        assert!(task.transition_to(TaskStatus::Working, "now").is_ok());
        assert_eq!(task.status, TaskStatus::Working);
    }

    #[test]
    fn test_needs_breakdown_review() {
        let mut task = Task::new("001".into(), Some("Test".into()), "Desc".into(), "now");
        task.status = TaskStatus::BreakingDown;
        assert!(!task.needs_breakdown_review());

        task.breakdown = Some("Split into 3 subtasks".to_string());
        assert!(task.needs_breakdown_review());

        // Not true if status is not BreakingDown
        task.status = TaskStatus::Planning;
        assert!(!task.needs_breakdown_review());
    }

    #[test]
    fn test_waiting_on_subtasks_can_be_blocked() {
        let mut task = Task::new("001".into(), Some("Test".into()), "Desc".into(), "now");
        task.status = TaskStatus::WaitingOnSubtasks;

        // WaitingOnSubtasks -> Blocked (child failed)
        assert!(task.transition_to(TaskStatus::Blocked, "now").is_ok());
        assert_eq!(task.status, TaskStatus::Blocked);
    }

    #[test]
    fn test_new_task_has_breakdown_fields() {
        let task = Task::new("001".into(), Some("Test".into()), "Desc".into(), "now");
        assert!(task.parent_id.is_none());
        assert!(task.breakdown.is_none());
        // Note: breakdown_feedback moved to WorkLoop outcomes
        assert!(!task.skip_breakdown);
    }

    #[test]
    fn test_new_task_has_task_kind() {
        let task = Task::new("001".into(), Some("Test".into()), "Desc".into(), "now");
        assert_eq!(task.kind, TaskKind::Task);
    }

    #[test]
    fn test_task_kind_default() {
        // Test that serde default works for backward compatibility
        assert_eq!(TaskKind::default(), TaskKind::Task);
    }

    #[test]
    fn test_reviewing_workflow_transitions() {
        let mut task = Task::new("001".into(), Some("Test".into()), "Desc".into(), "now");
        task.status = TaskStatus::Working;

        // Working -> Reviewing (work approved, automated review)
        assert!(task.transition_to(TaskStatus::Reviewing, "now").is_ok());
        assert_eq!(task.status, TaskStatus::Reviewing);
        assert!(task.is_reviewing());

        // Reviewing -> Done (reviewer approved)
        assert!(task.transition_to(TaskStatus::Done, "now").is_ok());
        assert_eq!(task.status, TaskStatus::Done);
    }

    #[test]
    fn test_reviewing_rejection() {
        let mut task = Task::new("001".into(), Some("Test".into()), "Desc".into(), "now");
        task.status = TaskStatus::Reviewing;

        // Reviewing -> Working (reviewer rejected, back to worker)
        assert!(task.transition_to(TaskStatus::Working, "now").is_ok());
        assert_eq!(task.status, TaskStatus::Working);
    }

    #[test]
    fn test_reviewing_can_fail_or_block() {
        let mut task = Task::new("001".into(), Some("Test".into()), "Desc".into(), "now");
        task.status = TaskStatus::Reviewing;

        // Reviewing -> Failed
        assert!(task.status.can_transition_to(&TaskStatus::Failed));
        // Reviewing -> Blocked
        assert!(task.status.can_transition_to(&TaskStatus::Blocked));
    }

    #[test]
    fn test_is_reviewing() {
        let mut task = Task::new("001".into(), Some("Test".into()), "Desc".into(), "now");
        assert!(!task.is_reviewing());

        task.status = TaskStatus::Reviewing;
        assert!(task.is_reviewing());

        task.status = TaskStatus::Working;
        assert!(!task.is_reviewing());
    }

    // Note: test_reviewer_feedback_field removed - feedback now in WorkLoop outcomes
}
