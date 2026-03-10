//! List project-level assistant sessions (excludes task-scoped sessions).

use orkestra_types::domain::AssistantSession;
use rusqlite::Connection;

use crate::interface::{WorkflowError, WorkflowResult};

pub fn execute(conn: &Connection) -> WorkflowResult<Vec<AssistantSession>> {
    let mut stmt = conn
        .prepare(
            "SELECT id, claude_session_id, title, agent_pid, spawn_count,
                    session_state, created_at, updated_at, task_id
             FROM assistant_sessions WHERE task_id IS NULL ORDER BY created_at DESC",
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
