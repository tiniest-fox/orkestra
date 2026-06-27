//! `SQLite` implementation of `WorkflowStore`.
//!
//! Thin dispatcher — each trait method acquires the connection lock
//! and delegates to one interaction's `execute()`.

use std::sync::{Arc, Mutex};

use orkestra_types::domain::{
    AnnotatedLogEntry, AssistantSession, GateResult, Iteration, LogEntry, SessionType,
    StageSession, Task, TaskHeader, WorkflowArtifact,
};

use crate::types::WorktreeRecord;
use rusqlite::Connection;

use crate::interactions;
use crate::interface::{WorkflowError, WorkflowResult, WorkflowStore};

/// `SQLite` implementation of `WorkflowStore`.
///
/// Uses the `workflow_tasks` and `workflow_iterations` tables.
pub struct SqliteWorkflowStore {
    conn: Arc<Mutex<Connection>>,
}

impl SqliteWorkflowStore {
    /// Create a new store with a shared database connection.
    ///
    /// The connection should already have migrations applied.
    pub fn new(conn: Arc<Mutex<Connection>>) -> Self {
        Self { conn }
    }

    /// Helper to map lock errors.
    fn lock_conn(&self) -> WorkflowResult<std::sync::MutexGuard<'_, Connection>> {
        self.conn.lock().map_err(|_| WorkflowError::Lock)
    }
}

impl WorkflowStore for SqliteWorkflowStore {
    // -- Task --

    fn get_task(&self, id: &str) -> WorkflowResult<Option<Task>> {
        let conn = self.lock_conn()?;
        interactions::task::get::execute(&conn, id)
    }

    fn save_task(&self, task: &Task) -> WorkflowResult<()> {
        let conn = self.lock_conn()?;
        interactions::task::save::execute(&conn, task)
    }

    fn list_tasks(&self) -> WorkflowResult<Vec<Task>> {
        let conn = self.lock_conn()?;
        interactions::task::list::execute(&conn)
    }

    fn list_task_headers(&self) -> WorkflowResult<Vec<TaskHeader>> {
        let conn = self.lock_conn()?;
        interactions::task::list_headers::execute(&conn)
    }

    fn list_subtasks(&self, parent_id: &str) -> WorkflowResult<Vec<Task>> {
        let conn = self.lock_conn()?;
        interactions::task::list_subtasks::execute(&conn, parent_id)
    }

    fn delete_task(&self, id: &str) -> WorkflowResult<()> {
        let conn = self.lock_conn()?;
        interactions::task::delete::execute(&conn, id)
    }

    fn next_task_id(&self) -> WorkflowResult<String> {
        let conn = self.lock_conn()?;
        interactions::task::next_id::execute(&conn)
    }

    fn next_subtask_id(&self, parent_id: &str) -> WorkflowResult<String> {
        let conn = self.lock_conn()?;
        interactions::task::next_subtask_id::execute(&conn, parent_id)
    }

    fn touch_task(&self, id: &str) -> WorkflowResult<()> {
        let conn = self.lock_conn()?;
        interactions::task::touch::execute(&conn, id)
    }

    fn update_task_title(&self, id: &str, title: &str) -> WorkflowResult<()> {
        let conn = self.lock_conn()?;
        interactions::task::update_title::execute(&conn, id, title)
    }

    // -- Iteration --

    fn get_iterations(&self, task_id: &str) -> WorkflowResult<Vec<Iteration>> {
        let conn = self.lock_conn()?;
        interactions::iteration::get_all::execute(&conn, task_id)
    }

    fn get_iterations_for_stage(
        &self,
        task_id: &str,
        stage: &str,
    ) -> WorkflowResult<Vec<Iteration>> {
        let conn = self.lock_conn()?;
        interactions::iteration::get_for_stage::execute(&conn, task_id, stage)
    }

    fn get_active_iteration(
        &self,
        task_id: &str,
        stage: &str,
    ) -> WorkflowResult<Option<Iteration>> {
        let conn = self.lock_conn()?;
        interactions::iteration::get_active::execute(&conn, task_id, stage)
    }

    fn get_latest_iteration(
        &self,
        task_id: &str,
        stage: &str,
    ) -> WorkflowResult<Option<Iteration>> {
        let conn = self.lock_conn()?;
        interactions::iteration::get_latest::execute(&conn, task_id, stage)
    }

