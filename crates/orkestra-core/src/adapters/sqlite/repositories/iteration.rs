//! Iteration repository for tracking turns within stage sessions.

use std::sync::{Arc, Mutex};

use rusqlite::{params, Connection, OptionalExtension};

use crate::domain::{Iteration, Outcome, Stage};
use crate::error::{OrkestraError, Result};

use super::StageSessionRepository;

/// Repository for Iteration entity operations.
pub struct IterationRepository {
    conn: Arc<Mutex<Connection>>,
}

impl IterationRepository {
    /// Create a new iteration repository with a shared connection.
    pub fn new(conn: Arc<Mutex<Connection>>) -> Self {
        Self { conn }
    }

    /// Start a new iteration for a task+stage.
    ///
    /// Automatically creates the stage session if needed.
    pub fn start(&self, task_id: &str, stage: Stage) -> Result<Iteration> {
        // Ensure stage session exists (handles the foreign key)
        let session_repo = StageSessionRepository::new(self.conn.clone());
        let _ = session_repo.get_or_create(task_id, stage)?;

        let conn = self.conn.lock().map_err(|_| OrkestraError::LockError)?;
        let now = chrono::Utc::now().to_rfc3339();
        let stage_str = stage.as_str();

        // Get the next iteration number for this task+stage
        let max_iter: Option<i32> = conn.query_row(
            "SELECT MAX(iteration) FROM iterations WHERE task_id = ? AND stage = ?",
            params![task_id, stage_str],
            |row| row.get(0),
        )?;
        let iteration = (max_iter.unwrap_or(0) + 1) as u32;

        // Insert the new iteration
        conn.execute(
            "INSERT INTO iterations (task_id, stage, iteration, started_at) VALUES (?, ?, ?, ?)",
            params![task_id, stage_str, iteration as i32, &now],
        )?;

        Ok(Iteration::new(task_id.to_string(), stage, iteration, now))
    }

