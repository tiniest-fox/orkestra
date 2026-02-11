//! `SQLite` workflow store implementation.
//!
//! This adapter stores workflow tasks and iterations in `SQLite` tables
//! (`workflow_tasks` and `workflow_iterations`) that are separate from legacy tables.

use std::sync::{Arc, Mutex};

use petname::Generator;
use rusqlite::{params, Connection, OptionalExtension};

use crate::orkestra_debug;
use crate::workflow::domain::{
    AssistantSession, Iteration, LogEntry, SessionState, StageSession, Task,
};
use crate::workflow::ports::{WorkflowError, WorkflowResult, WorkflowStore};
use crate::workflow::runtime::{Phase, Status};

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
    fn get_task(&self, id: &str) -> WorkflowResult<Option<Task>> {
        let conn = self.lock_conn()?;

        let result = conn
            .query_row(
                "SELECT id, title, description, status, phase, artifacts,
                        parent_id, depends_on, branch_name, worktree_path,
                        auto_mode, created_at, updated_at, completed_at,
                        base_branch, flow, short_id, base_commit
                 FROM workflow_tasks WHERE id = ?",
                params![id],
                row_to_task,
            )
            .optional()
            .map_err(|e| WorkflowError::Storage(e.to_string()))?;

        Ok(result)
    }

    fn save_task(&self, task: &Task) -> WorkflowResult<()> {
        let conn = self.lock_conn()?;

        let status_json = serde_json::to_string(&task.status)
            .map_err(|e| WorkflowError::Storage(e.to_string()))?;
        let phase_str = phase_to_str(task.phase);
        let artifacts_json = serde_json::to_string(&task.artifacts)
            .map_err(|e| WorkflowError::Storage(e.to_string()))?;
        let depends_json = serde_json::to_string(&task.depends_on)
            .map_err(|e| WorkflowError::Storage(e.to_string()))?;

        orkestra_debug!(
            "db",
            "save_task {}: phase={}, status={}",
            task.id,
            phase_str,
            status_json
        );

        conn.execute(
            "INSERT OR REPLACE INTO workflow_tasks (
                id, title, description, status, phase, artifacts,
                parent_id, depends_on, branch_name, worktree_path,
                auto_mode, created_at, updated_at, completed_at,
                base_branch, flow, short_id, base_commit
             ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
            params![
                task.id,
                task.title,
                task.description,
                status_json,
                phase_str,
                artifacts_json,
                task.parent_id,
                depends_json,
                task.branch_name,
                task.worktree_path,
                task.auto_mode,
                task.created_at,
                task.updated_at,
                task.completed_at,
                task.base_branch,
                task.flow,
                task.short_id,
                task.base_commit,
            ],
        )
        .map_err(|e| WorkflowError::Storage(e.to_string()))?;

        Ok(())
    }

    fn list_tasks(&self) -> WorkflowResult<Vec<Task>> {
        let conn = self.lock_conn()?;

        let mut stmt = conn
            .prepare(
                "SELECT id, title, description, status, phase, artifacts,
                        parent_id, depends_on, branch_name, worktree_path,
                        auto_mode, created_at, updated_at, completed_at,
                        base_branch, flow, short_id, base_commit
                 FROM workflow_tasks ORDER BY created_at",
            )
            .map_err(|e| WorkflowError::Storage(e.to_string()))?;

        let rows = stmt
            .query_map([], row_to_task)
            .map_err(|e| WorkflowError::Storage(e.to_string()))?;

        let mut tasks = Vec::new();
        for row in rows {
            tasks.push(row.map_err(|e| WorkflowError::Storage(e.to_string()))?);
        }

        Ok(tasks)
    }

    fn list_subtasks(&self, parent_id: &str) -> WorkflowResult<Vec<Task>> {
        let conn = self.lock_conn()?;

        let mut stmt = conn
            .prepare(
                "SELECT id, title, description, status, phase, artifacts,
                        parent_id, depends_on, branch_name, worktree_path,
                        auto_mode, created_at, updated_at, completed_at,
                        base_branch, flow, short_id, base_commit
                 FROM workflow_tasks WHERE parent_id = ? ORDER BY created_at",
            )
            .map_err(|e| WorkflowError::Storage(e.to_string()))?;

        let rows = stmt
            .query_map(params![parent_id], row_to_task)
            .map_err(|e| WorkflowError::Storage(e.to_string()))?;

        let mut tasks = Vec::new();
        for row in rows {
            tasks.push(row.map_err(|e| WorkflowError::Storage(e.to_string()))?);
        }

        Ok(tasks)
    }

    fn delete_task(&self, id: &str) -> WorkflowResult<()> {
        let conn = self.lock_conn()?;
        conn.execute("DELETE FROM workflow_tasks WHERE id = ?", params![id])
            .map_err(|e| WorkflowError::Storage(e.to_string()))?;
        Ok(())
    }

    fn next_task_id(&self) -> WorkflowResult<String> {
        let conn = self.lock_conn()?;
        let petname_gen = petname::Petnames::default();

        for _ in 0..100 {
            let Some(id) = petname_gen.generate_one(3, "-") else {
                continue;
            };

            let exists: bool = conn
                .query_row(
                    "SELECT EXISTS(SELECT 1 FROM workflow_tasks WHERE id = ?)",
                    params![&id],
                    |row| row.get(0),
                )
                .map_err(|e| WorkflowError::Storage(e.to_string()))?;

            if !exists {
                return Ok(id);
            }
        }

        Err(WorkflowError::Storage(
            "Failed to generate unique task ID after 100 attempts".into(),
        ))
    }

    fn next_subtask_id(&self, parent_id: &str) -> WorkflowResult<String> {
        let conn = self.lock_conn()?;
        let petname_gen = petname::Petnames::default();

        // Collect last words of existing sibling IDs
        let mut stmt = conn
            .prepare("SELECT id FROM workflow_tasks WHERE parent_id = ?")
            .map_err(|e| WorkflowError::Storage(e.to_string()))?;
        let sibling_last_words: Vec<String> = stmt
            .query_map(params![parent_id], |row| row.get::<_, String>(0))
            .map_err(|e| WorkflowError::Storage(e.to_string()))?
            .filter_map(std::result::Result::ok)
            .filter_map(|id| id.rsplit('-').next().map(String::from))
            .collect();
        drop(stmt);

        for _ in 0..100 {
            let Some(id) = petname_gen.generate_one(3, "-") else {
                continue;
            };

            // Check global uniqueness
            let exists: bool = conn
                .query_row(
                    "SELECT EXISTS(SELECT 1 FROM workflow_tasks WHERE id = ?)",
                    params![&id],
                    |row| row.get(0),
                )
                .map_err(|e| WorkflowError::Storage(e.to_string()))?;

            if exists {
                continue;
            }

            // Check last-word uniqueness among siblings
            let last_word = id.rsplit('-').next().unwrap_or(&id);
            if sibling_last_words.iter().any(|w| w == last_word) {
                continue;
            }

            return Ok(id);
        }

        Err(WorkflowError::Storage(
            "Failed to generate unique subtask ID after 100 attempts".into(),
        ))
    }

    fn list_all_iterations(&self) -> WorkflowResult<Vec<Iteration>> {
        let conn = self.lock_conn()?;

        let mut stmt = conn
            .prepare(
                "SELECT id, task_id, stage, iteration_number, started_at, ended_at, outcome, stage_session_id, incoming_context, trigger_delivered
                 FROM workflow_iterations ORDER BY task_id, started_at, iteration_number",
            )
            .map_err(|e| WorkflowError::Storage(e.to_string()))?;

        let rows = stmt
            .query_map([], row_to_iteration)
            .map_err(|e| WorkflowError::Storage(e.to_string()))?;

        let mut iterations = Vec::new();
        for row in rows {
            iterations.push(row.map_err(|e| WorkflowError::Storage(e.to_string()))?);
        }

        Ok(iterations)
    }

    fn get_iterations(&self, task_id: &str) -> WorkflowResult<Vec<Iteration>> {
        let conn = self.lock_conn()?;

        let mut stmt = conn
            .prepare(
                "SELECT id, task_id, stage, iteration_number, started_at, ended_at, outcome, stage_session_id, incoming_context, trigger_delivered
                 FROM workflow_iterations WHERE task_id = ? ORDER BY started_at, iteration_number",
            )
            .map_err(|e| WorkflowError::Storage(e.to_string()))?;

        let rows = stmt
            .query_map(params![task_id], row_to_iteration)
            .map_err(|e| WorkflowError::Storage(e.to_string()))?;

        let mut iterations = Vec::new();
        for row in rows {
            iterations.push(row.map_err(|e| WorkflowError::Storage(e.to_string()))?);
        }

        Ok(iterations)
    }

    fn get_iterations_for_stage(
        &self,
        task_id: &str,
        stage: &str,
    ) -> WorkflowResult<Vec<Iteration>> {
        let conn = self.lock_conn()?;

        let mut stmt = conn
            .prepare(
                "SELECT id, task_id, stage, iteration_number, started_at, ended_at, outcome, stage_session_id, incoming_context, trigger_delivered
                 FROM workflow_iterations WHERE task_id = ? AND stage = ? ORDER BY iteration_number",
            )
            .map_err(|e| WorkflowError::Storage(e.to_string()))?;

        let rows = stmt
            .query_map(params![task_id, stage], row_to_iteration)
            .map_err(|e| WorkflowError::Storage(e.to_string()))?;

        let mut iterations = Vec::new();
        for row in rows {
            iterations.push(row.map_err(|e| WorkflowError::Storage(e.to_string()))?);
        }

        Ok(iterations)
    }

    fn get_active_iteration(
        &self,
        task_id: &str,
        stage: &str,
    ) -> WorkflowResult<Option<Iteration>> {
        let conn = self.lock_conn()?;

        let result = conn
            .query_row(
                "SELECT id, task_id, stage, iteration_number, started_at, ended_at, outcome, stage_session_id, incoming_context, trigger_delivered
                 FROM workflow_iterations
                 WHERE task_id = ? AND stage = ? AND ended_at IS NULL
                 ORDER BY iteration_number DESC LIMIT 1",
                params![task_id, stage],
                row_to_iteration,
            )
            .optional()
            .map_err(|e| WorkflowError::Storage(e.to_string()))?;

        Ok(result)
    }

    fn get_latest_iteration(
        &self,
        task_id: &str,
        stage: &str,
    ) -> WorkflowResult<Option<Iteration>> {
        let conn = self.lock_conn()?;

        let result = conn
            .query_row(
                "SELECT id, task_id, stage, iteration_number, started_at, ended_at, outcome, stage_session_id, incoming_context, trigger_delivered
                 FROM workflow_iterations
                 WHERE task_id = ? AND stage = ?
                 ORDER BY iteration_number DESC LIMIT 1",
                params![task_id, stage],
                row_to_iteration,
            )
            .optional()
            .map_err(|e| WorkflowError::Storage(e.to_string()))?;

        Ok(result)
    }

    #[allow(clippy::cast_possible_wrap)]
    fn save_iteration(&self, iteration: &Iteration) -> WorkflowResult<()> {
        let conn = self.lock_conn()?;

        let outcome_json = iteration
            .outcome
            .as_ref()
            .map(|o| serde_json::to_string(o).map_err(|e| WorkflowError::Storage(e.to_string())))
            .transpose()?;

        let incoming_context_json = iteration
            .incoming_context
            .as_ref()
            .map(|c| serde_json::to_string(c).map_err(|e| WorkflowError::Storage(e.to_string())))
            .transpose()?;

        conn.execute(
            "INSERT OR REPLACE INTO workflow_iterations (
                id, task_id, stage, iteration_number, started_at, ended_at, outcome, stage_session_id, incoming_context, trigger_delivered
             ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
            params![
                iteration.id,
                iteration.task_id,
                iteration.stage,
                iteration.iteration_number as i32,
                iteration.started_at,
                iteration.ended_at,
                outcome_json,
                iteration.stage_session_id,
                incoming_context_json,
                iteration.trigger_delivered,
            ],
        )
        .map_err(|e| WorkflowError::Storage(e.to_string()))?;

        Ok(())
    }

    fn delete_iterations(&self, task_id: &str) -> WorkflowResult<()> {
        let conn = self.lock_conn()?;
        conn.execute(
            "DELETE FROM workflow_iterations WHERE task_id = ?",
            params![task_id],
        )
        .map_err(|e| WorkflowError::Storage(e.to_string()))?;
        Ok(())
    }

    fn get_stage_session(
        &self,
        task_id: &str,
        stage: &str,
    ) -> WorkflowResult<Option<StageSession>> {
        let conn = self.lock_conn()?;

        let result = conn
            .query_row(
                "SELECT id, task_id, stage, claude_session_id, agent_pid, spawn_count,
                        session_state, created_at, updated_at, has_activity
                 FROM workflow_stage_sessions
                 WHERE task_id = ? AND stage = ? AND session_state != 'superseded'
                 ORDER BY created_at DESC LIMIT 1",
                params![task_id, stage],
                row_to_stage_session,
            )
            .optional()
            .map_err(|e| WorkflowError::Storage(e.to_string()))?;

        Ok(result)
    }

    fn list_all_stage_sessions(&self) -> WorkflowResult<Vec<StageSession>> {
        let conn = self.lock_conn()?;

        let mut stmt = conn
            .prepare(
                "SELECT id, task_id, stage, claude_session_id, agent_pid, spawn_count,
                        session_state, created_at, updated_at, has_activity
                 FROM workflow_stage_sessions ORDER BY task_id, created_at",
            )
            .map_err(|e| WorkflowError::Storage(e.to_string()))?;

        let rows = stmt
            .query_map([], row_to_stage_session)
            .map_err(|e| WorkflowError::Storage(e.to_string()))?;

        let mut sessions = Vec::new();
        for row in rows {
            sessions.push(row.map_err(|e| WorkflowError::Storage(e.to_string()))?);
        }

        Ok(sessions)
    }

    fn get_stage_sessions(&self, task_id: &str) -> WorkflowResult<Vec<StageSession>> {
        let conn = self.lock_conn()?;

        let mut stmt = conn
            .prepare(
                "SELECT id, task_id, stage, claude_session_id, agent_pid, spawn_count,
                        session_state, created_at, updated_at, has_activity
                 FROM workflow_stage_sessions WHERE task_id = ? ORDER BY created_at",
            )
            .map_err(|e| WorkflowError::Storage(e.to_string()))?;

        let rows = stmt
            .query_map(params![task_id], row_to_stage_session)
            .map_err(|e| WorkflowError::Storage(e.to_string()))?;

        let mut sessions = Vec::new();
        for row in rows {
            sessions.push(row.map_err(|e| WorkflowError::Storage(e.to_string()))?);
        }

        Ok(sessions)
    }

    fn get_sessions_with_pids(&self) -> WorkflowResult<Vec<StageSession>> {
        let conn = self.lock_conn()?;

        let mut stmt = conn
            .prepare(
                "SELECT id, task_id, stage, claude_session_id, agent_pid, spawn_count,
                        session_state, created_at, updated_at, has_activity
                 FROM workflow_stage_sessions WHERE agent_pid IS NOT NULL",
            )
            .map_err(|e| WorkflowError::Storage(e.to_string()))?;

        let rows = stmt
            .query_map([], row_to_stage_session)
            .map_err(|e| WorkflowError::Storage(e.to_string()))?;

        let mut sessions = Vec::new();
        for row in rows {
            sessions.push(row.map_err(|e| WorkflowError::Storage(e.to_string()))?);
        }

        Ok(sessions)
    }

    #[allow(clippy::cast_possible_wrap)]
    fn save_stage_session(&self, session: &StageSession) -> WorkflowResult<()> {
        let conn = self.lock_conn()?;

        let state_str = session_state_to_str(session.session_state);

        orkestra_debug!(
            "db",
            "save_session {}: claude_session_id={:?}, state={}, spawn_count={}",
            session.id,
            session.claude_session_id,
            state_str,
            session.spawn_count
        );

        conn.execute(
            "INSERT OR REPLACE INTO workflow_stage_sessions (
                id, task_id, stage, claude_session_id, agent_pid, spawn_count,
                session_state, created_at, updated_at, has_activity
             ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
            params![
                session.id,
                session.task_id,
                session.stage,
                session.claude_session_id,
                session.agent_pid.map(|p| p as i32),
                session.spawn_count as i32,
                state_str,
                session.created_at,
                session.updated_at,
                i32::from(session.has_activity),
            ],
        )
        .map_err(|e| WorkflowError::Storage(e.to_string()))?;

        Ok(())
    }

    fn delete_stage_sessions(&self, task_id: &str) -> WorkflowResult<()> {
        let conn = self.lock_conn()?;
        conn.execute(
            "DELETE FROM workflow_stage_sessions WHERE task_id = ?",
            params![task_id],
        )
        .map_err(|e| WorkflowError::Storage(e.to_string()))?;
        Ok(())
    }

    fn append_log_entry(&self, stage_session_id: &str, entry: &LogEntry) -> WorkflowResult<()> {
        let conn = self.lock_conn()?;

        let content_json =
            serde_json::to_string(entry).map_err(|e| WorkflowError::Storage(e.to_string()))?;

        conn.execute(
            "INSERT INTO log_entries (id, stage_session_id, sequence_number, content, created_at)
             VALUES (?, ?, (SELECT COALESCE(MAX(sequence_number), 0) + 1 FROM log_entries WHERE stage_session_id = ?), ?, datetime('now'))",
            params![
                uuid::Uuid::new_v4().to_string(),
                stage_session_id,
                stage_session_id,
                content_json,
            ],
        )
        .map_err(|e| WorkflowError::Storage(e.to_string()))?;

        Ok(())
    }

    fn get_log_entries(&self, stage_session_id: &str) -> WorkflowResult<Vec<LogEntry>> {
        let conn = self.lock_conn()?;

        let mut stmt = conn
            .prepare(
                "SELECT content FROM log_entries
                 WHERE stage_session_id = ?
                 ORDER BY sequence_number",
            )
            .map_err(|e| WorkflowError::Storage(e.to_string()))?;

        let rows = stmt
            .query_map(params![stage_session_id], |row| {
                let content_json: String = row.get(0)?;
                Ok(content_json)
            })
            .map_err(|e| WorkflowError::Storage(e.to_string()))?;

        let mut entries = Vec::new();
        for row in rows {
            let json = row.map_err(|e| WorkflowError::Storage(e.to_string()))?;
            let entry: LogEntry =
                serde_json::from_str(&json).map_err(|e| WorkflowError::Storage(e.to_string()))?;
            entries.push(entry);
        }

        Ok(entries)
    }

    fn delete_log_entries_for_task(&self, task_id: &str) -> WorkflowResult<()> {
        let conn = self.lock_conn()?;
        conn.execute(
            "DELETE FROM log_entries WHERE stage_session_id IN (SELECT id FROM workflow_stage_sessions WHERE task_id = ?)",
            params![task_id],
        )
        .map_err(|e| WorkflowError::Storage(e.to_string()))?;
        Ok(())
    }

    fn delete_task_tree(&self, task_ids: &[String]) -> WorkflowResult<()> {
        let conn = self.lock_conn()?;
        // unchecked_transaction takes &self (not &mut self), which is safe here
        // because the Mutex already guarantees exclusive access.
        let tx = conn
            .unchecked_transaction()
            .map_err(|e| WorkflowError::Storage(e.to_string()))?;
        // Delete in FK-safe order: log_entries reference sessions, iterations
        // reference sessions, sessions reference tasks, and child tasks reference parent tasks.
        for id in task_ids {
            tx.execute(
                "DELETE FROM log_entries WHERE stage_session_id IN (SELECT id FROM workflow_stage_sessions WHERE task_id = ?)",
                params![id],
            )
            .map_err(|e| WorkflowError::Storage(e.to_string()))?;
        }
        for id in task_ids {
            tx.execute(
                "DELETE FROM workflow_iterations WHERE task_id = ?",
                params![id],
            )
            .map_err(|e| WorkflowError::Storage(e.to_string()))?;
        }
        for id in task_ids {
            tx.execute(
                "DELETE FROM workflow_stage_sessions WHERE task_id = ?",
                params![id],
            )
            .map_err(|e| WorkflowError::Storage(e.to_string()))?;
        }
        // Reverse order: children before parents (parent_id FK)
        for id in task_ids.iter().rev() {
            tx.execute("DELETE FROM workflow_tasks WHERE id = ?", params![id])
                .map_err(|e| WorkflowError::Storage(e.to_string()))?;
        }
        tx.commit()
            .map_err(|e| WorkflowError::Storage(e.to_string()))?;
        Ok(())
    }

    fn get_assistant_session(&self, id: &str) -> WorkflowResult<Option<AssistantSession>> {
        let conn = self.lock_conn()?;

        let result = conn
            .query_row(
                "SELECT id, claude_session_id, title, agent_pid, spawn_count,
                        session_state, created_at, updated_at
                 FROM assistant_sessions WHERE id = ?",
                params![id],
                row_to_assistant_session,
            )
            .optional()
            .map_err(|e| WorkflowError::Storage(e.to_string()))?;

        Ok(result)
    }

    #[allow(clippy::cast_possible_wrap)]
    fn save_assistant_session(&self, session: &AssistantSession) -> WorkflowResult<()> {
        let conn = self.lock_conn()?;

        let state_str = session_state_to_str(session.session_state);

        orkestra_debug!(
            "db",
            "save_assistant_session {}: claude_session_id={:?}, state={}, spawn_count={}",
            session.id,
            session.claude_session_id,
            state_str,
            session.spawn_count
        );

        conn.execute(
            "INSERT OR REPLACE INTO assistant_sessions (
                id, claude_session_id, title, agent_pid, spawn_count,
                session_state, created_at, updated_at
             ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
            params![
                session.id,
                session.claude_session_id,
                session.title,
                session.agent_pid.map(|p| p as i32),
                session.spawn_count as i32,
                state_str,
                session.created_at,
                session.updated_at,
            ],
        )
        .map_err(|e| WorkflowError::Storage(e.to_string()))?;

        Ok(())
    }

    fn list_assistant_sessions(&self) -> WorkflowResult<Vec<AssistantSession>> {
        let conn = self.lock_conn()?;

        let mut stmt = conn
            .prepare(
                "SELECT id, claude_session_id, title, agent_pid, spawn_count,
                        session_state, created_at, updated_at
                 FROM assistant_sessions ORDER BY created_at DESC",
            )
            .map_err(|e| WorkflowError::Storage(e.to_string()))?;

        let rows = stmt
            .query_map([], row_to_assistant_session)
            .map_err(|e| WorkflowError::Storage(e.to_string()))?;

        let mut sessions = Vec::new();
        for row in rows {
            sessions.push(row.map_err(|e| WorkflowError::Storage(e.to_string()))?);
        }

        Ok(sessions)
    }

    fn delete_assistant_session(&self, id: &str) -> WorkflowResult<()> {
        let conn = self.lock_conn()?;
        conn.execute("DELETE FROM assistant_sessions WHERE id = ?", params![id])
            .map_err(|e| WorkflowError::Storage(e.to_string()))?;
        Ok(())
    }

    fn append_assistant_log_entry(
        &self,
        assistant_session_id: &str,
        entry: &LogEntry,
    ) -> WorkflowResult<()> {
        let conn = self.lock_conn()?;

        let content_json =
            serde_json::to_string(entry).map_err(|e| WorkflowError::Storage(e.to_string()))?;

        conn.execute(
            "INSERT INTO log_entries (id, assistant_session_id, sequence_number, content, created_at)
             VALUES (?, ?, (SELECT COALESCE(MAX(sequence_number), 0) + 1 FROM log_entries WHERE assistant_session_id = ?), ?, datetime('now'))",
            params![
                uuid::Uuid::new_v4().to_string(),
                assistant_session_id,
                assistant_session_id,
                content_json,
            ],
        )
        .map_err(|e| WorkflowError::Storage(e.to_string()))?;

        Ok(())
    }

    fn get_assistant_log_entries(
        &self,
        assistant_session_id: &str,
    ) -> WorkflowResult<Vec<LogEntry>> {
        let conn = self.lock_conn()?;

        let mut stmt = conn
            .prepare(
                "SELECT content FROM log_entries
                 WHERE assistant_session_id = ?
                 ORDER BY sequence_number",
            )
            .map_err(|e| WorkflowError::Storage(e.to_string()))?;

        let rows = stmt
            .query_map(params![assistant_session_id], |row| {
                let content_json: String = row.get(0)?;
                Ok(content_json)
            })
            .map_err(|e| WorkflowError::Storage(e.to_string()))?;

        let mut entries = Vec::new();
        for row in rows {
            let json = row.map_err(|e| WorkflowError::Storage(e.to_string()))?;
            let entry: LogEntry =
                serde_json::from_str(&json).map_err(|e| WorkflowError::Storage(e.to_string()))?;
            entries.push(entry);
        }

        Ok(entries)
    }
}

