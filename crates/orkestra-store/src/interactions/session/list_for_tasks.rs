//! List stage sessions scoped to a set of task IDs using a single IN clause.

use orkestra_types::domain::StageSession;
use rusqlite::Connection;

use crate::interface::{WorkflowError, WorkflowResult};

pub fn execute(conn: &Connection, task_ids: &[&str]) -> WorkflowResult<Vec<StageSession>> {
    if task_ids.is_empty() {
        return Ok(Vec::new());
    }

    let placeholders = vec!["?"; task_ids.len()].join(", ");
    let sql = format!(
        "SELECT id, task_id, stage, claude_session_id, agent_pid, spawn_count,
                session_state, created_at, updated_at, has_activity
         FROM workflow_stage_sessions WHERE task_id IN ({placeholders}) ORDER BY task_id, created_at"
    );

    let mut stmt = conn
        .prepare(&sql)
        .map_err(|e| WorkflowError::Storage(e.to_string()))?;

    let rows = stmt
        .query_map(
            rusqlite::params_from_iter(task_ids.iter()),
            super::from_row::execute,
        )
        .map_err(|e| WorkflowError::Storage(e.to_string()))?;

    let mut sessions = Vec::new();
    for row in rows {
        sessions.push(row.map_err(|e| WorkflowError::Storage(e.to_string()))?);
    }

    Ok(sessions)
}
