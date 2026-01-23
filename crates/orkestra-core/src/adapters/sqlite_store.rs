// Allow i32<->u32 casts for SQLite PID storage. PIDs are stored as i32 in SQLite
// (which lacks unsigned types) but represented as u32 in Rust. Process IDs are
// always positive and won't exceed i32::MAX on any supported platform.
#![allow(clippy::cast_sign_loss, clippy::cast_possible_wrap)]

use petname::Generator;
use rusqlite::{params, Connection};
use std::sync::Mutex;

use crate::domain::{LoopOutcome, SessionInfo, Task, TaskKind, TaskStatus, WorkLoop};
use crate::error::{OrkestraError, Result};
use crate::ports::TaskStore;
use crate::project;

/// SQLite-based task storage.
///
/// Uses a single database file in the .orkestra directory with proper
/// transaction support for concurrent access from multiple agents.
pub struct SqliteStore {
    conn: Mutex<Connection>,
}

impl SqliteStore {
    /// Create a new `SQLite` store, initializing the database if needed.
    ///
    /// Uses project discovery to find the project root.
    /// For explicit path control, use [`SqliteStore::for_project`].
    pub fn new() -> Result<Self> {
        let root = project::find_project_root()?;
        Self::for_project(&root)
    }

    /// Create a `SQLite` store for a specific project directory.
    ///
    /// The database will be created at `{project_root}/.orkestra/tasks.db`.
    /// The `.orkestra` directory will be created if it doesn't exist.
    pub fn for_project(project_root: &std::path::Path) -> Result<Self> {
        let path = project_root.join(".orkestra").join("tasks.db");

        // Ensure parent directory exists
        if let Some(parent) = path.parent() {
            std::fs::create_dir_all(parent)?;
        }

        let conn = Connection::open(&path)?;

        // Enable WAL mode for better concurrent access
        conn.execute_batch("PRAGMA journal_mode=WAL;")?;

        let store = Self {
            conn: Mutex::new(conn),
        };

        store.init_schema()?;

        Ok(store)
    }

    /// Create an in-memory store for testing.
    pub fn in_memory() -> Result<Self> {
        let conn = Connection::open_in_memory()?;
        let store = Self {
            conn: Mutex::new(conn),
        };
        store.init_schema()?;
        Ok(store)
    }

    /// Initialize the database schema.
    fn init_schema(&self) -> Result<()> {
        let conn = self.conn.lock().map_err(|_| OrkestraError::LockError)?;

        conn.execute_batch(
            r"
            CREATE TABLE IF NOT EXISTS tasks (
                id TEXT PRIMARY KEY,
                title TEXT NOT NULL,
                description TEXT NOT NULL,
                status TEXT NOT NULL,
                kind TEXT NOT NULL DEFAULT 'task',
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL,
                completed_at TEXT,
                summary TEXT,
                error TEXT,
                plan TEXT,
                plan_feedback TEXT,
                review_feedback TEXT,
                reviewer_feedback TEXT,
                auto_approve INTEGER NOT NULL DEFAULT 0,
                parent_id TEXT,
                breakdown TEXT,
                breakdown_feedback TEXT,
                skip_breakdown INTEGER NOT NULL DEFAULT 0,
                agent_pid INTEGER,
                FOREIGN KEY (parent_id) REFERENCES tasks(id)
            );

            CREATE TABLE IF NOT EXISTS sessions (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                task_id TEXT NOT NULL,
                session_key TEXT NOT NULL,
                session_id TEXT NOT NULL,
                started_at TEXT NOT NULL,
                agent_pid INTEGER,
                FOREIGN KEY (task_id) REFERENCES tasks(id),
                UNIQUE(task_id, session_key)
            );

            CREATE TABLE IF NOT EXISTS work_loops (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                task_id TEXT NOT NULL,
                loop_number INTEGER NOT NULL,
                started_at TEXT NOT NULL,
                ended_at TEXT,
                started_from TEXT NOT NULL,
                outcome TEXT,
                FOREIGN KEY (task_id) REFERENCES tasks(id),
                UNIQUE(task_id, loop_number)
            );

            CREATE INDEX IF NOT EXISTS idx_tasks_status ON tasks(status);
            CREATE INDEX IF NOT EXISTS idx_tasks_parent_id ON tasks(parent_id);
            CREATE INDEX IF NOT EXISTS idx_sessions_task_id ON sessions(task_id);
            CREATE INDEX IF NOT EXISTS idx_work_loops_task_id ON work_loops(task_id);
            ",
        )?;

        // Migration: add columns if they don't exist
        // SQLite doesn't have ADD COLUMN IF NOT EXISTS, so we try and ignore errors
        let _ = conn.execute("ALTER TABLE tasks ADD COLUMN agent_pid INTEGER", []);
        let _ = conn.execute("ALTER TABLE tasks ADD COLUMN branch_name TEXT", []);
        let _ = conn.execute("ALTER TABLE tasks ADD COLUMN worktree_path TEXT", []);
        let _ = conn.execute("ALTER TABLE tasks ADD COLUMN integration_result TEXT", []);

        Ok(())
    }