// =============================================================================
// Row Conversion Functions
// =============================================================================

fn row_to_task(row: &rusqlite::Row) -> rusqlite::Result<Task> {
    let status_json: String = row.get(3)?;
    let phase_str: String = row.get(4)?;
    let artifacts_json: String = row.get(5)?;
    let depends_json: String = row.get(7)?;
    let auto_mode: bool = row.get::<_, i32>(10).unwrap_or(0) != 0;
    let flow: Option<String> = row.get(15).unwrap_or(None);

    Ok(Task {
        id: row.get(0)?,
        title: row.get(1)?,
        description: row.get(2)?,
        status: serde_json::from_str(&status_json).unwrap_or(Status::active("unknown")),
        phase: parse_phase(&phase_str),
        artifacts: serde_json::from_str(&artifacts_json).unwrap_or_default(),
        parent_id: row.get(6)?,
        short_id: row.get(16)?,
        depends_on: serde_json::from_str(&depends_json).unwrap_or_default(),
        branch_name: row.get(8)?,
        worktree_path: row.get(9)?,
        base_branch: row.get(14)?,
        base_commit: row.get(17)?,
        auto_mode,
        flow,
        created_at: row.get(11)?,
        updated_at: row.get(12)?,
        completed_at: row.get(13)?,
    })
}

