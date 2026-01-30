//! Task domain type for the workflow system.
//!
//! This is the main domain entity representing a task in the workflow.
//! Unlike the legacy Task which has separate plan/summary/breakdown fields,
//! this uses `ArtifactStore` for stage-agnostic artifact storage.

use serde::{Deserialize, Serialize};

use crate::workflow::runtime::{ArtifactStore, Phase, Status};

/// A task in the workflow system.
///
/// Represents a unit of work that progresses through workflow stages.
/// Artifacts are stored generically rather than in stage-specific fields.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct Task {
    // === Identity ===
    /// Unique identifier for this task.
    pub id: String,

    /// Task title (brief description).
    pub title: String,

    /// Full task description with requirements.
    pub description: String,

    // === State ===
    /// Current workflow status (which stage, or terminal state).
    pub status: Status,

    /// Current phase within the stage.
    pub phase: Phase,

    // === Artifacts ===
    /// Stage outputs (plan, summary, etc.) stored by name.
    #[serde(default)]
    pub artifacts: ArtifactStore,

    // === Hierarchy ===
    /// Parent task ID (if this is a subtask).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub parent_id: Option<String>,

    /// IDs of tasks this task depends on.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub depends_on: Vec<String>,

    // === Git ===
    /// Git branch name for this task.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub branch_name: Option<String>,

    /// Path to the git worktree.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub worktree_path: Option<String>,

    // === Configuration ===
    /// Whether the task runs autonomously through all stages without pausing for review.
    #[serde(default)]
    pub auto_mode: bool,

    // === Tracking ===
    /// When the task was created (RFC3339).
    pub created_at: String,

    /// When the task was last updated (RFC3339).
    pub updated_at: String,

    /// When the task was completed (RFC3339), if done.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub completed_at: Option<String>,
}

impl Task {
    /// Create a new task.
    pub fn new(
        id: impl Into<String>,
        title: impl Into<String>,
        description: impl Into<String>,
        first_stage: impl Into<String>,
        created_at: impl Into<String>,
    ) -> Self {
        let created = created_at.into();
        Self {
            id: id.into(),
            title: title.into(),
            description: description.into(),
            status: Status::active(first_stage),
            phase: Phase::Idle,
            artifacts: ArtifactStore::new(),
            parent_id: None,
            depends_on: Vec::new(),
            branch_name: None,
            worktree_path: None,
            auto_mode: false,
            created_at: created.clone(),
            updated_at: created,
            completed_at: None,
        }
    }

    /// Builder: set parent ID (for subtasks).
    #[must_use]
    pub fn with_parent(mut self, parent_id: impl Into<String>) -> Self {
        self.parent_id = Some(parent_id.into());
        self
    }

    /// Builder: set dependencies.
    #[must_use]
    pub fn with_dependencies(mut self, depends_on: Vec<String>) -> Self {
        self.depends_on = depends_on;
        self
    }

    /// Builder: enable auto mode.
    #[must_use]
    pub fn with_auto_mode(mut self, auto_mode: bool) -> Self {
        self.auto_mode = auto_mode;
        self
    }

    /// Builder: set branch name.
    #[must_use]
    pub fn with_branch(mut self, branch_name: impl Into<String>) -> Self {
        self.branch_name = Some(branch_name.into());
        self
    }

    /// Builder: set worktree path.
    #[must_use]
    pub fn with_worktree(mut self, worktree_path: impl Into<String>) -> Self {
        self.worktree_path = Some(worktree_path.into());
        self
    }

    /// Builder: set both branch and worktree (convenience for git worktree creation).
    #[must_use]
    pub fn with_git_worktree(
        mut self,
        branch_name: impl Into<String>,
        worktree_path: impl Into<String>,
    ) -> Self {
        self.branch_name = Some(branch_name.into());
        self.worktree_path = Some(worktree_path.into());
        self
    }

    /// Get the current stage name, if active.
    pub fn current_stage(&self) -> Option<&str> {
        self.status.stage()
    }

    /// Check if the task is in a terminal state.
    pub fn is_terminal(&self) -> bool {
        self.status.is_terminal()
    }

    /// Check if the task is done.
    pub fn is_done(&self) -> bool {
        matches!(self.status, Status::Done)
    }

    /// Check if the task is blocked.
    pub fn is_blocked(&self) -> bool {
        matches!(self.status, Status::Blocked { .. })
    }

    /// Check if the task is failed.
    pub fn is_failed(&self) -> bool {
        matches!(self.status, Status::Failed { .. })
    }

