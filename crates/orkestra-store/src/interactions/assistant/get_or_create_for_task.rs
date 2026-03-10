//! Atomically get-or-create the assistant session for a task.

use orkestra_types::domain::AssistantSession;
use rusqlite::{params, Connection};

use crate::interface::{WorkflowError, WorkflowResult};
use crate::types::session_state_to_str;

#[allow(clippy::cast_possible_wrap)]
pub fn execute(
    conn: &Connection,
    task_id: &str,
    new_session: &AssistantSession,
) -> WorkflowResult<AssistantSession> {
    let state_str = session_state_to_str(new_session.session_state);

    // INSERT OR IGNORE: if a session for this task already exists, this is a no-op.
    conn.execute(
        "INSERT OR IGNORE INTO assistant_sessions (
            id, claude_session_id, title, agent_pid, spawn_count,
            session_state, created_at, updated_at, task_id
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
        params![
            new_session.id,
            new_session.claude_session_id,
            new_session.title,
            new_session.agent_pid.map(|p| p as i32),
            new_session.spawn_count as i32,
            state_str,
            new_session.created_at,
            new_session.updated_at,
            new_session.task_id,
        ],
    )
    .map_err(|e| WorkflowError::Storage(e.to_string()))?;

    // Query the row that now exists — guaranteed to be there after the INSERT OR IGNORE.
    super::get_session_for_task::execute(conn, task_id)?
        .ok_or_else(|| WorkflowError::Storage("Failed to get-or-create session".into()))
}