#[allow(clippy::cast_sign_loss)]
fn row_to_iteration(row: &rusqlite::Row) -> rusqlite::Result<Iteration> {
    let iteration_number: i32 = row.get(3)?;
    let outcome_json: Option<String> = row.get(6)?;

    // Column 8 is incoming_context (added in V9 migration)
    let incoming_context_json: Option<String> = row.get(8).unwrap_or(None);

    // Column 9 is trigger_delivered (added in V10 migration)
    let trigger_delivered: bool = row.get(9).unwrap_or(false);

    Ok(Iteration {
        id: row.get(0)?,
        task_id: row.get(1)?,
        stage: row.get(2)?,
        iteration_number: iteration_number as u32,
        started_at: row.get(4)?,
        ended_at: row.get(5)?,
        outcome: outcome_json.and_then(|j| serde_json::from_str(&j).ok()),
        stage_session_id: row.get(7)?,
        incoming_context: incoming_context_json.and_then(|j| serde_json::from_str(&j).ok()),
        trigger_delivered,
    })
}

fn phase_to_str(phase: Phase) -> &'static str {
    match phase {
        Phase::AwaitingSetup => "awaiting_setup",
        Phase::SettingUp => "setting_up",
        Phase::Idle => "idle",
        Phase::AgentWorking => "agent_working",
        Phase::AwaitingReview => "awaiting_review",
        Phase::Interrupted => "interrupted",
        Phase::Integrating => "integrating",
        Phase::Finishing => "finishing",
        Phase::Committing => "committing",
        Phase::Finished => "finished",
    }
}

