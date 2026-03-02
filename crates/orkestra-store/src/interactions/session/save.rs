//! Save a stage session (insert or update).

use orkestra_types::domain::StageSession;
use rusqlite::{params, Connection};

use crate::interface::{WorkflowError, WorkflowResult};
use crate::types::session_state_to_str;

#[allow(clippy::cast_possible_wrap)]
pub fn execute(conn: &Connection, session: &StageSession) -> WorkflowResult<()> {
    let state_str = session_state_to_str(session.session_state);

    conn.execute(
        "INSERT OR REPLACE INTO workflow_stage_sessions (
            id, task_id, stage, claude_session_id, agent_pid, spawn_count,
            session_state, created_at, updated_at, has_activity, chat_active
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
        params![
            session.id,
            session.task_id,
            session.stage,
            session.claude_session_id,
            session.agent_pid.map(|p| p as i32),
            session.spawn_count as i32,
            state_str,
            session.created_at,
            session.updated_at,
            i32::from(session.has_activity),
            i32::from(session.chat_active),
        ],
    )
    .map_err(|e| WorkflowError::Storage(e.to_string()))?;

    Ok(())
}
