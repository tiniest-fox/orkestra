//! Get an assistant session by ID.

use orkestra_types::domain::AssistantSession;
use rusqlite::{params, Connection, OptionalExtension};

use crate::interface::{WorkflowError, WorkflowResult};

pub fn execute(conn: &Connection, id: &str) -> WorkflowResult<Option<AssistantSession>> {
    conn.query_row(
        "SELECT id, claude_session_id, title, agent_pid, spawn_count,
                session_state, created_at, updated_at, task_id, session_type
         FROM assistant_sessions WHERE id = ?",
        params![id],
        super::from_row::execute,
    )
    .optional()
    .map_err(|e| WorkflowError::Storage(e.to_string()))
}