    fn save_iteration(&self, iteration: &Iteration) -> WorkflowResult<()> {
        let conn = self.lock_conn()?;
        interactions::iteration::save::execute(&conn, iteration)
    }

    fn save_gate_result(&self, iteration_id: &str, gate_result: &GateResult) -> WorkflowResult<()> {
        let conn = self.lock_conn()?;
        interactions::iteration::save_gate_result::execute(&conn, iteration_id, gate_result)
    }

    fn delete_iterations(&self, task_id: &str) -> WorkflowResult<()> {
        let conn = self.lock_conn()?;
        interactions::iteration::delete::execute(&conn, task_id)
    }

    fn list_all_iterations(&self) -> WorkflowResult<Vec<Iteration>> {
        let conn = self.lock_conn()?;
        interactions::iteration::list_all::execute(&conn)
    }

    fn list_iterations_for_tasks(&self, task_ids: &[&str]) -> WorkflowResult<Vec<Iteration>> {
        let conn = self.lock_conn()?;
        interactions::iteration::list_for_tasks::execute(&conn, task_ids)
    }

    // -- Stage Session --

    fn get_stage_session(
        &self,
        task_id: &str,
        stage: &str,
    ) -> WorkflowResult<Option<StageSession>> {
        let conn = self.lock_conn()?;
        interactions::session::get::execute(&conn, task_id, stage)
    }

    fn get_stage_sessions(&self, task_id: &str) -> WorkflowResult<Vec<StageSession>> {
        let conn = self.lock_conn()?;
        interactions::session::get_all::execute(&conn, task_id)
    }

    fn get_sessions_with_pids(&self) -> WorkflowResult<Vec<StageSession>> {
        let conn = self.lock_conn()?;
        interactions::session::get_with_pids::execute(&conn)
    }

    fn save_stage_session(&self, session: &StageSession) -> WorkflowResult<()> {
        let conn = self.lock_conn()?;
        interactions::session::save::execute(&conn, session)
    }

    fn clear_agent_pid_for_session(
        &self,
        session_id: &str,
        expected_pid: u32,
    ) -> WorkflowResult<bool> {
        let conn = self.lock_conn()?;
        interactions::session::clear_agent_pid::execute(&conn, session_id, expected_pid)
    }

    fn delete_stage_sessions(&self, task_id: &str) -> WorkflowResult<()> {
        let conn = self.lock_conn()?;
        interactions::session::delete::execute(&conn, task_id)
    }

    fn list_all_stage_sessions(&self) -> WorkflowResult<Vec<StageSession>> {
        let conn = self.lock_conn()?;
        interactions::session::list_all::execute(&conn)
    }

    fn list_stage_sessions_for_tasks(
        &self,
        task_ids: &[&str],
    ) -> WorkflowResult<Vec<StageSession>> {
        let conn = self.lock_conn()?;
        interactions::session::list_for_tasks::execute(&conn, task_ids)
    }

    fn list_archived_subtasks_by_parents(&self, parent_ids: &[&str]) -> WorkflowResult<Vec<Task>> {
        let conn = self.lock_conn()?;
        interactions::task::list_archived_by_parents::execute(&conn, parent_ids)
    }

    fn delete_task_tree(&self, task_ids: &[String]) -> WorkflowResult<()> {
        let conn = self.lock_conn()?;
        interactions::task::delete_tree::execute(&conn, task_ids)
    }

    // -- Log Entry --

    fn append_log_entry(
        &self,
        stage_session_id: &str,
        entry: &LogEntry,
        iteration_id: Option<&str>,
    ) -> WorkflowResult<()> {
        let conn = self.lock_conn()?;
        interactions::log_entry::append::execute(&conn, stage_session_id, entry, iteration_id)
    }

    fn get_log_entries(&self, stage_session_id: &str) -> WorkflowResult<Vec<LogEntry>> {
        let conn = self.lock_conn()?;
        interactions::log_entry::get::execute(&conn, stage_session_id)
    }

    fn get_log_entries_after(
        &self,
        stage_session_id: &str,
        after_sequence: u64,
    ) -> WorkflowResult<(Vec<LogEntry>, Option<u64>)> {
        let conn = self.lock_conn()?;
        interactions::log_entry::get_after::execute(&conn, stage_session_id, after_sequence)
    }