    /// Load sessions for a task.
    fn load_sessions(
        conn: &Connection,
        task_id: &str,
    ) -> Result<Option<indexmap::IndexMap<String, SessionInfo>>> {
        let mut stmt = conn.prepare(
            "SELECT session_key, session_id, started_at, agent_pid FROM sessions WHERE task_id = ? ORDER BY id"
        )?;

        let rows = stmt.query_map(params![task_id], |row| {
            Ok((
                row.get::<_, String>(0)?,
                SessionInfo {
                    session_id: row.get(1)?,
                    started_at: row.get(2)?,
                    // agent_pid stored as i32 in SQLite, convert back to u32
                    agent_pid: row.get::<_, Option<i32>>(3)?.map(|p| p as u32),
                },
            ))
        })?;

        let mut sessions = indexmap::IndexMap::new();
        for row in rows {
            let (key, info) = row?;
            sessions.insert(key, info);
        }

        if sessions.is_empty() {
            Ok(None)
        } else {
            Ok(Some(sessions))
        }
    }

    /// Save sessions for a task (replaces all existing sessions).
    fn save_sessions(
        conn: &Connection,
        task_id: &str,
        sessions: Option<&indexmap::IndexMap<String, SessionInfo>>,
    ) -> Result<()> {
        // Delete existing sessions
        conn.execute("DELETE FROM sessions WHERE task_id = ?", params![task_id])?;

        // Insert new sessions
        if let Some(sessions) = sessions {
            let mut stmt = conn.prepare(
                "INSERT INTO sessions (task_id, session_key, session_id, started_at, agent_pid) VALUES (?, ?, ?, ?, ?)"
            )?;

            for (key, info) in sessions {
                stmt.execute(params![
                    task_id,
                    key,
                    info.session_id,
                    info.started_at,
                    // u32 PID stored as i32 in SQLite (PIDs won't exceed i32::MAX)
                    info.agent_pid.map(|p| p as i32)
                ])?;
            }
        }

        Ok(())
    }

    /// Convert a row to a Task (without sessions, which are loaded separately).
    /// Column order: id, title, description, status, kind, `created_at`, `updated_at`,
    /// `completed_at`, summary, error, plan, (`plan_feedback`), (`review_feedback`),
    /// (`reviewer_feedback`), `auto_approve`, `parent_id`, breakdown, (`breakdown_feedback`),
    /// `skip_breakdown`, `agent_pid`, `branch_name`, `worktree_path`, (`integration_result`)
    /// Note: columns in parens are deprecated - feedback and integration status now in `work_loops` table
    fn row_to_task(row: &rusqlite::Row) -> rusqlite::Result<Task> {
        let status_str: String = row.get(3)?;
        let kind_str: String = row.get(4)?;
        let auto_approve: i32 = row.get(14)?;
        let skip_breakdown: i32 = row.get(18)?;
        let agent_pid: Option<i32> = row.get(19)?;
        // Column 22 (integration_result) kept for backwards compat but not used
        // Integration status is now stored in work_loops table

        Ok(Task {
            id: row.get(0)?,
            title: row.get(1)?,
            description: row.get(2)?,
            status: parse_status(&status_str),
            kind: parse_kind(&kind_str),
            created_at: row.get(5)?,
            updated_at: row.get(6)?,
            completed_at: row.get(7)?,
            summary: row.get(8)?,
            error: row.get(9)?,
            plan: row.get(10)?,
            // Columns 11-13 (feedback fields) kept for backwards compat but not used
            // Feedback is now stored in work_loops table
            sessions: None, // Loaded separately
            auto_approve: auto_approve != 0,
            parent_id: row.get(15)?,
            breakdown: row.get(16)?,
            // Column 17 (breakdown_feedback) kept for backwards compat but not used
            skip_breakdown: skip_breakdown != 0,
            agent_pid: agent_pid.map(|p| p as u32),
            branch_name: row.get(20)?,
            worktree_path: row.get(21)?,
            // Column 22 (integration_result) kept for backwards compat but not used
        })
    }

