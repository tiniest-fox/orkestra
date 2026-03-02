//! Get all stage sessions for a task.

use orkestra_types::domain::StageSession;
use rusqlite::{params, Connection};

use crate::interface::{WorkflowError, WorkflowResult};

pub fn execute(conn: &Connection, task_id: &str) -> WorkflowResult<Vec<StageSession>> {
    let mut stmt = conn
        .prepare(
            "SELECT id, task_id, stage, claude_session_id, agent_pid, spawn_count,
                    session_state, created_at, updated_at, has_activity, chat_active
             FROM workflow_stage_sessions WHERE task_id = ? ORDER BY created_at",
        )
        .map_err(|e| WorkflowError::Storage(e.to_string()))?;

    let rows = stmt
        .query_map(params![task_id], super::from_row::execute)
        .map_err(|e| WorkflowError::Storage(e.to_string()))?;

    let mut sessions = Vec::new();
    for row in rows {
        sessions.push(row.map_err(|e| WorkflowError::Storage(e.to_string()))?);
    }

    Ok(sessions)
}
