//! Get the assistant session for a specific task.

use orkestra_types::domain::AssistantSession;
use rusqlite::{params, Connection, OptionalExtension};

use crate::interface::{WorkflowError, WorkflowResult};

pub fn execute(conn: &Connection, task_id: &str) -> WorkflowResult<Option<AssistantSession>> {
    conn.query_row(
        "SELECT id, claude_session_id, title, agent_pid, spawn_count,
                session_state, created_at, updated_at, task_id
         FROM assistant_sessions WHERE task_id = ?1",
        params![task_id],
        super::from_row::execute,
    )
    .optional()
    .map_err(|e| WorkflowError::Storage(e.to_string()))
}