    /// Add a session to a task atomically with optional agent PID.
    /// This is the key method that solves our race condition - it uses a transaction.
    pub fn add_session(
        &self,
        task_id: &str,
        session_key: &str,
        session_id: &str,
        agent_pid: Option<u32>,
    ) -> Result<()> {
        let conn = self.conn.lock().map_err(|_| OrkestraError::LockError)?;

        // Use INSERT OR REPLACE to handle concurrent adds
        conn.execute(
            "INSERT OR REPLACE INTO sessions (task_id, session_key, session_id, started_at, agent_pid) VALUES (?, ?, ?, ?, ?)",
            // u32 PID stored as i32 in SQLite (PIDs won't exceed i32::MAX)
            params![task_id, session_key, session_id, chrono::Utc::now().to_rfc3339(), agent_pid.map(|p| p as i32)],
        )?;

        // Update task's updated_at
        conn.execute(
            "UPDATE tasks SET updated_at = ? WHERE id = ?",
            params![chrono::Utc::now().to_rfc3339(), task_id],
        )?;

        Ok(())
    }

    /// Update a single field on a task atomically.
    pub fn update_field(&self, task_id: &str, field: &str, value: Option<&str>) -> Result<()> {
        let conn = self.conn.lock().map_err(|_| OrkestraError::LockError)?;

        // Validate field name to prevent SQL injection
        let valid_fields = [
            "title",
            "description",
            "status",
            "kind",
            "completed_at",
            "summary",
            "error",
            "plan",
            "plan_feedback",
            "review_feedback",
            "reviewer_feedback",
            "parent_id",
            "breakdown",
            "breakdown_feedback",
            "skip_breakdown",
            "branch_name",
            "worktree_path",
            "integration_result",
        ];

        if !valid_fields.contains(&field) {
            return Err(OrkestraError::InvalidInput(format!(
                "Invalid field: {field}"
            )));
        }

        let sql = format!("UPDATE tasks SET {field} = ?, updated_at = ? WHERE id = ?");
        conn.execute(
            &sql,
            params![value, chrono::Utc::now().to_rfc3339(), task_id],
        )?;

        Ok(())
    }

    /// Update task status atomically.
    pub fn update_status(&self, task_id: &str, status: TaskStatus) -> Result<()> {
        let conn = self.conn.lock().map_err(|_| OrkestraError::LockError)?;

        conn.execute(
            "UPDATE tasks SET status = ?, updated_at = ? WHERE id = ?",
            params![
                status_to_str(status),
                chrono::Utc::now().to_rfc3339(),
                task_id
            ],
        )?;

        Ok(())
    }

    /// Update the `agent_pid` field on a task.
    /// Set to Some(pid) when spawning, None when agent finishes.
    pub fn update_agent_pid(&self, task_id: &str, agent_pid: Option<u32>) -> Result<()> {
        let conn = self.conn.lock().map_err(|_| OrkestraError::LockError)?;

        conn.execute(
            "UPDATE tasks SET agent_pid = ?, updated_at = ? WHERE id = ?",
            params![
                agent_pid.map(|p| p as i32),
                chrono::Utc::now().to_rfc3339(),
                task_id
            ],
        )?;

        Ok(())
    }

    // =========================================================================
    // Work Loop Methods
    // =========================================================================

