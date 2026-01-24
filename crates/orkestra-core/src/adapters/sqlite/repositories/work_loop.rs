//! Work loop repository for tracking macro-level lifecycle passes.

use std::sync::{Arc, Mutex};

use rusqlite::{params, Connection};

use crate::domain::{LoopOutcome, TaskStatus, WorkLoop};
use crate::error::{OrkestraError, Result};

/// Repository for WorkLoop entity operations.
pub struct WorkLoopRepository {
    conn: Arc<Mutex<Connection>>,
}

impl WorkLoopRepository {
    /// Create a new work loop repository with a shared connection.
    pub fn new(conn: Arc<Mutex<Connection>>) -> Self {
        Self { conn }
    }

    /// Start a new work loop for a task.
    ///
    /// Returns the new loop with its assigned loop number.
    pub fn start(&self, task_id: &str, started_from: TaskStatus) -> Result<WorkLoop> {
        let conn = self.conn.lock().map_err(|_| OrkestraError::LockError)?;
        let now = chrono::Utc::now().to_rfc3339();
        let started_from_str = status_to_str(started_from);

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
            params![task_id, loop_number as i32, &now, started_from_str],
        )?;

        Ok(WorkLoop {
            loop_number,
            started_at: now,
            ended_at: None,
            started_from,
            outcome: None,
        })
    }

    /// End the current work loop with the given outcome.
    pub fn end(&self, task_id: &str, outcome: &LoopOutcome) -> Result<()> {
        let conn = self.conn.lock().map_err(|_| OrkestraError::LockError)?;
        let ended_at = chrono::Utc::now().to_rfc3339();
        let outcome_json = serde_json::to_string(&outcome)
            .map_err(|e| OrkestraError::InvalidInput(e.to_string()))?;

        // End the most recent loop without an outcome
        let affected = conn.execute(
            "UPDATE work_loops SET ended_at = ?, outcome = ? WHERE task_id = ? AND outcome IS NULL",
            params![&ended_at, &outcome_json, task_id],
        )?;

        if affected == 0 {
            return Err(OrkestraError::InvalidState {
                expected: "Active work loop".into(),
                actual: "No active work loop".into(),
            });
        }

        Ok(())
    }

    /// Get all work loops for a task, ordered by loop number.
    pub fn find_all(&self, task_id: &str) -> Result<Vec<WorkLoop>> {
        let conn = self.conn.lock().map_err(|_| OrkestraError::LockError)?;

        let mut stmt = conn.prepare(
            "SELECT loop_number, started_at, ended_at, started_from, outcome
             FROM work_loops
             WHERE task_id = ?
             ORDER BY loop_number",
        )?;

        let rows = stmt.query_map(params![task_id], |row| {
            let loop_number: i32 = row.get(0)?;
            let started_at: String = row.get(1)?;
            let ended_at: Option<String> = row.get(2)?;
            let started_from_str: String = row.get(3)?;
            let outcome_json: Option<String> = row.get(4)?;
            Ok((loop_number, started_at, ended_at, started_from_str, outcome_json))
        })?;

        let mut loops = Vec::new();
        for row in rows {
            let (loop_number, started_at, ended_at, started_from_str, outcome_json) = row?;
            loops.push(WorkLoop {
                loop_number: loop_number as u32,
                started_at,
                ended_at,
                started_from: parse_status(&started_from_str),
                outcome: outcome_json.as_deref().and_then(|j| serde_json::from_str(j).ok()),
            });
        }

        Ok(loops)
    }

    /// Get the current (active) work loop for a task.
    pub fn find_current(&self, task_id: &str) -> Result<Option<WorkLoop>> {
        let loops = self.find_all(task_id)?;
        Ok(loops.into_iter().find(|l| l.ended_at.is_none()))
    }

    /// Get the previous (most recently ended) work loop.
    pub fn find_previous(&self, task_id: &str) -> Result<Option<WorkLoop>> {
        let loops = self.find_all(task_id)?;
        Ok(loops.into_iter().rev().find(|l| l.ended_at.is_some()))
    }

    /// Get feedback from the previous loop's outcome, if any.
    pub fn get_previous_feedback(&self, task_id: &str) -> Result<Option<String>> {
        let prev = self.find_previous(task_id)?;
        Ok(prev.and_then(|l| l.outcome).and_then(|o| extract_feedback(&o)))
    }

    /// Delete all work loops for a task.
    pub fn delete_for_task(&self, task_id: &str) -> Result<()> {
        let conn = self.conn.lock().map_err(|_| OrkestraError::LockError)?;
        conn.execute("DELETE FROM work_loops WHERE task_id = ?", params![task_id])?;
        Ok(())
    }
}

/// Extract feedback from a LoopOutcome, if it contains feedback.
fn extract_feedback(outcome: &LoopOutcome) -> Option<String> {
    match outcome {
        LoopOutcome::PlanRejected { feedback } => Some(feedback.clone()),
        LoopOutcome::BreakdownRejected { feedback } => Some(feedback.clone()),
        LoopOutcome::WorkRejected { feedback } => Some(feedback.clone()),
        LoopOutcome::ReviewerRejected { feedback } => Some(feedback.clone()),
        LoopOutcome::IntegrationFailed { error, .. } => Some(error.clone()),
        LoopOutcome::AgentError { error } => Some(error.clone()),
        LoopOutcome::Blocked { reason } => Some(reason.clone()),
        LoopOutcome::Completed { .. } => None,
    }
}

// Helper functions for TaskStatus conversion

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
    fn test_loop_lifecycle() {
        let conn = test_conn();
        setup_task(conn.clone());
        let repo = WorkLoopRepository::new(conn);

        // Start loop
        let loop1 = repo.start("test-task", TaskStatus::Planning).unwrap();
        assert_eq!(loop1.loop_number, 1);
        assert!(loop1.ended_at.is_none());

        // End loop
        repo.end("test-task", &LoopOutcome::Completed {
            merged_at: None,
            commit_sha: None,
            target_branch: None,
        }).unwrap();

        let loops = repo.find_all("test-task").unwrap();
        assert_eq!(loops.len(), 1);
        assert!(loops[0].ended_at.is_some());
        assert!(matches!(loops[0].outcome, Some(LoopOutcome::Completed { .. })));
    }

    #[test]
    fn test_multiple_loops() {
        let conn = test_conn();
        setup_task(conn.clone());
        let repo = WorkLoopRepository::new(conn);

        // First loop - plan rejected
        repo.start("test-task", TaskStatus::Planning).unwrap();
        repo.end("test-task", &LoopOutcome::PlanRejected { feedback: "More detail".into() }).unwrap();

        // Second loop
        let loop2 = repo.start("test-task", TaskStatus::Planning).unwrap();
        assert_eq!(loop2.loop_number, 2);

        // Get previous feedback
        let feedback = repo.get_previous_feedback("test-task").unwrap();
        assert_eq!(feedback, Some("More detail".to_string()));
    }

    #[test]
    fn test_current_loop() {
        let conn = test_conn();
        setup_task(conn.clone());
        let repo = WorkLoopRepository::new(conn);

        // No current loop initially
        assert!(repo.find_current("test-task").unwrap().is_none());

        // Start loop
        repo.start("test-task", TaskStatus::Planning).unwrap();
        let current = repo.find_current("test-task").unwrap();
        assert!(current.is_some());

        // End loop - no current anymore
        repo.end("test-task", &LoopOutcome::Completed {
            merged_at: None,
            commit_sha: None,
            target_branch: None,
        }).unwrap();
        assert!(repo.find_current("test-task").unwrap().is_none());
    }
}