    fn get_annotated_log_entries(
        &self,
        stage_session_id: &str,
    ) -> WorkflowResult<Vec<AnnotatedLogEntry>> {
        let conn = self.lock_conn()?;
        interactions::log_entry::get_annotated::execute(&conn, stage_session_id)
    }

    fn get_latest_log_entry(&self, stage_session_id: &str) -> WorkflowResult<Option<LogEntry>> {
        let conn = self.lock_conn()?;
        interactions::log_entry::get_latest::execute(&conn, stage_session_id)
    }

    fn delete_log_entries_for_task(&self, task_id: &str) -> WorkflowResult<()> {
        let conn = self.lock_conn()?;
        interactions::log_entry::delete_for_task::execute(&conn, task_id)
    }

    // -- Assistant Session --

    fn get_assistant_session(&self, id: &str) -> WorkflowResult<Option<AssistantSession>> {
        let conn = self.lock_conn()?;
        interactions::assistant::get_session::execute(&conn, id)
    }

    fn save_assistant_session(&self, session: &AssistantSession) -> WorkflowResult<()> {
        let conn = self.lock_conn()?;
        interactions::assistant::save_session::execute(&conn, session)
    }

    fn list_assistant_sessions(&self) -> WorkflowResult<Vec<AssistantSession>> {
        let conn = self.lock_conn()?;
        interactions::assistant::list_sessions::execute(&conn)
    }

    fn delete_assistant_session(&self, id: &str) -> WorkflowResult<()> {
        let conn = self.lock_conn()?;
        interactions::assistant::delete_session::execute(&conn, id)
    }

    fn get_assistant_session_for_task(
        &self,
        task_id: &str,
        session_type: &SessionType,
    ) -> WorkflowResult<Option<AssistantSession>> {
        let conn = self.lock_conn()?;
        interactions::assistant::get_session_for_task::execute(&conn, task_id, session_type)
    }

    fn get_or_create_assistant_session_for_task(
        &self,
        task_id: &str,
        session_type: &SessionType,
        new_session: &AssistantSession,
    ) -> WorkflowResult<AssistantSession> {
        let conn = self.lock_conn()?;
        interactions::assistant::get_or_create_for_task::execute(
            &conn,
            task_id,
            session_type,
            new_session,
        )
    }

    fn list_project_assistant_sessions(&self) -> WorkflowResult<Vec<AssistantSession>> {
        let conn = self.lock_conn()?;
        interactions::assistant::list_project_sessions::execute(&conn)
    }

    fn append_assistant_log_entry(
        &self,
        assistant_session_id: &str,
        entry: &LogEntry,
    ) -> WorkflowResult<()> {
        let conn = self.lock_conn()?;
        interactions::assistant::append_log::execute(&conn, assistant_session_id, entry)
    }

    fn get_assistant_log_entries(
        &self,
        assistant_session_id: &str,
    ) -> WorkflowResult<Vec<LogEntry>> {
        let conn = self.lock_conn()?;
        interactions::assistant::get_logs::execute(&conn, assistant_session_id)
    }

    // -- Worktree --

    fn save_worktree_record(&self, record: &WorktreeRecord) -> WorkflowResult<()> {
        let conn = self.lock_conn()?;
        interactions::worktree::save::execute(&conn, record)
    }

    fn get_worktree_record(&self, task_id: &str) -> WorkflowResult<Option<WorktreeRecord>> {
        let conn = self.lock_conn()?;
        interactions::worktree::get::execute(&conn, task_id)
    }

    fn delete_worktree_record(&self, task_id: &str) -> WorkflowResult<()> {
        let conn = self.lock_conn()?;
        interactions::worktree::delete::execute(&conn, task_id)
    }

    fn list_worktree_records(&self) -> WorkflowResult<Vec<WorktreeRecord>> {
        let conn = self.lock_conn()?;
        interactions::worktree::list_all::execute(&conn)
    }

    // -- Artifact --

    fn save_artifact(&self, artifact: &WorkflowArtifact) -> WorkflowResult<()> {
        let conn = self.lock_conn()?;
        interactions::artifact::save::execute(&conn, artifact)
    }

    fn get_artifact(&self, id: &str) -> WorkflowResult<Option<WorkflowArtifact>> {
        let conn = self.lock_conn()?;
        interactions::artifact::get::execute(&conn, id)
    }