    /// Start a new work loop for a task.
    /// Returns the new loop with its assigned loop number.
    pub fn start_loop(&self, task_id: &str, started_from: TaskStatus) -> Result<WorkLoop> {
        let conn = self.conn.lock().map_err(|_| OrkestraError::LockError)?;
        let now = chrono::Utc::now().to_rfc3339();

        // Get the next loop number for this task
        let max_loop: Option<i32> = conn.query_row(
            "SELECT MAX(loop_number) FROM work_loops WHERE task_id = ?",
            params![task_id],
            |row| row.get(0),
        )?;
        let loop_number = (max_loop.unwrap_or(0) + 1) as u32;

        // Insert the new loop
        conn.execute(
            "INSERT INTO work_loops (task_id, loop_number, started_at, started_from) VALUES (?, ?, ?, ?)",
            params![task_id, loop_number as i32, &now, status_to_str(started_from)],
        )?;

        Ok(WorkLoop::new(loop_number, started_from, &now))
    }

    /// End the current work loop for a task with the given outcome.
    pub fn end_loop(&self, task_id: &str, loop_number: u32, outcome: &LoopOutcome) -> Result<()> {
        let conn = self.conn.lock().map_err(|_| OrkestraError::LockError)?;
        let now = chrono::Utc::now().to_rfc3339();
        let outcome_json = serde_json::to_string(&outcome)
            .map_err(|e| OrkestraError::InvalidInput(e.to_string()))?;

        conn.execute(
            "UPDATE work_loops SET ended_at = ?, outcome = ? WHERE task_id = ? AND loop_number = ?",
            params![&now, &outcome_json, task_id, loop_number as i32],
        )?;

        Ok(())
    }

    /// Get all work loops for a task, ordered by loop number.
    pub fn get_loops(&self, task_id: &str) -> Result<Vec<WorkLoop>> {
        let conn = self.conn.lock().map_err(|_| OrkestraError::LockError)?;

        let mut stmt = conn.prepare(
            "SELECT loop_number, started_at, ended_at, started_from, outcome FROM work_loops WHERE task_id = ? ORDER BY loop_number",
        )?;

        let rows = stmt.query_map(params![task_id], |row| {
            let loop_number: i32 = row.get(0)?;
            let started_at: String = row.get(1)?;
            let ended_at: Option<String> = row.get(2)?;
            let started_from_str: String = row.get(3)?;
            let outcome_json: Option<String> = row.get(4)?;

            Ok((
                loop_number,
                started_at,
                ended_at,
                started_from_str,
                outcome_json,
            ))
        })?;

        let mut loops = Vec::new();
        for row in rows {
            let (loop_number, started_at, ended_at, started_from_str, outcome_json) = row?;
            let started_from = parse_status(&started_from_str);
            let outcome = outcome_json.and_then(|json| serde_json::from_str(&json).ok());

            loops.push(WorkLoop {
                loop_number: loop_number as u32,
                started_at,
                ended_at,
                started_from,
                outcome,
            });
        }

        Ok(loops)
    }

    /// Get the current (active) work loop for a task, if any.
    #[allow(clippy::redundant_closure_for_method_calls)]
    pub fn get_current_loop(&self, task_id: &str) -> Result<Option<WorkLoop>> {
        let loops = self.get_loops(task_id)?;
        Ok(loops.into_iter().find(|l| l.is_active()))
    }

    /// Delete all work loops for a task (used when deleting a task).
    pub fn delete_loops(&self, task_id: &str) -> Result<()> {
        let conn = self.conn.lock().map_err(|_| OrkestraError::LockError)?;
        conn.execute("DELETE FROM work_loops WHERE task_id = ?", params![task_id])?;
        Ok(())
    }

    /// Get the outcome from the most recently ended loop.
    /// This is used to get feedback when resuming an agent after rejection.
    pub fn get_previous_loop_outcome(&self, task_id: &str) -> Result<Option<LoopOutcome>> {
        let loops = self.get_loops(task_id)?;
        // Find the most recent loop that has ended (has an outcome)
        Ok(loops.into_iter().rev().find_map(|l| l.outcome))
    }

    /// Get feedback string from the previous loop's outcome.
    /// Returns the feedback/error message regardless of outcome type.
    pub fn get_previous_loop_feedback(&self, task_id: &str) -> Result<Option<String>> {
        let outcome = self.get_previous_loop_outcome(task_id)?;
        Ok(outcome.and_then(|o| match o {
            LoopOutcome::PlanRejected { feedback }
            | LoopOutcome::BreakdownRejected { feedback }
            | LoopOutcome::WorkRejected { feedback }
            | LoopOutcome::ReviewerRejected { feedback } => Some(feedback),
            LoopOutcome::IntegrationFailed { error, .. } | LoopOutcome::AgentError { error } => {
                Some(error)
            }
            LoopOutcome::Blocked { reason } => Some(reason),
            LoopOutcome::Completed { .. } => None,
        }))
    }

