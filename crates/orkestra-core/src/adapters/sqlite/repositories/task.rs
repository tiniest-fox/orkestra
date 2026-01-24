//! Task repository for CRUD operations on tasks.

use std::sync::{Arc, Mutex};

use petname::Generator;
use rusqlite::{params, Connection};

use crate::domain::{Task, TaskKind, TaskStatus};
use crate::error::{OrkestraError, Result};
use crate::state::TaskPhase;

/// Repository for Task entity operations.
pub struct TaskRepository {
    conn: Arc<Mutex<Connection>>,
}

impl TaskRepository {
    /// Create a new task repository with a shared connection.
    pub fn new(conn: Arc<Mutex<Connection>>) -> Self {
        Self { conn }
    }

    /// Find a task by ID.
    pub fn find_by_id(&self, id: &str) -> Result<Option<Task>> {
        let conn = self.conn.lock().map_err(|_| OrkestraError::LockError)?;

        let mut stmt = conn.prepare("SELECT * FROM tasks WHERE id = ?")?;
        let mut rows = stmt.query(params![id])?;

        if let Some(row) = rows.next()? {
            Ok(Some(Self::row_to_task(row)?))
        } else {
            Ok(None)
        }
    }

    /// Load all tasks.
    pub fn find_all(&self) -> Result<Vec<Task>> {
        let conn = self.conn.lock().map_err(|_| OrkestraError::LockError)?;

        let mut stmt = conn.prepare("SELECT * FROM tasks ORDER BY created_at")?;
        let rows = stmt.query_map([], Self::row_to_task)?;

        let mut tasks = Vec::new();
        for row in rows {
            tasks.push(row?);
        }

        Ok(tasks)
    }

    /// Save (insert or update) a task.
    pub fn save(&self, task: &Task) -> Result<()> {
        let conn = self.conn.lock().map_err(|_| OrkestraError::LockError)?;
        Self::save_with_conn(&conn, task)
    }

    /// Save a task using an existing connection (for transactions).
    pub fn save_with_conn(conn: &Connection, task: &Task) -> Result<()> {
        conn.execute(
            r"
            INSERT OR REPLACE INTO tasks (
                id, title, description, status, kind, created_at, updated_at,
                completed_at, summary, error, plan, auto_approve, parent_id,
                breakdown, skip_breakdown, agent_pid, branch_name, worktree_path,
                phase, depends_on, work_items, assigned_worker_task_id,
                pending_questions, question_history
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
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
                i32::from(task.auto_approve),
                task.parent_id,
                task.breakdown,
                i32::from(task.skip_breakdown),
                task.agent_pid.map(|p| p as i32),
                task.branch_name,
                task.worktree_path,
                phase_to_str(task.phase),
                serde_json::to_string(&task.depends_on).unwrap_or_else(|_| "[]".to_string()),
                serde_json::to_string(&task.work_items).unwrap_or_else(|_| "[]".to_string()),
                task.assigned_worker_task_id,
                serde_json::to_string(&task.pending_questions).unwrap_or_else(|_| "[]".to_string()),
                serde_json::to_string(&task.question_history).unwrap_or_else(|_| "[]".to_string()),
            ],
        )?;

        Ok(())
    }

    /// Save multiple tasks in a transaction.
    pub fn save_all(&self, tasks: &[Task]) -> Result<()> {
        let conn = self.conn.lock().map_err(|_| OrkestraError::LockError)?;

        conn.execute("BEGIN TRANSACTION", [])?;

        // Clear existing tasks
        conn.execute("DELETE FROM tasks", [])?;

        // Insert all tasks
        for task in tasks {
            Self::save_with_conn(&conn, task)?;
        }

        conn.execute("COMMIT", [])?;

        Ok(())
    }

    /// Delete a task by ID.
    pub fn delete(&self, id: &str) -> Result<()> {
        let conn = self.conn.lock().map_err(|_| OrkestraError::LockError)?;
        conn.execute("DELETE FROM tasks WHERE id = ?", params![id])?;
        Ok(())
    }

    /// Generate the next unique task ID using petnames.
    pub fn next_id(&self) -> Result<String> {
        let conn = self.conn.lock().map_err(|_| OrkestraError::LockError)?;
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

        Err(OrkestraError::InvalidInput(
            "Failed to generate unique task ID after 100 attempts".into(),
        ))
    }