fn parse_phase(s: &str) -> Phase {
    match s {
        "awaiting_setup" => Phase::AwaitingSetup,
        "setting_up" => Phase::SettingUp,
        "agent_working" => Phase::AgentWorking,
        "awaiting_review" => Phase::AwaitingReview,
        "interrupted" => Phase::Interrupted,
        "integrating" => Phase::Integrating,
        "finishing" => Phase::Finishing,
        "committing" => Phase::Committing,
        "finished" => Phase::Finished,
        _ => Phase::Idle,
    }
}

#[allow(clippy::cast_sign_loss)]
fn row_to_stage_session(row: &rusqlite::Row) -> rusqlite::Result<StageSession> {
    let agent_pid: Option<i32> = row.get(4)?;
    let spawn_count: i32 = row.get(5)?;
    let state_str: String = row.get(6)?;
    let has_activity: i32 = row.get(9)?;

    Ok(StageSession {
        id: row.get(0)?,
        task_id: row.get(1)?,
        stage: row.get(2)?,
        claude_session_id: row.get(3)?,
        agent_pid: agent_pid.map(|p| p as u32),
        spawn_count: spawn_count as u32,
        has_activity: has_activity != 0,
        session_state: parse_session_state(&state_str),
        created_at: row.get(7)?,
        updated_at: row.get(8)?,
    })
}

