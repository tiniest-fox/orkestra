//! Stage session repository for tracking Claude sessions per task+stage.

use std::sync::{Arc, Mutex};

use rusqlite::{params, Connection, OptionalExtension};

use crate::domain::{Stage, StageSession};
use crate::error::{OrkestraError, Result};

/// Repository for StageSession entity operations.
pub struct StageSessionRepository {
    conn: Arc<Mutex<Connection>>,
}

impl StageSessionRepository {
    /// Create a new stage session repository with a shared connection.
    pub fn new(conn: Arc<Mutex<Connection>>) -> Self {
        Self { conn }
    }

    /// Get or create a stage session for a task+stage combination.
    ///
    /// This ensures the foreign key target exists before inserting iterations.
    pub fn get_or_create(&self, task_id: &str, stage: Stage) -> Result<StageSession> {
        let conn = self.conn.lock().map_err(|_| OrkestraError::LockError)?;
        let now = chrono::Utc::now().to_rfc3339();
        let stage_str = stage.as_str();

        // Try to get existing session
        let existing: Option<(Option<String>, Option<i32>, String)> = conn
            .query_row(
                "SELECT session_id, agent_pid, started_at FROM stage_sessions WHERE task_id = ? AND stage = ?",
                params![task_id, stage_str],
                |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)),
            )
            .optional()?;

        if let Some((session_id, agent_pid, started_at)) = existing {
            Ok(StageSession {
                task_id: task_id.to_string(),
                stage,
                session_id,
                agent_pid: agent_pid.map(|p| p as u32),
                started_at,
            })
        } else {
            // Create new session
            conn.execute(
                "INSERT INTO stage_sessions (task_id, stage, started_at) VALUES (?, ?, ?)",
                params![task_id, stage_str, &now],
            )?;

            Ok(StageSession::new(task_id.to_string(), stage, now))
        }
    }

    /// Get a stage session if it exists.
    pub fn find(&self, task_id: &str, stage: Stage) -> Result<Option<StageSession>> {
        let conn = self.conn.lock().map_err(|_| OrkestraError::LockError)?;
        let stage_str = stage.as_str();

        let result: Option<(Option<String>, Option<i32>, String)> = conn
            .query_row(
                "SELECT session_id, agent_pid, started_at FROM stage_sessions WHERE task_id = ? AND stage = ?",
                params![task_id, stage_str],
                |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)),
            )
            .optional()?;

        Ok(result.map(|(session_id, agent_pid, started_at)| StageSession {
            task_id: task_id.to_string(),
            stage,
            session_id,
            agent_pid: agent_pid.map(|p| p as u32),
            started_at,
        }))
    }

    /// Get all stage sessions for a task.
    pub fn find_all_for_task(&self, task_id: &str) -> Result<Vec<StageSession>> {
        let conn = self.conn.lock().map_err(|_| OrkestraError::LockError)?;

        let mut stmt = conn.prepare(
            "SELECT stage, session_id, agent_pid, started_at FROM stage_sessions WHERE task_id = ? ORDER BY started_at",
        )?;

        let rows = stmt.query_map(params![task_id], |row| {
            let stage_str: String = row.get(0)?;
            let session_id: Option<String> = row.get(1)?;
            let agent_pid: Option<i32> = row.get(2)?;
            let started_at: String = row.get(3)?;
            Ok((stage_str, session_id, agent_pid, started_at))
        })?;

        let mut sessions = Vec::new();
        for row in rows {
            let (stage_str, session_id, agent_pid, started_at) = row?;
            if let Some(stage) = Stage::from_str(&stage_str) {
                sessions.push(StageSession {
                    task_id: task_id.to_string(),
                    stage,
                    session_id,
                    agent_pid: agent_pid.map(|p| p as u32),
                    started_at,
                });
            }
        }

        Ok(sessions)
    }

    /// Set the Claude session ID for a stage session.
    pub fn set_session_id(&self, task_id: &str, stage: Stage, session_id: &str) -> Result<()> {
        let conn = self.conn.lock().map_err(|_| OrkestraError::LockError)?;
        let stage_str = stage.as_str();

        let affected = conn.execute(
            "UPDATE stage_sessions SET session_id = ? WHERE task_id = ? AND stage = ?",
            params![session_id, task_id, stage_str],
        )?;

        if affected == 0 {
            return Err(OrkestraError::InvalidState {
                expected: format!("Stage session for {}/{}", task_id, stage_str),
                actual: "No stage session found".into(),
            });
        }

        Ok(())
    }

    /// Set the agent PID for a stage session (None to clear).
    pub fn set_agent_pid(&self, task_id: &str, stage: Stage, pid: Option<u32>) -> Result<()> {
        let conn = self.conn.lock().map_err(|_| OrkestraError::LockError)?;
        let stage_str = stage.as_str();

        let affected = conn.execute(
            "UPDATE stage_sessions SET agent_pid = ? WHERE task_id = ? AND stage = ?",
            params![pid.map(|p| p as i32), task_id, stage_str],
        )?;

        if affected == 0 {
            return Err(OrkestraError::InvalidState {
                expected: format!("Stage session for {}/{}", task_id, stage_str),
                actual: "No stage session found".into(),
            });
        }

        Ok(())
    }

    /// Delete all stage sessions for a task.
    pub fn delete_for_task(&self, task_id: &str) -> Result<()> {
        let conn = self.conn.lock().map_err(|_| OrkestraError::LockError)?;
        conn.execute(
            "DELETE FROM stage_sessions WHERE task_id = ?",
            params![task_id],
        )?;
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::adapters::sqlite::DatabaseConnection;
    use crate::domain::Task;
    use crate::adapters::sqlite::repositories::TaskRepository;

    fn test_conn() -> Arc<Mutex<Connection>> {
        DatabaseConnection::in_memory().unwrap().shared()
    }

    fn setup_task(conn: Arc<Mutex<Connection>>) {
        let task_repo = TaskRepository::new(conn);
        let task = Task::new("test-task".into(), Some("Test".into()), "Desc".into(), "now");
        task_repo.save(&task).unwrap();
    }

    #[test]
    fn test_get_or_create() {
        let conn = test_conn();
        setup_task(conn.clone());
        let repo = StageSessionRepository::new(conn);

        // Create new session
        let session = repo.get_or_create("test-task", Stage::Plan).unwrap();
        assert_eq!(session.task_id, "test-task");
        assert_eq!(session.stage, Stage::Plan);
        assert!(session.session_id.is_none());

        // Get existing session
        let session2 = repo.get_or_create("test-task", Stage::Plan).unwrap();
        assert_eq!(session.started_at, session2.started_at);
    }

    #[test]
    fn test_set_session_id() {
        let conn = test_conn();
        setup_task(conn.clone());
        let repo = StageSessionRepository::new(conn);

        repo.get_or_create("test-task", Stage::Plan).unwrap();
        repo.set_session_id("test-task", Stage::Plan, "claude-123").unwrap();

        let session = repo.find("test-task", Stage::Plan).unwrap().unwrap();
        assert_eq!(session.session_id, Some("claude-123".to_string()));
        assert!(session.can_resume());
    }

    #[test]
    fn test_set_agent_pid() {
        let conn = test_conn();
        setup_task(conn.clone());
        let repo = StageSessionRepository::new(conn);

        repo.get_or_create("test-task", Stage::Plan).unwrap();
        repo.set_session_id("test-task", Stage::Plan, "claude-123").unwrap();
        repo.set_agent_pid("test-task", Stage::Plan, Some(12345)).unwrap();

        let session = repo.find("test-task", Stage::Plan).unwrap().unwrap();
        assert_eq!(session.agent_pid, Some(12345));
        assert!(session.is_running());
        assert!(!session.can_resume());

        // Clear PID
        repo.set_agent_pid("test-task", Stage::Plan, None).unwrap();
        let session = repo.find("test-task", Stage::Plan).unwrap().unwrap();
        assert!(session.agent_pid.is_none());
        assert!(session.can_resume());
    }
}