    /// Get the current (active) iteration for a task+stage.
    ///
    /// An active iteration has no outcome set.
    pub fn find_current(&self, task_id: &str, stage: Stage) -> Result<Option<Iteration>> {
        let conn = self.conn.lock().map_err(|_| OrkestraError::LockError)?;
        let stage_str = stage.as_str();

        let result: Option<(i32, String, Option<String>, Option<String>, Option<String>)> = conn
            .query_row(
                "SELECT iteration, started_at, ended_at, data, outcome
                 FROM iterations
                 WHERE task_id = ? AND stage = ? AND outcome IS NULL
                 ORDER BY iteration DESC LIMIT 1",
                params![task_id, stage_str],
                |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?, row.get(3)?, row.get(4)?)),
            )
            .optional()?;

        Ok(result.map(|(iteration, started_at, ended_at, data_json, outcome_json)| {
            Iteration {
                task_id: task_id.to_string(),
                stage,
                iteration: iteration as u32,
                started_at,
                ended_at,
                data: data_json.as_deref().and_then(|j| serde_json::from_str(j).ok()),
                outcome: outcome_json.as_deref().and_then(|j| serde_json::from_str(j).ok()),
            }
        }))
    }

    /// Get the latest iteration for a task+stage (regardless of status).
    pub fn find_latest(&self, task_id: &str, stage: Stage) -> Result<Option<Iteration>> {
        let conn = self.conn.lock().map_err(|_| OrkestraError::LockError)?;
        let stage_str = stage.as_str();

        let result: Option<(i32, String, Option<String>, Option<String>, Option<String>)> = conn
            .query_row(
                "SELECT iteration, started_at, ended_at, data, outcome
                 FROM iterations
                 WHERE task_id = ? AND stage = ?
                 ORDER BY iteration DESC LIMIT 1",
                params![task_id, stage_str],
                |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?, row.get(3)?, row.get(4)?)),
            )
            .optional()?;

        Ok(result.map(|(iteration, started_at, ended_at, data_json, outcome_json)| {
            Iteration {
                task_id: task_id.to_string(),
                stage,
                iteration: iteration as u32,
                started_at,
                ended_at,
                data: data_json.as_deref().and_then(|j| serde_json::from_str(j).ok()),
                outcome: outcome_json.as_deref().and_then(|j| serde_json::from_str(j).ok()),
            }
        }))
    }

    /// Set the data for the current (active) iteration.
    pub fn set_data(&self, task_id: &str, stage: Stage, data: &serde_json::Value) -> Result<()> {
        let conn = self.conn.lock().map_err(|_| OrkestraError::LockError)?;
        let stage_str = stage.as_str();
        let data_json = serde_json::to_string(data)
            .map_err(|e| OrkestraError::InvalidInput(e.to_string()))?;

        let affected = conn.execute(
            "UPDATE iterations SET data = ? WHERE task_id = ? AND stage = ? AND outcome IS NULL",
            params![&data_json, task_id, stage_str],
        )?;

        if affected == 0 {
            return Err(OrkestraError::InvalidState {
                expected: format!("Active iteration for {}/{}", task_id, stage_str),
                actual: "No active iteration".into(),
            });
        }

        Ok(())
    }

    /// End the current (active) iteration with the given outcome.
    ///
    /// Sets both outcome and ended_at timestamp atomically.
    pub fn end(&self, task_id: &str, stage: Stage, outcome: &Outcome) -> Result<()> {
        let conn = self.conn.lock().map_err(|_| OrkestraError::LockError)?;
        let stage_str = stage.as_str();
        let ended_at = chrono::Utc::now().to_rfc3339();
        let outcome_json = serde_json::to_string(outcome)
            .map_err(|e| OrkestraError::InvalidInput(e.to_string()))?;

        let affected = conn.execute(
            "UPDATE iterations SET outcome = ?, ended_at = ? WHERE task_id = ? AND stage = ? AND outcome IS NULL",
            params![&outcome_json, &ended_at, task_id, stage_str],
        )?;

        if affected == 0 {
            return Err(OrkestraError::InvalidState {
                expected: format!("Active iteration for {}/{}", task_id, stage_str),
                actual: "No active iteration".into(),
            });
        }

        Ok(())
    }

    /// Get all iterations for a task+stage, ordered by iteration number.
    pub fn find_all(&self, task_id: &str, stage: Stage) -> Result<Vec<Iteration>> {
        let conn = self.conn.lock().map_err(|_| OrkestraError::LockError)?;
        let stage_str = stage.as_str();

        let mut stmt = conn.prepare(
            "SELECT iteration, started_at, ended_at, data, outcome
             FROM iterations
             WHERE task_id = ? AND stage = ?
             ORDER BY iteration",
        )?;

        let rows = stmt.query_map(params![task_id, stage_str], |row| {
            let iteration: i32 = row.get(0)?;
            let started_at: String = row.get(1)?;
            let ended_at: Option<String> = row.get(2)?;
            let data_json: Option<String> = row.get(3)?;
            let outcome_json: Option<String> = row.get(4)?;
            Ok((iteration, started_at, ended_at, data_json, outcome_json))
        })?;

        let mut iterations = Vec::new();
        for row in rows {
            let (iteration, started_at, ended_at, data_json, outcome_json) = row?;
            iterations.push(Iteration {
                task_id: task_id.to_string(),
                stage,
                iteration: iteration as u32,
                started_at,
                ended_at,
                data: data_json.as_deref().and_then(|j| serde_json::from_str(j).ok()),
                outcome: outcome_json.as_deref().and_then(|j| serde_json::from_str(j).ok()),
            });
        }

        Ok(iterations)
    }

    /// Delete all iterations for a task.
    pub fn delete_for_task(&self, task_id: &str) -> Result<()> {
        let conn = self.conn.lock().map_err(|_| OrkestraError::LockError)?;
        conn.execute("DELETE FROM iterations WHERE task_id = ?", params![task_id])?;
        Ok(())
    }

    /// Delete all iterations for a task+stage.
    pub fn delete_for_stage(&self, task_id: &str, stage: Stage) -> Result<()> {
        let conn = self.conn.lock().map_err(|_| OrkestraError::LockError)?;
        let stage_str = stage.as_str();
        conn.execute(
            "DELETE FROM iterations WHERE task_id = ? AND stage = ?",
            params![task_id, stage_str],
        )?;
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::adapters::sqlite::DatabaseConnection;
    use crate::adapters::sqlite::repositories::TaskRepository;
    use crate::domain::Task;

    fn test_conn() -> Arc<Mutex<Connection>> {
        DatabaseConnection::in_memory().unwrap().shared()
    }

    fn setup_task(conn: Arc<Mutex<Connection>>) {
        let task_repo = TaskRepository::new(conn);
        let task = Task::new("test-task".into(), Some("Test".into()), "Desc".into(), "now");
        task_repo.save(&task).unwrap();
    }

    #[test]
    fn test_iteration_lifecycle() {
        let conn = test_conn();
        setup_task(conn.clone());
        let repo = IterationRepository::new(conn);

        // Start iteration
        let iter = repo.start("test-task", Stage::Plan).unwrap();
        assert_eq!(iter.iteration, 1);
        assert!(iter.is_active());

        // Set data
        let data = serde_json::json!({"plan": "My plan"});
        repo.set_data("test-task", Stage::Plan, &data).unwrap();

        let iter = repo.find_current("test-task", Stage::Plan).unwrap().unwrap();
        assert!(iter.needs_review());
        assert_eq!(iter.plan(), Some("My plan".to_string()));

        // End iteration
        repo.end("test-task", Stage::Plan, &Outcome::Approved).unwrap();

        let iter = repo.find_latest("test-task", Stage::Plan).unwrap().unwrap();
        assert!(!iter.is_active());
        assert!(matches!(iter.outcome, Some(Outcome::Approved)));
    }

    #[test]
    fn test_multiple_iterations() {
        let conn = test_conn();
        setup_task(conn.clone());
        let repo = IterationRepository::new(conn);

        // First iteration - rejected
        repo.start("test-task", Stage::Plan).unwrap();
        repo.set_data("test-task", Stage::Plan, &serde_json::json!({"plan": "v1"})).unwrap();
        repo.end("test-task", Stage::Plan, &Outcome::Rejected { feedback: "More detail".into() }).unwrap();

        // Second iteration - approved
        let iter2 = repo.start("test-task", Stage::Plan).unwrap();
        assert_eq!(iter2.iteration, 2);
        repo.set_data("test-task", Stage::Plan, &serde_json::json!({"plan": "v2"})).unwrap();
        repo.end("test-task", Stage::Plan, &Outcome::Approved).unwrap();

        // Get all iterations
        let iters = repo.find_all("test-task", Stage::Plan).unwrap();
        assert_eq!(iters.len(), 2);
        assert!(matches!(iters[0].outcome, Some(Outcome::Rejected { .. })));
        assert!(matches!(iters[1].outcome, Some(Outcome::Approved)));
    }

    #[test]
    fn test_multiple_stages() {
        let conn = test_conn();
        setup_task(conn.clone());
        let repo = IterationRepository::new(conn);

        // Plan stage
        repo.start("test-task", Stage::Plan).unwrap();
        repo.end("test-task", Stage::Plan, &Outcome::Approved).unwrap();

        // Work stage
        repo.start("test-task", Stage::Work).unwrap();
        repo.end("test-task", Stage::Work, &Outcome::Approved).unwrap();

        // Each stage has independent iterations
        let plan_iters = repo.find_all("test-task", Stage::Plan).unwrap();
        let work_iters = repo.find_all("test-task", Stage::Work).unwrap();

        assert_eq!(plan_iters.len(), 1);
        assert_eq!(work_iters.len(), 1);
    }
}