fn session_state_to_str(state: SessionState) -> &'static str {
    match state {
        SessionState::Spawning => "spawning",
        SessionState::Active => "active",
        SessionState::Completed => "completed",
        SessionState::Abandoned => "abandoned",
        SessionState::Superseded => "superseded",
    }
}

fn parse_session_state(s: &str) -> SessionState {
    match s {
        "spawning" => SessionState::Spawning,
        "completed" => SessionState::Completed,
        "abandoned" => SessionState::Abandoned,
        "superseded" => SessionState::Superseded,
        _ => SessionState::Active,
    }
}

#[allow(clippy::cast_sign_loss)]
fn row_to_assistant_session(row: &rusqlite::Row) -> rusqlite::Result<AssistantSession> {
    let agent_pid: Option<i32> = row.get(3)?;
    let spawn_count: i32 = row.get(4)?;
    let state_str: String = row.get(5)?;

    Ok(AssistantSession {
        id: row.get(0)?,
        claude_session_id: row.get(1)?,
        title: row.get(2)?,
        agent_pid: agent_pid.map(|p| p as u32),
        spawn_count: spawn_count as u32,
        session_state: parse_session_state(&state_str),
        created_at: row.get(6)?,
        updated_at: row.get(7)?,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::adapters::sqlite::DatabaseConnection;
    use crate::workflow::runtime::{Artifact, Outcome};

    fn test_store() -> SqliteWorkflowStore {
        let conn = DatabaseConnection::in_memory().unwrap();
        SqliteWorkflowStore::new(conn.shared())
    }

    #[test]
    fn test_task_crud() {
        let store = test_store();

        // Create
        let task = Task::new(
            "task-1",
            "Test Task",
            "Description here",
            "planning",
            "2025-01-24T10:00:00Z",
        );
        store.save_task(&task).unwrap();

        // Read
        let loaded = store.get_task("task-1").unwrap().unwrap();
        assert_eq!(loaded.id, "task-1");
        assert_eq!(loaded.title, "Test Task");
        assert_eq!(loaded.current_stage(), Some("planning"));

        // Update
        let mut updated = loaded;
        updated.phase = Phase::AgentWorking;
        store.save_task(&updated).unwrap();

        let loaded = store.get_task("task-1").unwrap().unwrap();
        assert_eq!(loaded.phase, Phase::AgentWorking);

        // Delete
        store.delete_task("task-1").unwrap();
        assert!(store.get_task("task-1").unwrap().is_none());
    }

    #[test]
    fn test_task_with_artifacts() {
        let store = test_store();

        let mut task = Task::new("task-1", "Test", "Desc", "work", "now");
        task.artifacts.set(Artifact::new(
            "plan",
            "The plan content",
            "planning",
            "earlier",
        ));
        store.save_task(&task).unwrap();

        let loaded = store.get_task("task-1").unwrap().unwrap();
        assert_eq!(loaded.artifact("plan"), Some("The plan content"));
    }

    // Note: Questions are now stored in iteration outcomes, not on tasks.
    // See test_iteration_with_questions_in_outcome for the new behavior.

    #[test]
    fn test_list_tasks() {
        let store = test_store();

        store
            .save_task(&Task::new(
                "task-1",
                "Task 1",
                "Desc",
                "planning",
                "2025-01-01",
            ))
            .unwrap();
        store
            .save_task(&Task::new("task-2", "Task 2", "Desc", "work", "2025-01-02"))
            .unwrap();
        store
            .save_task(&Task::new(
                "task-3",
                "Task 3",
                "Desc",
                "review",
                "2025-01-03",
            ))
            .unwrap();

        let tasks = store.list_tasks().unwrap();
        assert_eq!(tasks.len(), 3);
        // Should be ordered by created_at
        assert_eq!(tasks[0].id, "task-1");
        assert_eq!(tasks[1].id, "task-2");
        assert_eq!(tasks[2].id, "task-3");
    }

    #[test]
    fn test_subtasks() {
        let store = test_store();

        let parent = Task::new("parent", "Parent Task", "Desc", "planning", "now");
        store.save_task(&parent).unwrap();

        let child1 = Task::new("child-1", "Child 1", "Desc", "work", "now").with_parent("parent");
        let child2 = Task::new("child-2", "Child 2", "Desc", "work", "now").with_parent("parent");
        store.save_task(&child1).unwrap();
        store.save_task(&child2).unwrap();

        let subtasks = store.list_subtasks("parent").unwrap();
        assert_eq!(subtasks.len(), 2);
    }

    #[test]
    fn test_next_task_id() {
        let store = test_store();

        let id1 = store.next_task_id().unwrap();
        let id2 = store.next_task_id().unwrap();

        // Should be unique petnames
        assert_ne!(id1, id2);
        assert!(id1.contains('-')); // petnames use hyphens
    }

    #[test]
    fn test_iteration_crud() {
        let store = test_store();

        // Create task first (foreign key)
        let task = Task::new("task-1", "Test", "Desc", "planning", "now");
        store.save_task(&task).unwrap();

        // Create iteration
        let iter = Iteration::new("iter-1", "task-1", "planning", 1, "2025-01-24T10:00:00Z");
        store.save_iteration(&iter).unwrap();

        // Read active
        let active = store.get_active_iteration("task-1", "planning").unwrap();
        assert!(active.is_some());
        assert_eq!(active.unwrap().iteration_number, 1);

        // End iteration
        let mut iter = store
            .get_active_iteration("task-1", "planning")
            .unwrap()
            .unwrap();
        iter.end("2025-01-24T10:30:00Z", Outcome::Approved);
        store.save_iteration(&iter).unwrap();

        // No longer active
        let active = store.get_active_iteration("task-1", "planning").unwrap();
        assert!(active.is_none());

        // But is latest
        let latest = store.get_latest_iteration("task-1", "planning").unwrap();
        assert!(latest.is_some());
        assert!(matches!(latest.unwrap().outcome, Some(Outcome::Approved)));
    }

    #[test]
    fn test_multiple_iterations() {
        let store = test_store();

        let task = Task::new("task-1", "Test", "Desc", "planning", "now");
        store.save_task(&task).unwrap();

        // First iteration - rejected
        let mut iter1 = Iteration::new("iter-1", "task-1", "planning", 1, "t1");
        iter1.end("t2", Outcome::rejected("planning", "Need more detail"));
        store.save_iteration(&iter1).unwrap();

        // Second iteration - approved
        let mut iter2 = Iteration::new("iter-2", "task-1", "planning", 2, "t3");
        iter2.end("t4", Outcome::Approved);
        store.save_iteration(&iter2).unwrap();

        // Get all iterations for stage
        let iters = store
            .get_iterations_for_stage("task-1", "planning")
            .unwrap();
        assert_eq!(iters.len(), 2);
        assert_eq!(iters[0].iteration_number, 1);
        assert_eq!(iters[1].iteration_number, 2);
    }

    #[test]
    fn test_iterations_across_stages() {
        let store = test_store();

        let task = Task::new("task-1", "Test", "Desc", "planning", "now");
        store.save_task(&task).unwrap();

        // Planning iteration
        let iter1 = Iteration::new("iter-plan-1", "task-1", "planning", 1, "t1");
        store.save_iteration(&iter1).unwrap();

        // Work iteration
        let iter2 = Iteration::new("iter-work-1", "task-1", "work", 1, "t2");
        store.save_iteration(&iter2).unwrap();

        // Get all iterations for task
        let all = store.get_iterations("task-1").unwrap();
        assert_eq!(all.len(), 2);

        // Get by stage
        let planning = store
            .get_iterations_for_stage("task-1", "planning")
            .unwrap();
        assert_eq!(planning.len(), 1);
        let work = store.get_iterations_for_stage("task-1", "work").unwrap();
        assert_eq!(work.len(), 1);
    }

    #[test]
    fn test_delete_iterations() {
        let store = test_store();

        let task = Task::new("task-1", "Test", "Desc", "planning", "now");
        store.save_task(&task).unwrap();

        store
            .save_iteration(&Iteration::new("i1", "task-1", "planning", 1, "t1"))
            .unwrap();
        store
            .save_iteration(&Iteration::new("i2", "task-1", "work", 1, "t2"))
            .unwrap();

        assert_eq!(store.get_iterations("task-1").unwrap().len(), 2);

        store.delete_iterations("task-1").unwrap();

        assert_eq!(store.get_iterations("task-1").unwrap().len(), 0);
    }

    #[test]
    fn test_task_status_serialization() {
        let store = test_store();

        // Test various status types
        let mut task = Task::new("task-1", "Test", "Desc", "planning", "now");
        store.save_task(&task).unwrap();

        let loaded = store.get_task("task-1").unwrap().unwrap();
        assert!(matches!(loaded.status, Status::Active { .. }));

        // Update to Done
        task.status = Status::Done;
        store.save_task(&task).unwrap();

        let loaded = store.get_task("task-1").unwrap().unwrap();
        assert!(matches!(loaded.status, Status::Done));

        // Update to Blocked
        task.status = Status::blocked("Waiting for dependency");
        store.save_task(&task).unwrap();

        let loaded = store.get_task("task-1").unwrap().unwrap();
        assert!(matches!(loaded.status, Status::Blocked { .. }));
    }

    // =========================================================================
    // Delete task tree tests
    // =========================================================================

    #[test]
    fn test_delete_task_tree_with_full_history() {
        use crate::testutil::fixtures::{iterations, sessions, tasks};

        let store = test_store();

        // Create a task with sessions, iterations, and artifacts
        tasks::save_task_with_artifacts(
            &store,
            "t1",
            "work",
            &[
                ("plan", "The plan", "planning"),
                ("summary", "Done", "work"),
            ],
        )
        .unwrap();
        sessions::save_completed_session(&store, "s1", "t1", "planning").unwrap();
        sessions::save_session(&store, "s2", "t1", "work").unwrap();
        iterations::save_approved_iteration(&store, "i1", "t1", "planning", 1, "s1").unwrap();
        iterations::save_rejected_iteration(
            &store,
            "i2",
            "t1",
            "planning",
            2,
            "s1",
            "needs more detail",
        )
        .unwrap();
        iterations::save_iteration(&store, "i3", "t1", "work", 1, "s2").unwrap();

        // Verify everything exists
        assert!(store.get_task("t1").unwrap().is_some());
        assert_eq!(store.get_iterations("t1").unwrap().len(), 3);
        assert_eq!(store.get_stage_sessions("t1").unwrap().len(), 2);

        // Delete the task tree
        store.delete_task_tree(&["t1".to_string()]).unwrap();

        // Verify everything is gone
        assert!(store.get_task("t1").unwrap().is_none());
        assert!(store.get_iterations("t1").unwrap().is_empty());
        assert!(store.get_stage_sessions("t1").unwrap().is_empty());
    }

    #[test]
    fn test_delete_task_tree_parent_with_subtasks() {
        use crate::testutil::fixtures::{iterations, sessions, tasks};

        let store = test_store();

        // Parent with two subtasks, each with sessions and iterations
        tasks::save_planning_task(&store, "parent").unwrap();
        tasks::save_subtask(&store, "child1", "parent").unwrap();
        tasks::save_subtask(&store, "child2", "parent").unwrap();

        sessions::save_session(&store, "sp", "parent", "planning").unwrap();
        sessions::save_session(&store, "sc1", "child1", "planning").unwrap();
        sessions::save_session(&store, "sc2", "child2", "planning").unwrap();

        iterations::save_iteration(&store, "ip", "parent", "planning", 1, "sp").unwrap();
        iterations::save_iteration(&store, "ic1", "child1", "planning", 1, "sc1").unwrap();
        iterations::save_iteration(&store, "ic2", "child2", "planning", 1, "sc2").unwrap();

        // Delete tree — must include all IDs (parent + children)
        store
            .delete_task_tree(&[
                "parent".to_string(),
                "child1".to_string(),
                "child2".to_string(),
            ])
            .unwrap();

        // All records should be gone
        assert!(store.get_task("parent").unwrap().is_none());
        assert!(store.get_task("child1").unwrap().is_none());
        assert!(store.get_task("child2").unwrap().is_none());
        assert!(store.get_iterations("parent").unwrap().is_empty());
        assert!(store.get_iterations("child1").unwrap().is_empty());
        assert!(store.get_iterations("child2").unwrap().is_empty());
        assert!(store.get_stage_sessions("parent").unwrap().is_empty());
        assert!(store.get_stage_sessions("child1").unwrap().is_empty());
        assert!(store.get_stage_sessions("child2").unwrap().is_empty());
    }

    #[test]
    fn test_delete_task_tree_preserves_unrelated_tasks() {
        use crate::testutil::fixtures::{iterations, sessions, tasks};

        let store = test_store();

        // Create two independent tasks with data
        tasks::save_planning_task(&store, "keep").unwrap();
        sessions::save_session(&store, "sk", "keep", "planning").unwrap();
        iterations::save_iteration(&store, "ik", "keep", "planning", 1, "sk").unwrap();

        tasks::save_planning_task(&store, "delete-me").unwrap();
        sessions::save_session(&store, "sd", "delete-me", "planning").unwrap();
        iterations::save_iteration(&store, "id", "delete-me", "planning", 1, "sd").unwrap();

        // Delete only one
        store.delete_task_tree(&["delete-me".to_string()]).unwrap();

        // Deleted task is gone
        assert!(store.get_task("delete-me").unwrap().is_none());
        assert!(store.get_iterations("delete-me").unwrap().is_empty());

        // Kept task is untouched
        assert!(store.get_task("keep").unwrap().is_some());
        assert_eq!(store.get_iterations("keep").unwrap().len(), 1);
        assert_eq!(store.get_stage_sessions("keep").unwrap().len(), 1);
    }

    #[test]
    fn test_delete_empty_task_tree() {
        let store = test_store();

        // Empty ID list should be a no-op
        store.delete_task_tree(&[]).unwrap();
    }

    #[test]
    fn test_delete_task_tree_nonexistent_ids() {
        let store = test_store();

        // Nonexistent IDs should not error
        store
            .delete_task_tree(&["ghost-1".to_string(), "ghost-2".to_string()])
            .unwrap();
    }
}