    /// Check if the task is archived (completed and integrated).
    pub fn is_archived(&self) -> bool {
        matches!(self.status, Status::Archived)
    }

    /// Check if the task is a subtask.
    pub fn is_subtask(&self) -> bool {
        self.parent_id.is_some()
    }

    /// Get artifact content by name.
    pub fn artifact(&self, name: &str) -> Option<&str> {
        self.artifacts.content(name)
    }

    /// Check if the task is awaiting human review.
    pub fn is_awaiting_review(&self) -> bool {
        self.phase == Phase::AwaitingReview
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::workflow::runtime::Artifact;

    #[test]
    fn test_task_new() {
        let task = Task::new(
            "task-1",
            "Implement login",
            "Add login functionality",
            "planning",
            "2025-01-24T10:00:00Z",
        );

        assert_eq!(task.id, "task-1");
        assert_eq!(task.title, "Implement login");
        assert_eq!(task.current_stage(), Some("planning"));
        assert_eq!(task.phase, Phase::Idle);
        assert!(!task.is_terminal());
        assert!(!task.is_subtask());
    }

    #[test]
    fn test_task_with_parent() {
        let task = Task::new("sub-1", "Subtask", "desc", "work", "now").with_parent("parent-1");

        assert!(task.is_subtask());
        assert_eq!(task.parent_id, Some("parent-1".into()));
    }

    #[test]
    fn test_task_with_dependencies() {
        let task = Task::new("task-1", "Task", "desc", "work", "now")
            .with_dependencies(vec!["dep-1".into(), "dep-2".into()]);

        assert_eq!(task.depends_on.len(), 2);
    }

    #[test]
    fn test_task_with_branch() {
        let task = Task::new("task-1", "Task", "desc", "work", "now").with_branch("feature/login");

        assert_eq!(task.branch_name, Some("feature/login".into()));
    }

    #[test]
    fn test_task_terminal_states() {
        let mut task = Task::new("task-1", "Task", "desc", "planning", "now");
        assert!(!task.is_terminal());
        assert!(!task.is_done());

        task.status = Status::Done;
        assert!(task.is_terminal());
        assert!(task.is_done());

        task.status = Status::Archived;
        assert!(task.is_terminal());
        assert!(task.is_archived());

        task.status = Status::failed("error");
        assert!(task.is_terminal());
        assert!(task.is_failed());

        task.status = Status::blocked("waiting");
        assert!(task.is_terminal());
        assert!(task.is_blocked());
    }

    #[test]
    fn test_task_artifacts() {
        let mut task = Task::new("task-1", "Task", "desc", "work", "now");
        assert!(task.artifact("plan").is_none());

        task.artifacts
            .set(Artifact::new("plan", "The plan content", "planning", "now"));
        assert_eq!(task.artifact("plan"), Some("The plan content"));
    }

    #[test]
    fn test_task_awaiting_review() {
        let mut task = Task::new("task-1", "Task", "desc", "planning", "now");
        assert!(!task.is_awaiting_review());

        task.phase = Phase::AwaitingReview;
        assert!(task.is_awaiting_review());
    }

    #[test]
    fn test_task_serialization() {
        let task = Task::new(
            "task-1",
            "Implement login",
            "Add login functionality",
            "planning",
            "2025-01-24T10:00:00Z",
        )
        .with_branch("feature/login");

        let json = serde_json::to_string(&task).unwrap();
        assert!(json.contains("\"id\":\"task-1\""));
        assert!(json.contains("\"branch_name\":\"feature/login\""));

        let parsed: Task = serde_json::from_str(&json).unwrap();
        assert_eq!(parsed, task);
    }

    #[test]
    fn test_task_yaml_serialization() {
        let task = Task::new("task-1", "Task", "Description", "work", "now");
        let yaml = serde_yaml::to_string(&task).unwrap();

        assert!(yaml.contains("id: task-1"));
        assert!(yaml.contains("title: Task"));
        // Empty collections should be omitted
        assert!(!yaml.contains("depends_on:"));

        let parsed: Task = serde_yaml::from_str(&yaml).unwrap();
        assert_eq!(parsed, task);
    }

    #[test]
    fn test_task_with_artifacts_serialization() {
        let mut task = Task::new("task-1", "Task", "desc", "work", "now");
        task.artifacts
            .set(Artifact::new("plan", "Plan content", "planning", "now"));

        let json = serde_json::to_string(&task).unwrap();
        assert!(json.contains("\"artifacts\""));
        assert!(json.contains("Plan content"));

        let parsed: Task = serde_json::from_str(&json).unwrap();
        assert_eq!(parsed.artifact("plan"), Some("Plan content"));
    }
}
