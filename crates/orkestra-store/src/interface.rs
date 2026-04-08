//! Workflow store port for persistence operations.
//!
//! This trait abstracts over storage backends, allowing the workflow system
//! to work with `SQLite`, in-memory stores for testing, or other backends.

use orkestra_types::domain::{
    AnnotatedLogEntry, AssistantSession, GateResult, Iteration, LogEntry, SessionType,
    StageSession, Task, TaskHeader,
};
use orkestra_types::runtime::Artifact;

// ============================================================================
// Error types
// ============================================================================

/// Error type for workflow operations.
#[derive(Debug, thiserror::Error)]
pub enum WorkflowError {
    /// Task not found.
    #[error("Task not found: {0}")]
    TaskNotFound(String),

    /// Iteration not found.
    #[error("Iteration not found: {0}")]
    IterationNotFound(String),

    /// Stage session not found.
    #[error("Stage session not found: {0}")]
    StageSessionNotFound(String),

    /// Invalid state transition.
    #[error("Invalid state transition: {0}")]
    InvalidTransition(String),

    /// Invalid state (missing required data).
    #[error("Invalid state: {0}")]
    InvalidState(String),

    /// Storage error.
    #[error("Storage error: {0}")]
    Storage(String),

    /// Lock error (for thread-safe stores).
    #[error("Lock error: failed to acquire lock")]
    Lock,

    /// Integration (merge) failed.
    #[error("Integration failed: {0}")]
    IntegrationFailed(String),

    /// Git operation failed.
    #[error("Git error: {0}")]
    GitError(String),
}

/// Result type for workflow operations.
pub type WorkflowResult<T> = Result<T, WorkflowError>;

// ============================================================================
// Trait
// ============================================================================

/// Persistence abstraction for workflow entities.
///
/// This trait defines the contract for storing and retrieving workflow
/// domain objects. Implementations can use `SQLite`, in-memory storage,
/// or any other backend.
pub trait WorkflowStore: Send + Sync {
    // -- Task --

    /// Get a task by ID.
    fn get_task(&self, id: &str) -> WorkflowResult<Option<Task>>;

    /// Save a task (insert or update).
    fn save_task(&self, task: &Task) -> WorkflowResult<()>;

    /// List all tasks.
    fn list_tasks(&self) -> WorkflowResult<Vec<Task>>;

    /// List all tasks as lightweight headers (skipping artifact deserialization).
    ///
    /// Returns `TaskHeader` structs that contain all fields except `artifacts`.
    /// Used by the orchestrator for per-tick categorization where artifact
    /// content is not needed.
    ///
    /// Default implementation maps `list_tasks()` results. The `SQLite` store
    /// overrides this with a query that skips the `artifacts` column entirely.
    fn list_task_headers(&self) -> WorkflowResult<Vec<TaskHeader>> {
        let tasks = self.list_tasks()?;
        Ok(tasks.iter().map(TaskHeader::from).collect())
    }

    /// List all tasks excluding archived ones.
    ///
    /// Default implementation filters `list_tasks()` results.
    /// Implementations may override with more efficient queries.
    fn list_active_tasks(&self) -> WorkflowResult<Vec<Task>> {
        let tasks = self.list_tasks()?;
        Ok(tasks.into_iter().filter(|t| !t.is_archived()).collect())
    }

    /// List only archived tasks.
    ///
    /// Default implementation filters `list_tasks()` results.
    /// Implementations may override with more efficient queries.
    fn list_archived_tasks(&self) -> WorkflowResult<Vec<Task>> {
        let tasks = self.list_tasks()?;
        Ok(tasks.into_iter().filter(Task::is_archived).collect())
    }

    /// List tasks by parent ID.
    fn list_subtasks(&self, parent_id: &str) -> WorkflowResult<Vec<Task>>;

    /// Delete a task by ID.
    fn delete_task(&self, id: &str) -> WorkflowResult<()>;

    /// Generate the next unique task ID.
    fn next_task_id(&self) -> WorkflowResult<String>;

    /// Generate a unique task ID for a subtask, ensuring the last word is unique among siblings.
    ///
    /// For petname-style IDs ("adverb-adjective-noun"), the last word (noun) must be
    /// unique among all direct children of the given parent. This allows using the last
    /// word as a readable short display ID.
    ///
    /// Default implementation delegates to `next_task_id()` without sibling checks.
    /// The `SQLite` store overrides this with sibling-aware generation.
    fn next_subtask_id(&self, _parent_id: &str) -> WorkflowResult<String> {
        self.next_task_id()
    }

    // -- Iteration --

    /// Get all iterations for a task.
    fn get_iterations(&self, task_id: &str) -> WorkflowResult<Vec<Iteration>>;

    /// Get iterations for a task filtered by stage.
    fn get_iterations_for_stage(
        &self,
        task_id: &str,
        stage: &str,
    ) -> WorkflowResult<Vec<Iteration>>;

