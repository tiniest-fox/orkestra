//! Clear the agent PID on a stage session, conditional on the expected PID.

use rusqlite::params;
use rusqlite::Connection;

use crate::interface::{WorkflowError, WorkflowResult};

/// Clear `agent_pid` and `chat_active` on the session identified by
/// `session_id`, but only if `agent_pid` currently equals `expected_pid`.
///
/// Clearing `chat_active` in the same atomic UPDATE prevents the task from
/// getting stuck with disabled approve/return-to-work buttons when a chat
/// agent exits without producing valid structured output.
///
/// Returns `true` if a row was updated (the PID matched), `false` if the PID
/// was already different or the session was not found. A `false` return means
/// another writer (e.g. `exit_chat` in `return_to_work`) already cleared the
/// PID — no further action is needed.
pub fn execute(conn: &Connection, session_id: &str, expected_pid: u32) -> WorkflowResult<bool> {
    let now = chrono::Utc::now().to_rfc3339();
    let rows = conn
        .execute(
            "UPDATE workflow_stage_sessions
             SET agent_pid = NULL, chat_active = 0, updated_at = ?1
             WHERE id = ?2 AND agent_pid = ?3",
            params![now, session_id, expected_pid.cast_signed()],
        )
        .map_err(|e| WorkflowError::Storage(e.to_string()))?;
    Ok(rows > 0)
}
