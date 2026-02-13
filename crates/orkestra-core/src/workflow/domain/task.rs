//! Task domain type for the workflow system.
//!
//! This is the main domain entity representing a task in the workflow.
//! Unlike the legacy Task which has separate plan/summary/breakdown fields,
//! this uses `ArtifactStore` for stage-agnostic artifact storage.

use std::collections::HashSet;

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

    /// Short display ID for subtasks (last word of full ID, e.g., "bird"), unique within a parent.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub short_id: Option<String>,

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

    /// The branch this task was created from (merge/rebase target).
    ///
    /// Always set at task creation time:
    /// - Parent tasks: from UI branch selector, or `git.current_branch()`
    /// - Subtasks: from parent's `branch_name`
    #[serde(default)]
    pub base_branch: String,

    /// Git commit SHA of the base branch at the time the worktree was created.
    #[serde(default)]
    pub base_commit: String,

    /// URL of the pull request created for this task's branch.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub pr_url: Option<String>,

    // === Configuration ===
    /// Whether the task runs autonomously through all stages without pausing for review.
    #[serde(default)]
    pub auto_mode: bool,

    /// Named flow for this task (e.g., "`quick_fix`"). None = default (full pipeline).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub flow: Option<String>,

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
            short_id: None,
            depends_on: Vec::new(),
            branch_name: None,
            worktree_path: None,
            base_branch: String::new(),
            base_commit: String::new(),
            pr_url: None,
            auto_mode: false,
            flow: None,
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

    /// Builder: set base branch (the branch this task was created from).
    #[must_use]
    pub fn with_base_branch(mut self, base_branch: impl Into<String>) -> Self {
        self.base_branch = base_branch.into();
        self
    }

    /// Builder: set base commit (the commit SHA of the base branch at worktree creation).
    #[must_use]
    pub fn with_base_commit(mut self, base_commit: impl Into<String>) -> Self {
        self.base_commit = base_commit.into();
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

    /// Check if the task needs human review (awaiting review + active status).
    pub fn needs_review(&self) -> bool {
        self.is_awaiting_review() && self.status.is_active()
    }

    /// Whether this task has an open pull request (one-way door — cannot merge or re-open PR).
    pub fn has_open_pr(&self) -> bool {
        self.pr_url.is_some()
    }
}

/// Lightweight task metadata for orchestrator routing decisions.
///
/// Contains all `Task` fields except `artifacts` — the heavy `ArtifactStore`
/// that holds all stage outputs as deserialized JSON. This avoids the cost of
/// deserializing artifact data when the orchestrator only needs to categorize
/// tasks by status/phase for dispatch.
#[derive(Debug, Clone)]
pub struct TaskHeader {
    pub id: String,
    pub title: String,
    pub description: String,
    pub status: Status,
    pub phase: Phase,
    pub parent_id: Option<String>,
    pub short_id: Option<String>,
    pub depends_on: Vec<String>,
    pub branch_name: Option<String>,
    pub worktree_path: Option<String>,
    pub base_branch: String,
    pub base_commit: String,
    pub pr_url: Option<String>,
    pub auto_mode: bool,
    pub flow: Option<String>,
    pub created_at: String,
    pub updated_at: String,
    pub completed_at: Option<String>,
}

impl TaskHeader {
    /// Check if the task is done.
    pub fn is_done(&self) -> bool {
        matches!(self.status, Status::Done)
    }

    /// Check if the task is archived (completed and integrated).
    pub fn is_archived(&self) -> bool {
        matches!(self.status, Status::Archived)
    }

    /// Check if the task is a subtask.
    pub fn is_subtask(&self) -> bool {
        self.parent_id.is_some()
    }

    /// Get the current stage name, if active.
    pub fn current_stage(&self) -> Option<&str> {
        self.status.stage()
    }

    /// Whether this task has an open pull request (one-way door — cannot merge or re-open PR).
    pub fn has_open_pr(&self) -> bool {
        self.pr_url.is_some()
    }
}

impl From<&Task> for TaskHeader {
    fn from(task: &Task) -> Self {
        Self {
            id: task.id.clone(),
            title: task.title.clone(),
            description: task.description.clone(),
            status: task.status.clone(),
            phase: task.phase,
            parent_id: task.parent_id.clone(),
            short_id: task.short_id.clone(),
            depends_on: task.depends_on.clone(),
            branch_name: task.branch_name.clone(),
            worktree_path: task.worktree_path.clone(),
            base_branch: task.base_branch.clone(),
            base_commit: task.base_commit.clone(),
            pr_url: task.pr_url.clone(),
            auto_mode: task.auto_mode,
            flow: task.flow.clone(),
            created_at: task.created_at.clone(),
            updated_at: task.updated_at.clone(),
            completed_at: task.completed_at.clone(),
        }
    }
}