    /// Get the active (not ended) iteration for a task in a stage.
    fn get_active_iteration(&self, task_id: &str, stage: &str)
        -> WorkflowResult<Option<Iteration>>;

    /// Get the latest iteration for a task in a stage (regardless of status).
    fn get_latest_iteration(&self, task_id: &str, stage: &str)
        -> WorkflowResult<Option<Iteration>>;

    /// Save an iteration (insert or update by ID).
    fn save_iteration(&self, iteration: &Iteration) -> WorkflowResult<()>;

    /// Update the `gate_result` field on an iteration incrementally as a gate script runs.
    fn save_gate_result(&self, iteration_id: &str, gate_result: &GateResult) -> WorkflowResult<()>;

    /// Delete all iterations for a task.
    fn delete_iterations(&self, task_id: &str) -> WorkflowResult<()>;

    // -- Stage Session --

    /// Get the stage session for a task and stage.
    fn get_stage_session(&self, task_id: &str, stage: &str)
        -> WorkflowResult<Option<StageSession>>;

    /// Get all stage sessions for a task.
    fn get_stage_sessions(&self, task_id: &str) -> WorkflowResult<Vec<StageSession>>;

    /// Get all active sessions that have a running agent (for crash recovery).
    fn get_sessions_with_pids(&self) -> WorkflowResult<Vec<StageSession>>;

    /// Save a stage session (insert or update).
    fn save_stage_session(&self, session: &StageSession) -> WorkflowResult<()>;

    /// Clear `agent_pid` on a stage session only if it still equals `expected_pid`.
    ///
    /// Returns `true` if the PID was cleared (the row matched), `false` if the
    /// PID was already different (another writer such as `exit_chat` got there
    /// first). This is an atomic compare-and-clear that avoids a read-modify-write
    /// race in background threads that flush the PID after the agent exits.
    fn clear_agent_pid_for_session(
        &self,
        session_id: &str,
        expected_pid: u32,
    ) -> WorkflowResult<bool>;

    /// Delete all stage sessions for a task.
    fn delete_stage_sessions(&self, task_id: &str) -> WorkflowResult<()>;

    // -- Log Entry --

    /// Append a log entry to a stage session.
    ///
    /// The sequence number is auto-assigned as the next value for the session.
    /// `iteration_id` associates this entry with the active iteration at write time.
    fn append_log_entry(
        &self,
        stage_session_id: &str,
        entry: &LogEntry,
        iteration_id: Option<&str>,
    ) -> WorkflowResult<()>;

    /// Get all log entries for a stage session, ordered by sequence number.
    fn get_log_entries(&self, stage_session_id: &str) -> WorkflowResult<Vec<LogEntry>>;

    /// Get log entries with iteration metadata for a stage session.
    fn get_annotated_log_entries(
        &self,
        stage_session_id: &str,
    ) -> WorkflowResult<Vec<AnnotatedLogEntry>>;

    /// Get the most recent log entry for a stage session.
    ///
    /// Returns `None` if the session has no log entries.
    fn get_latest_log_entry(&self, stage_session_id: &str) -> WorkflowResult<Option<LogEntry>>;

    /// Delete all log entries associated with a task (via its stage sessions).
    fn delete_log_entries_for_task(&self, task_id: &str) -> WorkflowResult<()>;

    // -- Assistant Session --

    /// Get an assistant session by ID.
    fn get_assistant_session(&self, id: &str) -> WorkflowResult<Option<AssistantSession>>;

    /// Save an assistant session (insert or update).
    fn save_assistant_session(&self, session: &AssistantSession) -> WorkflowResult<()>;

    /// List all assistant sessions, ordered by `created_at` descending.
    fn list_assistant_sessions(&self) -> WorkflowResult<Vec<AssistantSession>>;

    /// Delete an assistant session by ID.
    fn delete_assistant_session(&self, id: &str) -> WorkflowResult<()>;

    /// Get the assistant session for a specific task and session type.
    ///
    /// Default implementation scans `list_assistant_sessions()`. The `SQLite` store
    /// overrides this with a direct indexed query.
    fn get_assistant_session_for_task(
        &self,
        task_id: &str,
        session_type: &SessionType,
    ) -> WorkflowResult<Option<AssistantSession>> {
        let sessions = self.list_assistant_sessions()?;
        Ok(sessions
            .into_iter()
            .find(|s| s.task_id.as_deref() == Some(task_id) && &s.session_type == session_type))
    }

    /// Get or atomically create the assistant session for a task and session type.
    ///
    /// Returns the existing session if one already exists for this `(task_id, session_type)` pair,
    /// otherwise saves `new_session` and returns it. Default implementation uses a read-then-write
    /// sequence (not atomic). The `SQLite` store overrides with `INSERT OR IGNORE` for
    /// true atomicity.
    fn get_or_create_assistant_session_for_task(
        &self,
        task_id: &str,
        session_type: &SessionType,
        new_session: &AssistantSession,
    ) -> WorkflowResult<AssistantSession> {
        if let Some(existing) = self.get_assistant_session_for_task(task_id, session_type)? {
            return Ok(existing);
        }
        self.save_assistant_session(new_session)?;
        Ok(new_session.clone())
    }

