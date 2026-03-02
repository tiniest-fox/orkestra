//! List all stage sessions across all tasks.

use orkestra_types::domain::StageSession;
use rusqlite::Connection;

use crate::interface::{WorkflowError, WorkflowResult};

pub fn execute(conn: &Connection) -> WorkflowResult<Vec<StageSession>> {
    let mut stmt = conn
        .prepare(
            "SELECT id, task_id, stage, claude_session_id, agent_pid, spawn_count,
                    session_state, created_at, updated_at, has_activity, chat_active
             FROM workflow_stage_sessions ORDER BY task_id, created_at",
        )
        .map_err(|e| WorkflowError::Storage(e.to_string()))?;

    let rows = stmt
        .query_map([], super::from_row::execute)
        .map_err(|e| WorkflowError::Storage(e.to_string()))?;

    let mut sessions = Vec::new();
    for row in rows {
        sessions.push(row.map_err(|e| WorkflowError::Storage(e.to_string()))?);
    }

    Ok(sessions)
}
