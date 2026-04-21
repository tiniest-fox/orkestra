//! Get the stage session for a task and stage (non-superseded, latest).

use orkestra_types::domain::StageSession;
use rusqlite::{params, Connection, OptionalExtension};

use crate::interface::{WorkflowError, WorkflowResult};

pub fn execute(
    conn: &Connection,
    task_id: &str,
    stage: &str,
) -> WorkflowResult<Option<StageSession>> {
    conn.query_row(
        "SELECT id, task_id, stage, claude_session_id, agent_pid, spawn_count,
                session_state, created_at, updated_at, has_activity
         FROM workflow_stage_sessions
         WHERE task_id = ? AND stage = ? AND session_state != 'superseded'
         ORDER BY created_at DESC LIMIT 1",
        params![task_id, stage],
        super::from_row::execute,
    )
    .optional()
    .map_err(|e| WorkflowError::Storage(e.to_string()))
}