/// Pre-computed categorization of tasks for a single orchestrator tick.
///
/// Built once from `list_task_headers()` at the start of each tick. Each phase
/// method reads from the relevant bucket instead of querying the store independently.
pub struct TickSnapshot {
    /// All task headers (for subtask filtering in parent completion check).
    pub all: Vec<TaskHeader>,
    /// Tasks in `AwaitingSetup` phase.
    pub awaiting_setup: Vec<TaskHeader>,
    /// Parents in `WaitingOnChildren` status + `Idle` phase.
    pub waiting_parents: Vec<TaskHeader>,
    /// Tasks in `Idle` phase + `Active` status (candidates for agent spawning).
    pub idle_active: Vec<TaskHeader>,
    /// Tasks that are `Done` + `Idle` + have a worktree (candidates for integration).
    pub idle_done_with_worktree: Vec<TaskHeader>,
    /// Whether any task is currently in `Integrating` phase.
    pub has_integrating: bool,
    /// IDs of `Archived` tasks (for subtask dependency checking — setup waits for integration).
    pub integrated_ids: HashSet<String>,
    /// IDs of `Done` or `Archived` tasks (for general dependency checking).
    pub done_ids: HashSet<String>,
}

impl TickSnapshot {
    /// Build a snapshot from a list of task headers in a single pass.
    pub fn build(headers: Vec<TaskHeader>) -> Self {
        let mut awaiting_setup = Vec::new();
        let mut waiting_parents = Vec::new();
        let mut idle_active = Vec::new();
        let mut idle_done_with_worktree = Vec::new();
        let mut has_integrating = false;
        let mut integrated_ids = HashSet::new();
        let mut done_ids = HashSet::new();

        for header in &headers {
            // Build ID sets
            if header.is_archived() {
                integrated_ids.insert(header.id.clone());
                done_ids.insert(header.id.clone());
            } else if header.is_done() {
                done_ids.insert(header.id.clone());
            }

            // Track integrating
            if header.phase == Phase::Integrating {
                has_integrating = true;
            }

            // Categorize into buckets
            match header.phase {
                Phase::AwaitingSetup => {
                    awaiting_setup.push(header.clone());
                }
                Phase::Idle => {
                    if header.status.is_waiting_on_children() {
                        waiting_parents.push(header.clone());
                    }
                    if header.status.is_active() {
                        idle_active.push(header.clone());
                    }
                    if header.is_done() && header.worktree_path.is_some() {
                        idle_done_with_worktree.push(header.clone());
                    }
                }
                _ => {}
            }
        }

        Self {
            all: headers,
            awaiting_setup,
            waiting_parents,
            idle_active,
            idle_done_with_worktree,
            has_integrating,
            integrated_ids,
            done_ids,
        }
    }

    /// Check if the snapshot has no actionable tasks (everything idle/terminal).
    ///
    /// Note: does not account for Finishing/Finished tasks (commit pipeline
    /// queries the DB directly). Those are transient states that resolve within
    /// one tick, so missing them here just means one extra idle-sleep cycle.
    pub fn is_idle(&self) -> bool {
        self.awaiting_setup.is_empty()
            && self.waiting_parents.is_empty()
            && self.idle_active.is_empty()
            && self.idle_done_with_worktree.is_empty()
    }
}

/// Extract the last word from a hyphenated task ID for use as a short display ID.
///
/// For petname-style IDs like "tunefully-cogent-bird", returns "bird".
/// The last word is guaranteed unique among siblings at ID generation time.
pub fn extract_short_id(task_id: &str) -> String {
    task_id.rsplit('-').next().unwrap_or(task_id).to_string()
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
    fn test_extract_short_id() {
        assert_eq!(extract_short_id("tunefully-cogent-bird"), "bird");
        assert_eq!(extract_short_id("happily-lusty-fulmar"), "fulmar");
        assert_eq!(extract_short_id("adverb-adjective-noun001"), "noun001");
        assert_eq!(extract_short_id("single"), "single");
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
