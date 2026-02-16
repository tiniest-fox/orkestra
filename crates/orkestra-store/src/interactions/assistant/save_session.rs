//! Save an assistant session (insert or update).

use orkestra_types::domain::AssistantSession;
use rusqlite::{params, Connection};

use crate::interface::{WorkflowError, WorkflowResult};
use crate::types::session_state_to_str;

#[allow(clippy::cast_possible_wrap)]
pub fn execute(conn: &Connection, session: &AssistantSession) -> WorkflowResult<()> {
    let state_str = session_state_to_str(session.session_state);

    conn.execute(
        "INSERT OR REPLACE INTO assistant_sessions (
            id, claude_session_id, title, agent_pid, spawn_count,
            session_state, created_at, updated_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
        params![
            session.id,
            session.claude_session_id,
            session.title,
            session.agent_pid.map(|p| p as i32),
            session.spawn_count as i32,
            state_str,
            session.created_at,
            session.updated_at,
        ],
    )
    .map_err(|e| WorkflowError::Storage(e.to_string()))?;

    Ok(())
}