    /// Get child tasks (tasks with `parent_id` = given id and kind = 'task').
    pub fn get_child_tasks(&self, parent_id: &str) -> Result<Vec<Task>> {
        let conn = self.conn.lock().map_err(|_| OrkestraError::LockError)?;

        let mut stmt = conn.prepare(
            "SELECT * FROM tasks WHERE parent_id = ? AND kind = 'task' ORDER BY created_at",
        )?;

        let rows = stmt.query_map(params![parent_id], Self::row_to_task)?;

        let mut tasks = Vec::new();
        for row in rows {
            let mut task = row?;
            task.sessions = Self::load_sessions(&conn, &task.id)?;
            tasks.push(task);
        }

        Ok(tasks)
    }

    /// Get subtasks (tasks with `parent_id` = given id and kind = 'subtask').
    pub fn get_subtasks(&self, parent_id: &str) -> Result<Vec<Task>> {
        let conn = self.conn.lock().map_err(|_| OrkestraError::LockError)?;

        let mut stmt = conn.prepare(
            "SELECT * FROM tasks WHERE parent_id = ? AND kind = 'subtask' ORDER BY created_at",
        )?;

        let rows = stmt.query_map(params![parent_id], Self::row_to_task)?;

        let mut tasks = Vec::new();
        for row in rows {
            let mut task = row?;
            task.sessions = Self::load_sessions(&conn, &task.id)?;
            tasks.push(task);
        }

        Ok(tasks)
    }
}

impl TaskStore for SqliteStore {
    fn load_all(&self) -> Result<Vec<Task>> {
        let conn = self.conn.lock().map_err(|_| OrkestraError::LockError)?;

        let mut stmt = conn.prepare("SELECT * FROM tasks ORDER BY created_at")?;
        let rows = stmt.query_map([], Self::row_to_task)?;

        let mut tasks = Vec::new();
        for row in rows {
            let mut task = row?;
            task.sessions = Self::load_sessions(&conn, &task.id)?;
            tasks.push(task);
        }

        Ok(tasks)
    }

    fn find_by_id(&self, id: &str) -> Result<Option<Task>> {
        let conn = self.conn.lock().map_err(|_| OrkestraError::LockError)?;

        let mut stmt = conn.prepare("SELECT * FROM tasks WHERE id = ?")?;
        let mut rows = stmt.query(params![id])?;

        if let Some(row) = rows.next()? {
            let mut task = Self::row_to_task(row)?;
            task.sessions = Self::load_sessions(&conn, &task.id)?;
            Ok(Some(task))
        } else {
            Ok(None)
        }
    }