    /// Update a single field atomically.
    pub fn update_field(&self, task_id: &str, field: &str, value: Option<&str>) -> Result<()> {
        // Validate field name to prevent SQL injection
        const ALLOWED_FIELDS: &[&str] = &[
            "title",
            "description",
            "summary",
            "error",
            "plan",
            "breakdown",
            "branch_name",
            "worktree_path",
            "assigned_worker_task_id",
        ];

        if !ALLOWED_FIELDS.contains(&field) {
            return Err(OrkestraError::InvalidInput(format!(
                "Field '{}' is not allowed for update",
                field
            )));
        }

        let conn = self.conn.lock().map_err(|_| OrkestraError::LockError)?;
        let now = chrono::Utc::now().to_rfc3339();

        let sql = format!(
            "UPDATE tasks SET {} = ?, updated_at = ? WHERE id = ?",
            field
        );
        let affected = conn.execute(&sql, params![value, &now, task_id])?;

        if affected == 0 {
            return Err(OrkestraError::TaskNotFound(task_id.to_string()));
        }

        Ok(())
    }

    /// Update task status atomically.
    pub fn update_status(&self, task_id: &str, status: TaskStatus) -> Result<()> {
        let conn = self.conn.lock().map_err(|_| OrkestraError::LockError)?;
        let now = chrono::Utc::now().to_rfc3339();

        let affected = conn.execute(
            "UPDATE tasks SET status = ?, updated_at = ? WHERE id = ?",
            params![status_to_str(status), &now, task_id],
        )?;

        if affected == 0 {
            return Err(OrkestraError::TaskNotFound(task_id.to_string()));
        }

        Ok(())
    }

    /// Update task phase atomically.
    pub fn update_phase(&self, task_id: &str, phase: TaskPhase) -> Result<()> {
        let conn = self.conn.lock().map_err(|_| OrkestraError::LockError)?;
        let now = chrono::Utc::now().to_rfc3339();

        let affected = conn.execute(
            "UPDATE tasks SET phase = ?, updated_at = ? WHERE id = ?",
            params![phase_to_str(phase), &now, task_id],
        )?;

        if affected == 0 {
            return Err(OrkestraError::TaskNotFound(task_id.to_string()));
        }

        Ok(())
    }

    /// Update agent PID atomically.
    pub fn update_agent_pid(&self, task_id: &str, pid: Option<u32>) -> Result<()> {
        let conn = self.conn.lock().map_err(|_| OrkestraError::LockError)?;
        let now = chrono::Utc::now().to_rfc3339();

        let affected = conn.execute(
            "UPDATE tasks SET agent_pid = ?, updated_at = ? WHERE id = ?",
            params![pid.map(|p| p as i32), &now, task_id],
        )?;

        if affected == 0 {
            return Err(OrkestraError::TaskNotFound(task_id.to_string()));
        }

        Ok(())
    }

    /// Update planner questions atomically.
    pub fn update_planner_questions(
        &self,
        task_id: &str,
        pending_questions: &serde_json::Value,
        question_history: &serde_json::Value,
    ) -> Result<()> {
        let conn = self.conn.lock().map_err(|_| OrkestraError::LockError)?;
        let now = chrono::Utc::now().to_rfc3339();

        let pending_json = serde_json::to_string(pending_questions)
            .map_err(|e| OrkestraError::InvalidInput(e.to_string()))?;
        let history_json = serde_json::to_string(question_history)
            .map_err(|e| OrkestraError::InvalidInput(e.to_string()))?;

        let affected = conn.execute(
            "UPDATE tasks SET pending_questions = ?, question_history = ?, updated_at = ? WHERE id = ?",
            params![&pending_json, &history_json, &now, task_id],
        )?;

        if affected == 0 {
            return Err(OrkestraError::TaskNotFound(task_id.to_string()));
        }

        Ok(())
    }

    /// Find child tasks by parent_id and optional kind filter.
    pub fn find_children(&self, parent_id: &str, kind: Option<TaskKind>) -> Result<Vec<Task>> {
        let conn = self.conn.lock().map_err(|_| OrkestraError::LockError)?;

        let (sql, kind_str) = match kind {
            Some(k) => (
                "SELECT * FROM tasks WHERE parent_id = ? AND kind = ? ORDER BY created_at",
                Some(kind_to_str(k)),
            ),
            None => (
                "SELECT * FROM tasks WHERE parent_id = ? ORDER BY created_at",
                None,
            ),
        };

        let mut stmt = conn.prepare(sql)?;
        let rows = if let Some(k) = kind_str {
            stmt.query_map(params![parent_id, k], Self::row_to_task)?
        } else {
            stmt.query_map(params![parent_id], Self::row_to_task)?
        };

        let mut tasks = Vec::new();
        for row in rows {
            tasks.push(row?);
        }

        Ok(tasks)
    }