    /// List project-level assistant sessions (excludes task-scoped sessions).
    ///
    /// Returns sessions ordered by `created_at` descending.
    /// Default implementation filters `list_assistant_sessions()`. The `SQLite` store
    /// overrides this with a direct query.
    fn list_project_assistant_sessions(&self) -> WorkflowResult<Vec<AssistantSession>> {
        let sessions = self.list_assistant_sessions()?;
        Ok(sessions
            .into_iter()
            .filter(|s| s.task_id.is_none())
            .collect())
    }

    // -- Assistant Log Entry --

    /// Append a log entry to an assistant session.
    ///
    /// The sequence number is auto-assigned as the next value for the session.
    fn append_assistant_log_entry(
        &self,
        assistant_session_id: &str,
        entry: &LogEntry,
    ) -> WorkflowResult<()>;

    /// Get all log entries for an assistant session, ordered by sequence number.
    fn get_assistant_log_entries(
        &self,
        assistant_session_id: &str,
    ) -> WorkflowResult<Vec<LogEntry>>;

    // -- Bulk Read --

    /// List all iterations across all tasks.
    ///
    /// Default implementation loads tasks then queries per-task.
    /// Implementations should override with a single query for efficiency.
    fn list_all_iterations(&self) -> WorkflowResult<Vec<Iteration>> {
        let tasks = self.list_tasks()?;
        let mut all = Vec::new();
        for task in &tasks {
            all.extend(self.get_iterations(&task.id)?);
        }
        Ok(all)
    }

    /// List all stage sessions across all tasks.
    ///
    /// Default implementation loads tasks then queries per-task.
    /// Implementations should override with a single query for efficiency.
    fn list_all_stage_sessions(&self) -> WorkflowResult<Vec<StageSession>> {
        let tasks = self.list_tasks()?;
        let mut all = Vec::new();
        for task in &tasks {
            all.extend(self.get_stage_sessions(&task.id)?);
        }
        Ok(all)
    }

    /// List iterations scoped to a set of task IDs.
    ///
    /// More efficient than `list_all_iterations()` when only a subset of tasks
    /// is needed (e.g., active tasks for the UI). Default implementation queries
    /// per-task; the `SQLite` store uses a single `IN` clause query.
    fn list_iterations_for_tasks(&self, task_ids: &[&str]) -> WorkflowResult<Vec<Iteration>> {
        let mut all = Vec::new();
        for id in task_ids {
            all.extend(self.get_iterations(id)?);
        }
        Ok(all)
    }

    /// List stage sessions scoped to a set of task IDs.
    ///
    /// More efficient than `list_all_stage_sessions()` when only a subset of tasks
    /// is needed. Default implementation queries per-task; the `SQLite` store uses
    /// a single `IN` clause query.
    fn list_stage_sessions_for_tasks(
        &self,
        task_ids: &[&str],
    ) -> WorkflowResult<Vec<StageSession>> {
        let mut all = Vec::new();
        for id in task_ids {
            all.extend(self.get_stage_sessions(id)?);
        }
        Ok(all)
    }

    /// List archived subtasks for multiple parent IDs in one query.
    ///
    /// Returns subtasks that are archived and belong to any of the given parent IDs.
    /// Default implementation queries per-parent and filters; the `SQLite` store uses
    /// a single `IN` clause query.
    fn list_archived_subtasks_by_parents(&self, parent_ids: &[&str]) -> WorkflowResult<Vec<Task>> {
        let mut all = Vec::new();
        for id in parent_ids {
            let subtasks = self.list_subtasks(id)?;
            all.extend(subtasks.into_iter().filter(Task::is_archived));
        }
        Ok(all)
    }

    // -- Artifact --

    /// Save an artifact for a task (insert or replace by name).
    fn save_artifact(&self, task_id: &str, artifact: &Artifact) -> WorkflowResult<()>;

    /// Get a single artifact by task ID and name.
    fn get_artifact(&self, task_id: &str, name: &str) -> WorkflowResult<Option<Artifact>>;

    /// Get all artifacts for a task.
    fn get_artifacts(&self, task_id: &str) -> WorkflowResult<Vec<Artifact>>;

    /// Delete all artifacts for a task.
    fn delete_artifacts(&self, task_id: &str) -> WorkflowResult<()>;

    // -- Bulk Write --

    /// Delete an entire task tree (tasks, iterations, stage sessions) atomically.
    ///
    /// `task_ids` should include the parent task and all descendant subtask IDs.
    /// Implementations may override to use database transactions for atomicity.
    fn delete_task_tree(&self, task_ids: &[String]) -> WorkflowResult<()> {
        for id in task_ids {
            self.delete_log_entries_for_task(id)?;
            self.delete_stage_sessions(id)?;
            self.delete_iterations(id)?;
            self.delete_artifacts(id)?;
            self.delete_task(id)?;
        }
        Ok(())
    }
}