    fn save(&self, task: &Task) -> Result<()> {
        let conn = self.conn.lock().map_err(|_| OrkestraError::LockError)?;

        // Use INSERT OR REPLACE to handle both insert and update
        // Note: feedback and integration_result columns kept for backwards compat but always NULL
        // (now stored in work_loops table)
        conn.execute(
            r"
            INSERT OR REPLACE INTO tasks (
                id, title, description, status, kind, created_at, updated_at,
                completed_at, summary, error, plan, plan_feedback,
                review_feedback, reviewer_feedback, auto_approve, parent_id, breakdown, breakdown_feedback,
                skip_breakdown, agent_pid, branch_name, worktree_path, integration_result
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            ",
            params![
                task.id,
                task.title,
                task.description,
                status_to_str(task.status),
                kind_to_str(task.kind),
                task.created_at,
                task.updated_at,
                task.completed_at,
                task.summary,
                task.error,
                task.plan,
                None::<String>, // plan_feedback - deprecated, in work_loops
                None::<String>, // review_feedback - deprecated, in work_loops
                None::<String>, // reviewer_feedback - deprecated, in work_loops
                i32::from(task.auto_approve),
                task.parent_id,
                task.breakdown,
                None::<String>, // breakdown_feedback - deprecated, in work_loops
                i32::from(task.skip_breakdown),
                task.agent_pid.map(|p| p as i32),
                task.branch_name,
                task.worktree_path,
                None::<String>, // integration_result - deprecated, in work_loops
            ],
        )?;

        // Save sessions
        Self::save_sessions(&conn, &task.id, task.sessions.as_ref())?;

        Ok(())
    }

    fn save_all(&self, tasks: &[Task]) -> Result<()> {
        let conn = self.conn.lock().map_err(|_| OrkestraError::LockError)?;

        // Use a transaction for atomicity
        conn.execute("BEGIN TRANSACTION", [])?;

        // Clear existing data
        conn.execute("DELETE FROM sessions", [])?;
        conn.execute("DELETE FROM tasks", [])?;

        // Insert all tasks
        for task in tasks {
            // Note: feedback and integration_result columns kept for backwards compat but always NULL
            // (now stored in work_loops table)
            conn.execute(
                r"
                INSERT INTO tasks (
                    id, title, description, status, kind, created_at, updated_at,
                    completed_at, summary, error, plan, plan_feedback,
                    review_feedback, reviewer_feedback, auto_approve, parent_id, breakdown, breakdown_feedback,
                    skip_breakdown, agent_pid, branch_name, worktree_path, integration_result
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                ",
                params![
                    task.id,
                    task.title,
                    task.description,
                    status_to_str(task.status),
                    kind_to_str(task.kind),
                    task.created_at,
                    task.updated_at,
                    task.completed_at,
                    task.summary,
                    task.error,
                    task.plan,
                    None::<String>, // plan_feedback - deprecated, in work_loops
                    None::<String>, // review_feedback - deprecated, in work_loops
                    None::<String>, // reviewer_feedback - deprecated, in work_loops
                    i32::from(task.auto_approve),
                    task.parent_id,
                    task.breakdown,
                    None::<String>, // breakdown_feedback - deprecated, in work_loops
                    i32::from(task.skip_breakdown),
                    task.agent_pid.map(|p| p as i32),
                    task.branch_name,
                    task.worktree_path,
                    None::<String>, // integration_result - deprecated, in work_loops
                ],
            )?;

            // Save sessions
            if let Some(sessions) = &task.sessions {
                for (key, info) in sessions {
                    conn.execute(
                        "INSERT INTO sessions (task_id, session_key, session_id, started_at, agent_pid) VALUES (?, ?, ?, ?, ?)",
                        // u32 PID stored as i32 in SQLite (PIDs won't exceed i32::MAX)
                        params![task.id, key, info.session_id, info.started_at, info.agent_pid.map(|p| p as i32)],
                    )?;
                }
            }
        }

        conn.execute("COMMIT", [])?;

        Ok(())
    }

    fn delete(&self, id: &str) -> Result<()> {
        let conn = self.conn.lock().map_err(|_| OrkestraError::LockError)?;

        // Delete related data first (foreign keys would prevent task deletion)
        conn.execute("DELETE FROM sessions WHERE task_id = ?", params![id])?;
        conn.execute("DELETE FROM work_loops WHERE task_id = ?", params![id])?;
        conn.execute("DELETE FROM tasks WHERE id = ?", params![id])?;

        Ok(())
    }

    fn next_id(&self) -> Result<String> {
        let conn = self.conn.lock().map_err(|_| OrkestraError::LockError)?;

        // Generate a unique petname (e.g., "swift-amber-fox")
        // With 3 words from ~7k adjectives and ~5k nouns, collision probability is very low
        // but we check anyway to guarantee uniqueness
        let petname_gen = petname::Petnames::default();

        for _ in 0..100 {
            let Some(id) = petname_gen.generate_one(3, "-") else {
                continue;
            };

            let exists: bool = conn.query_row(
                "SELECT EXISTS(SELECT 1 FROM tasks WHERE id = ?)",
                params![&id],
                |row| row.get(0),
            )?;

            if !exists {
                return Ok(id);
            }
        }

        // Fallback: add random suffix if somehow all petnames collide
        Err(OrkestraError::InvalidInput(
            "Failed to generate unique task ID after 100 attempts".into(),
        ))
    }
}

fn status_to_str(status: TaskStatus) -> &'static str {
    match status {
        TaskStatus::Planning => "planning",
        TaskStatus::BreakingDown => "breaking_down",
        TaskStatus::WaitingOnSubtasks => "waiting_on_subtasks",
        TaskStatus::Working => "working",
        TaskStatus::Reviewing => "reviewing",
        TaskStatus::Done => "done",
        TaskStatus::Failed => "failed",
        TaskStatus::Blocked => "blocked",
    }
}

fn parse_status(s: &str) -> TaskStatus {
    match s {
        "breaking_down" => TaskStatus::BreakingDown,
        "waiting_on_subtasks" => TaskStatus::WaitingOnSubtasks,
        "working" => TaskStatus::Working,
        "reviewing" => TaskStatus::Reviewing,
        "done" => TaskStatus::Done,
        "failed" => TaskStatus::Failed,
        "blocked" => TaskStatus::Blocked,
        // "planning" or unknown defaults to Planning
        _ => TaskStatus::Planning,
    }
}

fn kind_to_str(kind: TaskKind) -> &'static str {
    match kind {
        TaskKind::Task => "task",
        TaskKind::Subtask => "subtask",
    }
}

