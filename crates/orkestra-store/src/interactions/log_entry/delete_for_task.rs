//! Delete all log entries associated with a task (via its stage sessions).

use rusqlite::{params, Connection};

use crate::interface::{WorkflowError, WorkflowResult};

pub fn execute(conn: &Connection, task_id: &str) -> WorkflowResult<()> {
    conn.execute(
        "DELETE FROM log_entries WHERE stage_session_id IN (SELECT id FROM workflow_stage_sessions WHERE task_id = ?)",
        params![task_id],
    )
    .map_err(|e| WorkflowError::Storage(e.to_string()))?;
    Ok(())
}
