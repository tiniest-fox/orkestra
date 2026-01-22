// Allow i32<->u32 casts for SQLite PID storage. PIDs are stored as i32 in SQLite
// (which lacks unsigned types) but represented as u32 in Rust. Process IDs are
// always positive and won't exceed i32::MAX on any supported platform.
#![allow(clippy::cast_sign_loss, clippy::cast_possible_wrap)]

use rusqlite::{params, Connection};
use std::path::PathBuf;
use std::sync::Mutex;

use crate::domain::{SessionInfo, Task, TaskKind, TaskStatus};
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
    pub fn new() -> Result<Self> {
        let path = Self::db_path()?;

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
    #[cfg(test)]
    pub fn in_memory() -> Result<Self> {
        let conn = Connection::open_in_memory()?;
        let store = Self {
            conn: Mutex::new(conn),
        };
        store.init_schema()?;
        Ok(store)
    }

    /// Get the path to the database file.
    fn db_path() -> Result<PathBuf> {
        let root = project::find_project_root()?;
        Ok(root.join(".orkestra").join("tasks.db"))
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

            CREATE INDEX IF NOT EXISTS idx_tasks_status ON tasks(status);
            CREATE INDEX IF NOT EXISTS idx_tasks_parent_id ON tasks(parent_id);
            CREATE INDEX IF NOT EXISTS idx_sessions_task_id ON sessions(task_id);
            ",
        )?;

        // Migration: add agent_pid column if it doesn't exist
        // SQLite doesn't have ADD COLUMN IF NOT EXISTS, so we try and ignore errors
        let _ = conn.execute("ALTER TABLE tasks ADD COLUMN agent_pid INTEGER", []);

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
    /// `completed_at`, summary, error, plan, `plan_feedback`, `review_feedback`,
    /// `reviewer_feedback`, `auto_approve`, `parent_id`, breakdown, `breakdown_feedback`, `skip_breakdown`
    fn row_to_task(row: &rusqlite::Row) -> rusqlite::Result<Task> {
        let status_str: String = row.get(3)?;
        let kind_str: String = row.get(4)?;
        let auto_approve: i32 = row.get(14)?;
        let skip_breakdown: i32 = row.get(18)?;
        let agent_pid: Option<i32> = row.get(19)?;

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
            plan_feedback: row.get(11)?,
            review_feedback: row.get(12)?,
            reviewer_feedback: row.get(13)?,
            sessions: None, // Loaded separately
            auto_approve: auto_approve != 0,
            parent_id: row.get(15)?,
            breakdown: row.get(16)?,
            breakdown_feedback: row.get(17)?,
            skip_breakdown: skip_breakdown != 0,
            agent_pid: agent_pid.map(|p| p as u32),
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
        conn.execute(
            r"
            INSERT OR REPLACE INTO tasks (
                id, title, description, status, kind, created_at, updated_at,
                completed_at, summary, error, plan, plan_feedback,
                review_feedback, reviewer_feedback, auto_approve, parent_id, breakdown, breakdown_feedback,
                skip_breakdown, agent_pid
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
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
                task.plan_feedback,
                task.review_feedback,
                task.reviewer_feedback,
                i32::from(task.auto_approve),
                task.parent_id,
                task.breakdown,
                task.breakdown_feedback,
                i32::from(task.skip_breakdown),
                task.agent_pid.map(|p| p as i32),
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
            conn.execute(
                r"
                INSERT INTO tasks (
                    id, title, description, status, kind, created_at, updated_at,
                    completed_at, summary, error, plan, plan_feedback,
                    review_feedback, reviewer_feedback, auto_approve, parent_id, breakdown, breakdown_feedback,
                    skip_breakdown, agent_pid
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
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
                    task.plan_feedback,
                    task.review_feedback,
                    task.reviewer_feedback,
                    i32::from(task.auto_approve),
                    task.parent_id,
                    task.breakdown,
                    task.breakdown_feedback,
                    i32::from(task.skip_breakdown),
                    task.agent_pid.map(|p| p as i32),
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

    fn next_id(&self) -> Result<String> {
        let conn = self.conn.lock().map_err(|_| OrkestraError::LockError)?;

        let max_num: Option<i32> = conn.query_row(
            "SELECT MAX(CAST(SUBSTR(id, 6) AS INTEGER)) FROM tasks WHERE id LIKE 'TASK-%'",
            [],
            |row| row.get(0),
        )?;

        let next = max_num.unwrap_or(0) + 1;
        Ok(format!("TASK-{next:03}"))
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

        assert_eq!(store.next_id().unwrap(), "TASK-001");

        let task = Task::new("TASK-001".into(), "Test".into(), "Desc".into(), "now");
        store.save(&task).unwrap();

        assert_eq!(store.next_id().unwrap(), "TASK-002");
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