fn parse_kind(s: &str) -> TaskKind {
    match s {
        "subtask" => TaskKind::Subtask,
        // "task" or unknown defaults to Task
        _ => TaskKind::Task,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_create_and_load_task() {
        let store = SqliteStore::in_memory().unwrap();

        let task = Task::new(
            "TASK-001".into(),
            "Test".into(),
            "Description".into(),
            "2024-01-01T00:00:00Z",
        );
        store.save(&task).unwrap();

        let loaded = store.find_by_id("TASK-001").unwrap().unwrap();
        assert_eq!(loaded.title, "Test");
        assert_eq!(loaded.status, TaskStatus::Planning);
    }

    #[test]
    fn test_add_session_atomic() {
        let store = SqliteStore::in_memory().unwrap();

        let task = Task::new(
            "TASK-001".into(),
            "Test".into(),
            "Description".into(),
            "2024-01-01T00:00:00Z",
        );
        store.save(&task).unwrap();

        store
            .add_session("TASK-001", "plan", "session-123", Some(12345))
            .unwrap();

        let loaded = store.find_by_id("TASK-001").unwrap().unwrap();
        let sessions = loaded.sessions.unwrap();
        assert_eq!(sessions.get("plan").unwrap().session_id, "session-123");
    }

    #[test]
    fn test_next_id() {
        let store = SqliteStore::in_memory().unwrap();

        // Petnames should be hyphenated words (e.g., "swift-amber-fox")
        let id1 = store.next_id().unwrap();
        assert!(id1.contains('-'), "Petname should contain hyphens: {id1}");
        assert!(id1.chars().all(|c| c.is_ascii_lowercase() || c == '-'));

        // Save task with that ID
        let task = Task::new(id1.clone(), "Test".into(), "Desc".into(), "now");
        store.save(&task).unwrap();

        // Next ID should be different (unique)
        let id2 = store.next_id().unwrap();
        assert_ne!(id1, id2, "IDs should be unique");
        assert!(id2.contains('-'), "Petname should contain hyphens: {id2}");
    }

    #[test]
    fn test_child_and_subtask_queries() {
        let store = SqliteStore::in_memory().unwrap();

        // Parent task
        let parent = Task::new("TASK-001".into(), "Parent".into(), "Desc".into(), "now");
        store.save(&parent).unwrap();

        // Child task (parallel, appears in Kanban)
        let mut child = Task::new("TASK-002".into(), "Child".into(), "Desc".into(), "now");
        child.parent_id = Some("TASK-001".into());
        child.kind = TaskKind::Task;
        store.save(&child).unwrap();

        // Subtask (checklist item)
        let mut subtask = Task::new("TASK-003".into(), "Subtask".into(), "Desc".into(), "now");
        subtask.parent_id = Some("TASK-001".into());
        subtask.kind = TaskKind::Subtask;
        store.save(&subtask).unwrap();

        let children = store.get_child_tasks("TASK-001").unwrap();
        assert_eq!(children.len(), 1);
        assert_eq!(children[0].id, "TASK-002");

        let subtasks = store.get_subtasks("TASK-001").unwrap();
        assert_eq!(subtasks.len(), 1);
        assert_eq!(subtasks[0].id, "TASK-003");
    }
}