    fn get_latest_artifact(
        &self,
        task_id: &str,
        stage: &str,
        name: &str,
    ) -> WorkflowResult<Option<WorkflowArtifact>> {
        let conn = self.lock_conn()?;
        interactions::artifact::get_latest::execute(&conn, task_id, stage, name)
    }

    fn list_artifacts_for_task(&self, task_id: &str) -> WorkflowResult<Vec<WorkflowArtifact>> {
        let conn = self.lock_conn()?;
        interactions::artifact::list_for_task::execute(&conn, task_id)
    }

    fn delete_artifacts_for_task(&self, task_id: &str) -> WorkflowResult<()> {
        let conn = self.lock_conn()?;
        interactions::artifact::delete_for_task::execute(&conn, task_id)
    }
}

// ============================================================================
// Tests
// ============================================================================

#[cfg(test)]
mod tests {
    use super::*;
    use crate::connection::DatabaseConnection;
    use crate::types::{WorktreeRecord, WorktreeStatus};

    fn make_store() -> SqliteWorkflowStore {
        let db = DatabaseConnection::in_memory().unwrap();
        SqliteWorkflowStore::new(db.shared())
    }

    fn make_record(task_id: &str) -> WorktreeRecord {
        WorktreeRecord {
            task_id: task_id.to_string(),
            status: WorktreeStatus::Pending,
            base_branch: Some("main".to_string()),
            worktree_path: None,
            branch_name: None,
            base_commit: None,
            created_at: "2026-01-01T00:00:00Z".to_string(),
        }
    }

    #[test]
    fn worktree_record_save_and_get() {
        let store = make_store();
        let record = make_record("task-abc");

        store.save_worktree_record(&record).unwrap();

        let loaded = store.get_worktree_record("task-abc").unwrap().unwrap();
        assert_eq!(loaded.task_id, "task-abc");
        assert_eq!(loaded.status, WorktreeStatus::Pending);
        assert_eq!(loaded.base_branch.as_deref(), Some("main"));
        assert!(loaded.worktree_path.is_none());
    }

    #[test]
    fn worktree_record_get_nonexistent_returns_none() {
        let store = make_store();
        let result = store.get_worktree_record("no-such-task").unwrap();
        assert!(result.is_none());
    }

    #[test]
    fn worktree_record_delete_removes_it() {
        let store = make_store();
        let record = make_record("task-del");
        store.save_worktree_record(&record).unwrap();

        store.delete_worktree_record("task-del").unwrap();

        assert!(store.get_worktree_record("task-del").unwrap().is_none());
    }

    #[test]
    fn worktree_record_list_returns_all() {
        let store = make_store();
        store.save_worktree_record(&make_record("task-1")).unwrap();
        store.save_worktree_record(&make_record("task-2")).unwrap();
        store.save_worktree_record(&make_record("task-3")).unwrap();

        let records = store.list_worktree_records().unwrap();
        assert_eq!(records.len(), 3);
    }

    #[test]
    fn worktree_record_update_replaces_existing() {
        let store = make_store();
        let mut record = make_record("task-upd");
        store.save_worktree_record(&record).unwrap();

        record.status = WorktreeStatus::Ready;
        record.worktree_path = Some("/tmp/worktrees/task-upd".to_string());
        store.save_worktree_record(&record).unwrap();

        let loaded = store.get_worktree_record("task-upd").unwrap().unwrap();
        assert_eq!(loaded.status, WorktreeStatus::Ready);
        assert_eq!(
            loaded.worktree_path.as_deref(),
            Some("/tmp/worktrees/task-upd")
        );
    }

    #[test]
    fn next_task_id_skips_ids_in_worktrees_table() {
        let db = DatabaseConnection::in_memory().unwrap();
        let conn = db.shared();

        // Manually insert a row into the worktrees table so next_task_id must skip it
        {
            let locked = conn.lock().unwrap();
            locked
                .execute(
                    "INSERT INTO worktrees (task_id, status, created_at) VALUES (?, 'pending', ?)",
                    rusqlite::params!["taken-id", "2026-01-01T00:00:00Z"],
                )
                .unwrap();
        }

        let store = SqliteWorkflowStore::new(conn);

        // The store's next_task_id should not return "taken-id"
        for _ in 0..20 {
            let id = store.next_task_id().unwrap();
            assert_ne!(
                id, "taken-id",
                "next_task_id returned a worktrees-reserved ID"
            );
        }
    }
}
