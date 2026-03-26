//! Get the assistant session for a specific task filtered by session type.

use orkestra_types::domain::{AssistantSession, SessionType};
use rusqlite::{params, Connection, OptionalExtension};

use crate::interface::{WorkflowError, WorkflowResult};

pub fn execute(
    conn: &Connection,
    task_id: &str,
    session_type: &SessionType,
) -> WorkflowResult<Option<AssistantSession>> {
    let type_str = session_type.to_string();
    conn.query_row(
        "SELECT id, claude_session_id, title, agent_pid, spawn_count,
                session_state, created_at, updated_at, task_id, session_type
         FROM assistant_sessions WHERE task_id = ?1 AND session_type = ?2",
        params![task_id, type_str],
        super::from_row::execute,
    )
    .optional()
    .map_err(|e| WorkflowError::Storage(e.to_string()))
}
