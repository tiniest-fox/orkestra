//! Clear the agent PID on a stage session, conditional on the expected PID.

use rusqlite::params;
use rusqlite::Connection;

use crate::interface::{WorkflowError, WorkflowResult};

/// Clear `agent_pid` on the session identified by `session_id`, but only if
/// `agent_pid` currently equals `expected_pid`.
///
/// Returns `true` if a row was updated (the PID matched), `false` if the PID
/// was already different or the session was not found.
pub fn execute(conn: &Connection, session_id: &str, expected_pid: u32) -> WorkflowResult<bool> {
    let now = chrono::Utc::now().to_rfc3339();
    let rows = conn
        .execute(
            "UPDATE workflow_stage_sessions
             SET agent_pid = NULL, updated_at = ?1
             WHERE id = ?2 AND agent_pid = ?3",
            params![now, session_id, expected_pid.cast_signed()],
        )
        .map_err(|e| WorkflowError::Storage(e.to_string()))?;
    Ok(rows > 0)
}
