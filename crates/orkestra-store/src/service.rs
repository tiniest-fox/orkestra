//! `SQLite` implementation of `WorkflowStore`.
//!
//! Thin dispatcher — each trait method acquires the connection lock
//! and delegates to one interaction's `execute()`.

use std::sync::{Arc, Mutex};

use orkestra_types::domain::{
    AssistantSession, Iteration, LogEntry, StageSession, Task, TaskHeader,
};
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

    fn append_log_entry(&self, stage_session_id: &str, entry: &LogEntry) -> WorkflowResult<()> {
        let conn = self.lock_conn()?;
        interactions::log_entry::append::execute(&conn, stage_session_id, entry)
    }

    fn get_log_entries(&self, stage_session_id: &str) -> WorkflowResult<Vec<LogEntry>> {
        let conn = self.lock_conn()?;
        interactions::log_entry::get::execute(&conn, stage_session_id)
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
}