    /// Convert a database row to a Task struct.
    fn row_to_task(row: &rusqlite::Row) -> rusqlite::Result<Task> {
        let status_str: String = row.get(3)?;
        let kind_str: String = row.get(4)?;
        let auto_approve: i32 = row.get(11)?;
        let skip_breakdown: i32 = row.get(14)?;
        let agent_pid: Option<i32> = row.get(15)?;
        let phase_str: String = row.get(18)?;

        // Parse JSON fields with fallback to empty arrays
        let depends_on_json: String = row.get::<_, Option<String>>(19)?.unwrap_or_else(|| "[]".to_string());
        let work_items_json: String = row.get::<_, Option<String>>(20)?.unwrap_or_else(|| "[]".to_string());
        let pending_questions_json: String = row.get::<_, Option<String>>(22)?.unwrap_or_else(|| "[]".to_string());
        let question_history_json: String = row.get::<_, Option<String>>(23)?.unwrap_or_else(|| "[]".to_string());

        Ok(Task {
            id: row.get(0)?,
            title: row.get(1)?,
            description: row.get(2)?,
            status: parse_status(&status_str),
            phase: parse_phase(&phase_str),
            kind: parse_kind(&kind_str),
            created_at: row.get(5)?,
            updated_at: row.get(6)?,
            completed_at: row.get(7)?,
            summary: row.get(8)?,
            error: row.get(9)?,
            plan: row.get(10)?,
            auto_approve: auto_approve != 0,
            parent_id: row.get(12)?,
            breakdown: row.get(13)?,
            skip_breakdown: skip_breakdown != 0,
            agent_pid: agent_pid.map(|p| p as u32),
            branch_name: row.get(16)?,
            worktree_path: row.get(17)?,
            depends_on: serde_json::from_str(&depends_on_json).unwrap_or_default(),
            work_items: serde_json::from_str(&work_items_json).unwrap_or_default(),
            assigned_worker_task_id: row.get(21)?,
            pending_questions: serde_json::from_str(&pending_questions_json).unwrap_or_default(),
            question_history: serde_json::from_str(&question_history_json).unwrap_or_default(),
            // sessions field kept for backward compatibility but typically loaded via StageSessionRepository
            sessions: None,
        })
    }
}

// Helper functions for enum conversion

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
        _ => TaskKind::Task,
    }
}

fn phase_to_str(phase: TaskPhase) -> &'static str {
    match phase {
        TaskPhase::Idle => "idle",
        TaskPhase::AgentWorking => "agent_working",
        TaskPhase::AwaitingReview => "awaiting_review",
        TaskPhase::Integrating => "integrating",
    }
}

fn parse_phase(s: &str) -> TaskPhase {
    match s {
        "agent_working" => TaskPhase::AgentWorking,
        "awaiting_review" => TaskPhase::AwaitingReview,
        "integrating" => TaskPhase::Integrating,
        _ => TaskPhase::Idle,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::adapters::sqlite::DatabaseConnection;

    fn test_conn() -> Arc<Mutex<Connection>> {
        DatabaseConnection::in_memory().unwrap().shared()
    }

    #[test]
    fn test_save_and_find() {
        let repo = TaskRepository::new(test_conn());

        let task = Task::new(
            "test-1".into(),
            Some("Test Task".into()),
            "Description".into(),
            "2024-01-01T00:00:00Z",
        );

        repo.save(&task).unwrap();
        let loaded = repo.find_by_id("test-1").unwrap().unwrap();

        assert_eq!(loaded.id, "test-1");
        assert_eq!(loaded.title, Some("Test Task".to_string()));
    }

    #[test]
    fn test_update_status() {
        let repo = TaskRepository::new(test_conn());

        let task = Task::new("test-1".into(), Some("Test".into()), "Desc".into(), "now");
        repo.save(&task).unwrap();

        repo.update_status("test-1", TaskStatus::Working).unwrap();

        let loaded = repo.find_by_id("test-1").unwrap().unwrap();
        assert_eq!(loaded.status, TaskStatus::Working);
    }

    #[test]
    fn test_find_children() {
        let repo = TaskRepository::new(test_conn());

        // Parent task
        let parent = Task::new("parent".into(), Some("Parent".into()), "Desc".into(), "now");
        repo.save(&parent).unwrap();

        // Child task
        let mut child = Task::new("child".into(), Some("Child".into()), "Desc".into(), "now");
        child.parent_id = Some("parent".into());
        child.kind = TaskKind::Task;
        repo.save(&child).unwrap();

        // Subtask
        let mut subtask = Task::new("subtask".into(), Some("Subtask".into()), "Desc".into(), "now");
        subtask.parent_id = Some("parent".into());
        subtask.kind = TaskKind::Subtask;
        repo.save(&subtask).unwrap();

        let children = repo.find_children("parent", Some(TaskKind::Task)).unwrap();
        assert_eq!(children.len(), 1);
        assert_eq!(children[0].id, "child");

        let subtasks = repo.find_children("parent", Some(TaskKind::Subtask)).unwrap();
        assert_eq!(subtasks.len(), 1);
        assert_eq!(subtasks[0].id, "subtask");
    }
}
